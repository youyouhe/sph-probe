#!/usr/bin/env node
/**
 * sph 站点本地开发服务器
 *
 * 模拟 Cloudflare Worker 运行 internal/api/sph/worker.js，用于本地调试 UI 与接口。
 * 打包方式与 cmd/sph.go 的 sph_deploy 一致：将 index.html 与 icon.js(base64) 内联进 worker 模块。
 * 每次请求重新构建模块 —— 修改 index.html / worker.js 后刷新浏览器即生效（零依赖热更新）。
 *
 * 用法：
 *   node scripts/sph-dev-server.mjs            # http://127.0.0.1:8787
 *   SPH_COOKIE="你的元宝cookie" PORT=8080 node scripts/sph-dev-server.mjs
 *   SPH_ADMIN_PASSWORD="管理密码" node scripts/sph-dev-server.mjs   # 启用 /admin 管理入口
 *   HOST=0.0.0.0 node scripts/sph-dev-server.mjs   # 默认即 0.0.0.0，局域网可访问
 *
 * 说明：
 *   - 不带 SPH_COOKIE 时，解析接口会因缺少 cookie 返回错误（页面错误提示可正常测试）。
 *   - 带上真实 cookie 后，本地即可完成真实解析（需本机可访问腾讯接口）。
 *   - 默认监听 0.0.0.0，同一局域网的手机/其他电脑可访问；如无法访问请检查防火墙。
 */
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { networkInterfaces } from "node:os";
import { DatabaseSync } from "node:sqlite";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const sphDir = join(root, "internal", "api", "sph");
const host = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 8787);
const cookie = process.env.SPH_COOKIE || "";
const adminPassword = process.env.SPH_ADMIN_PASSWORD || "";

// KV：文件持久化（模拟 Cloudflare KV，重启不丢）
const kvPath = process.env.SPH_KV || join(root, "data", "kv.json");
mkdirSync(dirname(kvPath), { recursive: true });
let kvStore = new Map();
try {
  kvStore = new Map(JSON.parse(readFileSync(kvPath, "utf8") || "[]"));
} catch (e) {
  /* 首次运行无文件 */
}
const kv = {
  get: async (k) => (kvStore.has(k) ? kvStore.get(k) : null),
  put: async (k, v) => {
    kvStore.set(k, String(v));
    try {
      writeFileSync(kvPath, JSON.stringify([...kvStore]));
    } catch (e) {
      console.error("[kv] 持久化失败:", e.message);
    }
  },
  delete: async (k) => {
    kvStore.delete(k);
    try {
      writeFileSync(kvPath, JSON.stringify([...kvStore]));
    } catch (e) {
      console.error("[kv] 持久化失败:", e.message);
    }
  },
};

// ============ SQLite（解析留痕 / 示例链接 / 广告位） ============
const dbPath = process.env.SPH_DB || join(root, "data", "sph.db");
mkdirSync(dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath);
db.exec(`
  CREATE TABLE IF NOT EXISTS parse_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    ip TEXT DEFAULT '',
    ua TEXT DEFAULT '',
    referer TEXT DEFAULT '',
    share_url TEXT NOT NULL,
    export_id TEXT DEFAULT '',
    author TEXT DEFAULT '',
    description TEXT DEFAULT '',
    video_url TEXT DEFAULT '',
    ok INTEGER NOT NULL,
    error TEXT DEFAULT '',
    duration_ms INTEGER DEFAULT 0,
    cookie_source TEXT DEFAULT '',
    platform TEXT DEFAULT 'sph'
  );
  CREATE INDEX IF NOT EXISTS idx_parse_logs_ts ON parse_logs(ts);
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);
// 兼容旧库：补充 platform 列（幂等）
try {
  db.exec("ALTER TABLE parse_logs ADD COLUMN platform TEXT DEFAULT 'sph'");
} catch (e) {
  /* 已存在则忽略 */
}
const logStmt = db.prepare(
  `INSERT INTO parse_logs (ts, ip, ua, referer, share_url, export_id, author, description, video_url, ok, error, duration_ms, cookie_source, platform)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);
const getSettingStmt = db.prepare("SELECT value FROM settings WHERE key = ?");
const setSettingStmt = db.prepare(
  "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
);
// ============ YouTube 支持（yt-dlp，零落盘流式） ============
const YT_MAX_DOWNLOADS = 2; // 同时中转下载上限（保护 VPS 带宽）
let ytActiveDownloads = 0;
const ytWaiters = [];

function ytAcquire() {
  return new Promise((resolve) => {
    if (ytActiveDownloads < YT_MAX_DOWNLOADS) {
      ytActiveDownloads++;
      resolve();
    } else {
      ytWaiters.push(resolve);
    }
  });
}
function ytRelease() {
  ytActiveDownloads--;
  const next = ytWaiters.shift();
  if (next) {
    ytActiveDownloads++;
    next();
  }
}

// cookies 临时文件（Netscape 格式），用完即删
// 注意: 用户粘贴的 cookies 可能是空格分隔（部分导出插件/复制丢失 tab），yt-dlp 只认 tab，需归一化
function normalizeNetscapeCookies(text) {
  const lines = String(text).split(/\r?\n/);
  const out = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) {
      out.push(line);
      continue;
    }
    const m = line.match(/^(#HttpOnly_)?(\S+)\s+(TRUE|FALSE)\s+(\S+)\s+(TRUE|FALSE)\s+(\d+)\s+(\S+)\s*(.*)$/);
    if (!m) {
      out.push(line); // 无法解析的行原样保留
      continue;
    }
    out.push(`${m[1] || ""}${m[2]}\t${m[3]}\t${m[4]}\t${m[5]}\t${m[6]}\t${m[7]}\t${m[8]}`);
  }
  return out.join("\n");
}

function writeYtCookiesFile() {
  const raw = kvStore.get("youtube_cookies");
  if (!raw) return null;
  const file = `/tmp/sph-yt-cookies-${randomBytes(6).toString("hex")}.txt`;
  writeFileSync(file, normalizeNetscapeCookies(raw), { mode: 0o600 });
  return file;
}

function ytBaseArgs(cookiesFile) {
  const args = [
    "--no-warnings",
    "--no-playlist",
    "--js-runtimes", `node:${process.execPath}`,
    // 统一使用系统 ffmpeg（/usr/bin）：避免 PATH 中无 https 协议的特殊构建导致合并失败
    "--ffmpeg-location", "/usr/bin",
    // n challenge 组件（YouTube 2025+ 签名风控），首次自动从 GitHub 下载缓存
    "--remote-components", "ejs:github",
  ];
  if (cookiesFile) args.push("--cookies", cookiesFile);
  return args;
}

// 执行 yt-dlp 并解析 JSON 输出（60s 超时），失败时抛出含错误信息的 Error
function runYtDlpJson(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("yt-dlp", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    child.on("error", (e) => reject(new Error("yt-dlp 不可用: " + e.message)));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("解析超时"));
    }, 60000);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0 && stdout) {
        try {
          resolve(JSON.parse(stdout));
        } catch (e) {
          reject(new Error("yt-dlp 输出解析失败"));
        }
      } else {
        const msg = stderr.split("\n").find((l) => l.includes("ERROR")) || stderr.slice(-200) || `退出码 ${code}`;
        reject(new Error(msg.replace(/^ERROR:\s*/i, "").trim()));
      }
    });
  });
}

// 从 formats 提取清晰度选项（渐进格式优先，video+audio 合并估算大小）
function summarizeFormats(info) {
  const formats = info.formats || [];
  const byHeight = new Map();
  for (const f of formats) {
    if (f.vcodec === "none") continue; // 纯音频跳过（单独处理）
    const h = f.height || 0;
    if (!byHeight.has(h)) byHeight.set(h, { size: 0, hasAudio: false });
    const e = byHeight.get(h);
    const sz = f.filesize || f.filesize_approx || 0;
    e.size = Math.max(e.size, sz);
    if (f.acodec !== "none") e.hasAudio = true;
  }
  const audio = formats.find((f) => f.vcodec === "none" && f.acodec !== "none");
  const audioSize = audio ? audio.filesize || audio.filesize_approx || 0 : 0;
  const qualities = [];
  for (const [h, e] of [...byHeight.entries()].sort((a, b) => b[0] - a[0])) {
    if (h === 0) continue;
    qualities.push({
      quality: h,
      label: `${h}p${e.hasAudio ? "（完整）" : "（视频+音频合并）"}`,
      sizeBytes: e.size + (e.hasAudio ? 0 : audioSize),
    });
  }
  if (audio) qualities.push({ quality: "audio", label: "仅音频", sizeBytes: audioSize });
  return qualities;
}

const yt = {
  // 解析视频信息
  async getInfo(url) {
    const cookiesFile = writeYtCookiesFile();
    const args = [...ytBaseArgs(cookiesFile), "--dump-json", "--no-download", url];
    try {
      const out = await runYtDlpJson(args);
      return {
        title: out.title || "",
        duration: out.duration || 0,
        uploader: out.uploader || "",
        thumbnail: out.thumbnail || "",
        qualities: summarizeFormats(out),
      };
    } finally {
      if (cookiesFile) rmSync(cookiesFile, { force: true });
    }
  },

  // 检查 YouTube cookies 有效性（用固定测试视频）
  async checkCookies() {
    const cookiesFile = writeYtCookiesFile();
    const TEST_URL = "https://www.youtube.com/watch?v=jNQXAC9IVRw";
    const args = [...ytBaseArgs(cookiesFile), "--dump-json", "--no-download", TEST_URL];
    try {
      const out = await runYtDlpJson(args);
      return { valid: true, title: (out.title || "").slice(0, 60) };
    } catch (err) {
      const msg = err.message;
      // 无 cookie / 无效 cookie 的常见拒绝形态（不同 client 返回不同文案）
      if (/Sign in to confirm|not a bot|Invalid cookies|does not look like a Netscape|cookie|No video formats found/i.test(msg)) {
        return { valid: false, reason: "invalid", message: msg.slice(0, 160) };
      }
      return { valid: false, reason: "error", message: msg.slice(0, 160) };
    } finally {
      if (cookiesFile) rmSync(cookiesFile, { force: true });
    }
  },

  // 流式中转下载（不落盘：yt-dlp -o - 写 stdout，实时转发）
  // 返回 { stream, filename, contentType }；调用方负责在结束/断开时调 cleanup()
  async createStream(url, quality) {
    const cookiesFile = writeYtCookiesFile();
    const q = quality === "audio" ? "bestaudio" : `bestvideo[height<=${quality}]+bestaudio/best[height<=${quality}]`;
    const args = [
      ...ytBaseArgs(cookiesFile),
      "-f", q,
      "-o", "-",
      // 强制 mp4 容器：默认合并输出可能是 webm（vp9/av1+opus），扩展名 .mp4 会导致无法播放
      "--merge-output-format", "mp4",
      // stdout 输出 mp4 必须用 fragmented 模式（mp4 muxer 写管道不支持 seek）
      "--postprocessor-args", "ffmpeg:-movflags frag_keyframe+empty_moov",
      // 片段重试上限：401/403 时重试只是加速 cookies 风控，失败快速退出让用户重新下载
      "--retries", "2",
      "--fragment-retries", "1",
      "--no-part",
      "--quiet",
      "--no-progress",
      "--no-mtime",
      url,
    ];
    const child = spawn("yt-dlp", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (c) => (stderr += c));
    child.on("error", (e) => {
      stderr = e.message;
    });
    // 等待 stdout 首次有数据或进程退出（合并模式要先下载完各流才输出，需耐心等待）
    const stream = child.stdout;
    const started = await new Promise((resolve) => {
      // 120s：足够大视频的流下载 + 合并启动（YouTube 直链给 VPS 的带宽不定）
      const t = setTimeout(() => resolve(false), 120000);
      stream.once("data", () => {
        clearTimeout(t);
        resolve(true);
      });
      child.once("close", () => {
        clearTimeout(t);
        resolve(false);
      });
      stream.once("error", () => {
        clearTimeout(t);
        resolve(false);
      });
    });
    if (!started) {
      child.kill("SIGKILL");
      if (cookiesFile) rmSync(cookiesFile, { force: true });
      ytRelease(); // 失败也要释放并发槽位，防止泄漏导致后续请求永久等待
      const msg = stderr.split("\n").find((l) => l.includes("ERROR")) || stderr.slice(-200) || "yt-dlp 无输出";
      throw new Error(msg.replace(/^ERROR:\s*/i, "").trim().slice(0, 200));
    }
    return {
      stream: Readable.toWeb(child.stdout),
      filename: `${quality === "audio" ? "audio" : "video"}-${Date.now()}.${quality === "audio" ? "m4a" : "mp4"}`,
      contentType: quality === "audio" ? "audio/mp4" : "video/mp4",
      cleanup: () => {
        child.kill("SIGKILL");
        if (cookiesFile) rmSync(cookiesFile, { force: true });
        ytRelease();
      },
    };
  },

  async acquire() {
    await ytAcquire();
  },

  release() {
    ytRelease();
  },
};

const dbEnv = {
  logParse(e) {
    logStmt.run(
      e.ts ?? Math.floor(Date.now() / 1000),
      e.ip ?? "",
      e.ua ?? "",
      e.referer ?? "",
      e.shareUrl ?? "",
      e.exportId ?? "",
      e.author ?? "",
      e.description ?? "",
      e.videoUrl ?? "",
      e.ok ? 1 : 0,
      e.error ?? "",
      e.durationMs ?? 0,
      e.cookieSource ?? "",
      e.platform ?? "sph"
    );
  },
  getExamples() {
    try {
      const row = getSettingStmt.get("example_links");
      return row ? JSON.parse(row.value) : null;
    } catch (e) {
      return null;
    }
  },
  setExamples(list) {
    setSettingStmt.run("example_links", JSON.stringify(list));
  },
  getAd() {
    try {
      const row = getSettingStmt.get("ad");
      return row ? JSON.parse(row.value) : null;
    } catch (e) {
      return null;
    }
  },
  setAd(cfg) {
    setSettingStmt.run("ad", JSON.stringify(cfg));
  },
  // 解析统计聚合（东八区）
  getStats() {
    const now = Math.floor(Date.now() / 1000);
    const days14 = now - 14 * 86400;
    const days3 = now - 3 * 86400;
    const dayStart = now - ((now + 8 * 3600) % 86400);
    const pad = (n) => String(n).padStart(2, "0");

    const overview = db
      .prepare(
        `SELECT COUNT(*) total, COALESCE(SUM(ok),0) success, COALESCE(AVG(duration_ms),0) avg_duration
         FROM parse_logs`
      )
      .get();
    const today = db
      .prepare(
        `SELECT COUNT(*) total, COALESCE(SUM(ok),0) success FROM parse_logs WHERE ts >= ?`
      )
      .get(dayStart);

    // 近 14 天（含 0 日）
    const dailyMap = {};
    for (const r of db
      .prepare(
        `SELECT strftime('%Y-%m-%d', ts, 'unixepoch', '+8 hours') d,
                COUNT(*) total, COALESCE(SUM(ok),0) success
         FROM parse_logs WHERE ts >= ? GROUP BY d`
      )
      .all(days14)) {
      dailyMap[r.d] = r;
    }
    const daily = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date((now - i * 86400 + 8 * 3600) * 1000).toISOString().slice(0, 10);
      const r = dailyMap[d];
      daily.push({ day: d, total: r ? r.total : 0, success: r ? r.success : 0, failed: r ? r.total - r.success : 0 });
    }

    // 近 3 天时段分布（0-23 含 0）
    const hourlyMap = {};
    for (const r of db
      .prepare(
        `SELECT CAST(strftime('%H', ts, 'unixepoch', '+8 hours') AS INTEGER) h,
                COUNT(*) total, COALESCE(SUM(ok),0) success
         FROM parse_logs WHERE ts >= ? GROUP BY h`
      )
      .all(days3)) {
      hourlyMap[r.h] = r;
    }
    const hourly = [];
    for (let h = 0; h < 24; h++) {
      const r = hourlyMap[h];
      hourly.push({ hour: pad(h), total: r ? r.total : 0, success: r ? r.success : 0, failed: r ? r.total - r.success : 0 });
    }

    const topUrls = db
      .prepare(`SELECT share_url url, COUNT(*) count, COALESCE(SUM(ok),0) success FROM parse_logs GROUP BY share_url ORDER BY count DESC LIMIT 10`)
      .all();
    const topIps = db
      .prepare(`SELECT ip, COUNT(*) count FROM parse_logs GROUP BY ip ORDER BY count DESC LIMIT 10`)
      .all();
    const errors = db
      .prepare(`SELECT CASE WHEN error = '' THEN '(成功)' ELSE substr(error, 1, 60) END error, COUNT(*) count FROM parse_logs GROUP BY error ORDER BY count DESC LIMIT 10`)
      .all();
    const cookieSources = db
      .prepare(`SELECT CASE WHEN cookie_source = '' THEN 'none' ELSE cookie_source END source, COUNT(*) count FROM parse_logs GROUP BY cookie_source ORDER BY count DESC`)
      .all();
    const platforms = db
      .prepare(`SELECT CASE WHEN platform = '' OR platform IS NULL THEN 'sph' ELSE platform END platform, COUNT(*) count FROM parse_logs GROUP BY platform ORDER BY count DESC`)
      .all();
    const recent = db
      .prepare(`SELECT ts, ip, ua, share_url shareUrl, ok, error, duration_ms durationMs, cookie_source cookieSource FROM parse_logs ORDER BY id DESC LIMIT 50`)
      .all();

    return {
      overview: {
        total: overview.total,
        success: overview.success,
        failed: overview.total - overview.success,
        today: today.total,
        todaySuccess: today.success,
        avgDurationMs: Math.round(overview.avg_duration || 0),
      },
      daily,
      hourly,
      topUrls,
      topIps,
      errors,
      cookieSources,
      platforms,
      recent,
    };
  },
};
function lanAddresses() {
  const out = [];
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === "IPv4" && !a.internal) out.push(`${name}: ${a.address}`);
    }
  }
  return out;
}
const iconPath = join(root, "build", "icon.png");
const iconB64 = existsSync(iconPath) ? readFileSync(iconPath).toString("base64") : "";

/** 内联静态导入，生成可被 Node 直接加载的 worker 模块源码 */
function buildBundle() {
  let src = readFileSync(join(sphDir, "worker.js"), "utf8");
  src = src.replace(
    'import indexHtml from "./index.html";',
    `const indexHtml = ${JSON.stringify(readFileSync(join(sphDir, "index.html"), "utf8"))};`
  );
  src = src.replace(
    'import statsHtml from "./stats.html";',
    `const statsHtml = ${JSON.stringify(readFileSync(join(sphDir, "stats.html"), "utf8"))};`
  );
  src = src.replace('import iconBase64 from "./icon.js";', `const iconBase64 = ${JSON.stringify(iconB64)};`);
  return src;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const server = createServer(async (req, res) => {
  try {
    const bundle = buildBundle();
    const mod = await import("data:text/javascript;base64," + Buffer.from(bundle).toString("base64"));

    const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
    const body = req.method === "GET" || req.method === "HEAD" ? undefined : await readBody(req);
    const headers = { ...req.headers };
    if (req.socket && req.socket.remoteAddress) headers["x-real-ip"] = req.socket.remoteAddress;
    const request = new Request(url, {
      method: req.method,
      headers,
      body,
    });

    const response = await mod.default.fetch(
      request,
      {
        COOKIE: cookie,
        ADMIN_PASSWORD: adminPassword,
        COOKIE_KV: kv,
        DB: dbEnv,
        YT: yt,
      },
      {}
    );
    res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    if (response.body) {
      // 流式转发（大文件不缓冲）；用户断开时取消底层流触发 cleanup
      await new Promise((resolve) => {
        const nodeStream = Readable.fromWeb(response.body);
        nodeStream.on("error", () => {});
        nodeStream.pipe(res);
        res.on("finish", resolve);
        res.on("close", resolve);
        req.on("close", () => nodeStream.destroy());
      });
    } else {
      res.end();
    }
  } catch (err) {
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end("dev server error: " + (err && err.stack ? err.stack : String(err)));
  }
});

server.listen(port, host, () => {
  console.log(`sph dev server: http://127.0.0.1:${port}/`);
  if (host === "0.0.0.0" || host === "::") {
    for (const line of lanAddresses()) {
      const ip = line.split(": ")[1];
      console.log(`局域网访问:   http://${ip}:${port}/`);
    }
  }
  console.log(`cookie: ${cookie ? "已配置 (SPH_COOKIE)" : "未配置 —— 解析接口将报错，仅可测试页面/错误提示"}`);
  console.log(`admin: ${adminPassword ? "已配置 (SPH_ADMIN_PASSWORD)，入口 /admin" : "未配置 —— /admin 不可用"}`);
  console.log(`KV: 文件持久化 @ ${kvPath}（COOKIE_KV，含在线修改的密码）`);
  console.log(`DB: SQLite @ ${dbPath}（解析留痕 / 示例链接 / 广告位，SPH_DB 可改路径）`);
  console.log("修改 internal/api/sph/ 下文件后直接刷新浏览器即可。");
});
