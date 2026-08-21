// Cloudflare Worker — fetch_video_profile_with_share_url
// 对应 fetch_video_profile.go

import indexHtml from "./index.html";
import statsHtml from "./stats.html";
import iconBase64 from "./icon.js";

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: corsHeaders(),
      });
    }

    // GET /favicon.ico or /icon.png → serve icon
    if ((url.pathname === "/favicon.ico" || url.pathname === "/icon.png") && request.method === "GET") {
      return new Response(base64ToBytes(iconBase64), {
        headers: { "Content-Type": "image/png" },
      });
    }

    // GET / → serve index.html
    if (url.pathname === "/" && request.method === "GET") {
      return new Response(indexHtml, {
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache, no-store, must-revalidate" },
      });
    }

    // POST /api/fetch_video_profile
    if (url.pathname === "/api/fetch_video_profile" && request.method === "POST") {
      return handleFetchVideoProfile(request, env);
    }

    // POST /api/check_cookie —— 轻量检查 cookie 是否有效（只调第一步解析）
    if (url.pathname === "/api/check_cookie" && request.method === "POST") {
      return handleCheckCookie(request, env);
    }

    // GET /admin —— 管理员入口（返回同一页面，前端做密码认证后弹窗）
    if (url.pathname === "/admin" && request.method === "GET") {
      return new Response(indexHtml, {
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache, no-store, must-revalidate" },
      });
    }

    // GET /stats —— 解析统计图表页（数据接口需 admin 认证）
    if (url.pathname === "/stats" && request.method === "GET") {
      return new Response(statsHtml, {
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache, no-store, must-revalidate" },
      });
    }

    // GET /api/admin/stats —— 解析统计聚合数据（需 Bearer token）
    if (url.pathname === "/api/admin/stats" && request.method === "GET") {
      return handleAdminStats(request, env);
    }

    // GET /api/youtube/info —— 解析 YouTube 视频信息
    if (url.pathname === "/api/youtube/info" && request.method === "GET") {
      return handleYtInfo(request, env);
    }

    // GET /api/youtube/download —— 流式中转下载（零落盘）
    if (url.pathname === "/api/youtube/download" && request.method === "GET") {
      return handleYtDownload(request, env);
    }

    // GET/POST /api/admin/youtube_cookie —— YouTube cookies 管理（需 Bearer token）
    if (url.pathname === "/api/admin/youtube_cookie" && (request.method === "GET" || request.method === "POST")) {
      return handleAdminYtCookie(request, env);
    }

    // POST /api/admin/youtube_cookie_check —— 检查 YouTube cookies 有效性（需 Bearer token）
    if (url.pathname === "/api/admin/youtube_cookie_check" && request.method === "POST") {
      return handleAdminYtCookieCheck(request, env);
    }

    // POST /api/admin_auth —— 管理员密码认证，换取短期 token
    if (url.pathname === "/api/admin_auth" && request.method === "POST") {
      return handleAdminAuth(request, env);
    }

    // GET/POST /api/admin_cookie —— 全站默认 cookie 管理（需 Bearer token）
    if (url.pathname === "/api/admin_cookie" && (request.method === "GET" || request.method === "POST")) {
      return handleAdminCookie(request, env);
    }

    // GET /api/examples —— 示例链接（首页展示，最多 3 条）
    if (url.pathname === "/api/examples" && request.method === "GET") {
      return handleExamples(request, env);
    }

    // GET /api/features —— 功能开关状态（前端据此隐藏已屏蔽功能）
    if (url.pathname === "/api/features" && request.method === "GET") {
      return handleFeatures();
    }

    // GET/POST /api/admin/examples —— 示例链接管理（需 Bearer token）
    if (url.pathname === "/api/admin/examples" && (request.method === "GET" || request.method === "POST")) {
      return handleAdminExamples(request, env);
    }

    // GET /api/ad —— 广告位配置
    if (url.pathname === "/api/ad" && request.method === "GET") {
      return handleAd(request, env);
    }

    // GET/POST /api/admin/ad —— 广告位管理（需 Bearer token）
    if (url.pathname === "/api/admin/ad" && (request.method === "GET" || request.method === "POST")) {
      return handleAdminAd(request, env);
    }

    // POST /api/asr —— 视频号视频语音转文字（SiliconFlow）
    if (url.pathname === "/api/asr" && request.method === "POST") {
      return handleAsr(request, env, ctx);
    }

    // GET /api/asr/status —— 轮询异步转写任务状态
    if (url.pathname === "/api/asr/status" && request.method === "GET") {
      return handleAsrStatus(request, env);
    }

    // GET/POST /mcp —— MCP server 端点（Streamable HTTP 无状态；GET 返回能力信息）
    if (url.pathname === "/mcp" && (request.method === "POST" || request.method === "GET")) {
      return handleMcp(request, env, ctx);
    }

    // GET/POST /api/admin/mcp_config —— MCP 开关与令牌管理（需 Bearer token）
    if (url.pathname === "/api/admin/mcp_config" && (request.method === "GET" || request.method === "POST")) {
      return handleAdminMcpConfig(request, env);
    }

    // POST /api/admin/mcp_test —— 协议自检（需 Bearer token）
    if (url.pathname === "/api/admin/mcp_test" && request.method === "POST") {
      return handleAdminMcpTest(request, env);
    }

    // GET/POST /api/admin/limits —— 限流参数管理（需 Bearer token）
    if (url.pathname === "/api/admin/limits" && (request.method === "GET" || request.method === "POST")) {
      return handleAdminLimits(request, env);
    }

    // GET/POST /api/admin/asr_config —— ASR key/模型管理（需 Bearer token）
    if (url.pathname === "/api/admin/asr_config" && (request.method === "GET" || request.method === "POST")) {
      return handleAdminAsrConfig(request, env);
    }

    // POST /api/admin/change_password —— 在线修改管理员密码（需 Bearer token + 当前密码）
    if (url.pathname === "/api/admin/change_password" && request.method === "POST") {
      return handleAdminChangePassword(request, env);
    }

    // 其他请求返回 404
    return new Response("not found", { status: 404 });
  },
};

// ---- 功能开关 ----
// 暂时屏蔽的功能（成本控制/维护期间）；恢复时改为 false 即可，前端与 MCP 工具列表自动跟随
const YT_DISABLED = true;   // YouTube 解析/下载整体屏蔽
const ASR_DISABLED = false; // ASR 语音转文字屏蔽（MCP 匿名调用另限 5 分钟内视频）

// GET /api/features —— 前端按此隐藏已屏蔽功能的入口
function handleFeatures() {
  return json({ ok: true, youtube: !YT_DISABLED, asr: !ASR_DISABLED });
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function log(...args) {
  console.log(`[${new Date().toISOString()}]`, ...args);
}

// ---- Step 1: parse share URL ----

const PARSE_URL = "https://yuanbao.tencent.com/api/weixin/get_parse_result";

const PARSE_HEADERS = {
  "accept": "application/json, text/plain, */*",
  "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
  "content-type": "application/json",
  "origin": "https://yuanbao.tencent.com",
  "referer": "https://yuanbao.tencent.com/chat/naQivTmsDa/cf4d0079-ed1b-4c55-a3f3-2ca1379727d1",
  "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
  "sec-ch-ua": `"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"`,
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": `"macOS"`,
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-origin",
  "t-userid": "b9575f6b0a8c4a55a08096904a5ef20a",
  "x-agentid": "naQivTmsDa/cf4d0079-ed1b-4c55-a3f3-2ca1379727d1",
  "x-commit-tag": "72282a0d",
  "x-device-id": "1921b001708100d7fa31002b9646bd0cc15a3e2e1f",
  "x-hy106": "",
  "x-hy92": "e963067ffa31002b9646bd0c03000008b1951a",
  "x-hy93": "1921b001708100d7fa31002b9646bd0cc15a3e2e1f",
  "x-id": "b9575f6b0a8c4a55a08096904a5ef20a",
  "x-instance-id": "5",
  "x-language": "zh-CN",
  "x-os_version": "Mac OS(10.15.7)-Blink",
  "x-platform": "mac",
  "x-requested-with": "XMLHttpRequest",
  "x-source": "web",
  "x-web-third-source": "main",
  "x-webdriver": "0",
  "x-webversion": "2.69.0",
  "x-ybuitest": "0",
};

async function parseShareUrl(shareUrl, cookie) {
  log("[parseShareUrl] start, url:", shareUrl);
  const payload = JSON.stringify({
    type: "video_channel_url",
    url: shareUrl,
    scene: 1,
  });
  const resp = await fetch(PARSE_URL, {
    method: "POST",
    headers: { ...PARSE_HEADERS, cookie },
    body: payload,
  });
  if (!resp.ok) {
    log("[parseShareUrl] http request failed, status:", resp.status);
    throw new Error(`parseShareUrl: http ${resp.status}`);
  }
  const result = await resp.json();
  if (!result.data || !result.data.wx_export_id) {
    log("[parseShareUrl] missing wx_export_id in response");
    throw new Error("parseShareUrl: missing wx_export_id");
  }
  log("[parseShareUrl] success, exportId:", result.data.wx_export_id);
  return result.data;
}

// ---- Step 2: get feed info ----

const FEED_INFO_URL =
  "https://channels.weixin.qq.com/finder-preview/api/feed/get_feed_info";

// Yg = zg() + "-" + Gg()
function generateRid() {
  const timestampHex = Math.floor(Date.now() / 1000).toString(16);
  let randomHex = "";
  const chars = "0123456789abcdef";
  for (let i = 0; i < 8; i++) {
    randomHex += chars[Math.floor(Math.random() * 16)];
  }
  return `${timestampHex}-${randomHex}`;
}

const FEED_INFO_HEADERS = {
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  "Connection": "keep-alive",
  "Content-Type": "application/json",
  "Origin": "https://channels.weixin.qq.com",
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-origin",
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
  "sec-ch-ua": `"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"`,
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": `"macOS"`,
};

async function getFeedInfo(exportId, generalToken) {
  log("[getFeedInfo] start, exportId:", exportId, "generalToken:", generalToken);
  const rid = generateRid();
  const payload = JSON.stringify({
    baseReq: { generalToken },
    exportId,
  });
  const apiUrl = `${FEED_INFO_URL}?_rid=${rid}&_pageUrl=https:%2F%2Fchannels.weixin.qq.com%2Ffinder-preview%2Fpages%2Ffeed`;

  const referer =
    `https://channels.weixin.qq.com/finder-preview/pages/feed` +
    `?entry_card_type=48&comment_scene=39&appid=0` +
    `&token=${encodeURIComponent(generalToken)}` +
    `&entry_scene=0&eid=${encodeURIComponent(exportId)}`;

  const resp = await fetch(apiUrl, {
    method: "POST",
    headers: { ...FEED_INFO_HEADERS, Referer: referer },
    body: payload,
  });
  if (!resp.ok) {
    log("[getFeedInfo] http request failed, status:", resp.status);
    throw new Error(`getFeedInfo: http ${resp.status}`);
  }
  const result = await resp.json();
  log("[getFeedInfo] success, errCode:", result.errCode);
  return result;
}

// ---- combined ----

async function fetchVideoProfile(shareUrl, cookie) {
  log("[fetch] start, shareUrl:", shareUrl);

  // Step 1: parse share URL → get parse data
  log("[fetch] step 1/2: parseShareUrl...");
  let parseData;
  try {
    parseData = await parseShareUrl(shareUrl, cookie);
  } catch (err) {
    log("[fetch] step 1/2 failed:", err.message);
    throw new Error(`parse share url: ${err.message}`);
  }
  log("[fetch] step 1/2 done, exportId:", parseData.wx_export_id);

  // extract generalToken and exportId from playable_url query params
  let generalToken = "";
  let exportId = "";
  try {
    const playableUrl = new URL(parseData.playable_url);
    generalToken = playableUrl.searchParams.get("token") || "";
    exportId = playableUrl.searchParams.get("eid") || "";
  } catch (_) {
    // ignore parse error
  }
  if (!generalToken) {
    log("[fetch] warn: generalToken is empty in playable_url");
  }
  if (!exportId) {
    log("[fetch] warn: exportId (eid) is empty in playable_url");
  }
  log("[fetch] generalToken:", generalToken, "exportId:", exportId);

  // Step 2: get feed info by export ID
  log("[fetch] step 2/2: getFeedInfo...");
  let feedResult;
  try {
    feedResult = await getFeedInfo(exportId, generalToken);
  } catch (err) {
    log("[fetch] step 2/2 failed:", err.message);
    throw new Error(`get feed info: ${err.message}`);
  }
  log("[fetch] step 2/2 done");
  log("[fetch] all done");
  return { result: feedResult, exportId };
}

async function handleAdminStats(request, env) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  if (!env.DB || !env.DB.getStats) {
    return json({ ok: false, reason: "no_db", message: "未连接数据库（当前部署不支持）" });
  }
  try {
    const stats = await env.DB.getStats();
    return json({ ok: true, ...stats });
  } catch (e) {
    log("[handleAdminStats] error:", e.message);
    return json({ ok: false, reason: "error", message: e.message }, 500);
  }
}

// ---- YouTube 支持 ----

// 下载功能开关：不稳定期间暂时屏蔽（恢复时改为 false 即可，前端自动跟随）
const YT_DOWNLOAD_DISABLED = true;

// URL 白名单：只允许 YouTube 域名，防止 yt-dlp 被当作任意下载器/SSRF 利用
const YT_HOSTS = [
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "youtu.be",
];

function isYtUrl(raw) {
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();
    return YT_HOSTS.some((h) => host === h || host.endsWith("." + h));
  } catch (e) {
    return false;
  }
}

function ytNotAvailable(env) {
  return !env.YT || typeof env.YT.getInfo !== "function";
}

async function handleYtInfo(request, env) {
  const startedAt = Date.now();
  const shareUrl = new URL(request.url).searchParams.get("url") || "";
  let ok = 0, error = "", exportId = "", author = "", title = "";
  try {
    if (YT_DISABLED) {
      return json({ ok: false, error: "YouTube 功能暂时停用（维护中）" });
    }
    if (ytNotAvailable(env)) {
      return json({ ok: false, error: "当前部署不支持 YouTube（需 VPS + yt-dlp）" });
    }
    if (!isYtUrl(shareUrl)) {
      return json({ ok: false, error: "仅支持 YouTube 链接" });
    }
    const { dailyLimit } = await resolveLimits(env);
    const limit = await checkDailyParseLimit(request, env, "rate", dailyLimit);
    if (!limit.allowed) {
      logParse(env, {
        ts: Math.floor(startedAt / 1000),
        ip: clientIp(request),
        ua: request.headers.get("user-agent") || "",
        referer: request.headers.get("referer") || "",
        shareUrl,
        exportId: "",
        author: "",
        description: "",
        videoUrl: "",
        ok: 0,
        error: "rate_limited",
        durationMs: Date.now() - startedAt,
        cookieSource: "yt",
        platform: "yt",
      });
      return json({ ok: false, error: limitMessage(limit.used, dailyLimit, false), dailyRemaining: 0 });
    }
      const info = await env.YT.getInfo(shareUrl);
      ok = 1;
      exportId = new URL(shareUrl).pathname + new URL(shareUrl).search;
      author = info.uploader || "";
      title = info.title || "";
    logParse(env, {
      ts: Math.floor(startedAt / 1000),
      ip: clientIp(request),
      ua: request.headers.get("user-agent") || "",
      referer: request.headers.get("referer") || "",
      shareUrl,
      exportId,
      author,
      description: title.slice(0, 500),
      videoUrl: info.thumbnail || "",
      ok,
      error: "",
      durationMs: Date.now() - startedAt,
      cookieSource: "yt",
      platform: "yt",
    });
    return json({ ok: true, downloadEnabled: !YT_DOWNLOAD_DISABLED, dailyRemaining: limit.remaining, ...info });
  } catch (err) {
    error = err.message.slice(0, 300);
    log("[handleYtInfo] error:", err.message);
      logParse(env, {
      ts: Math.floor(startedAt / 1000),
      ip: clientIp(request),
      ua: request.headers.get("user-agent") || "",
      referer: request.headers.get("referer") || "",
      shareUrl,
      exportId: "",
      author: "",
      description: "",
      videoUrl: "",
      ok: 0,
      error,
      durationMs: Date.now() - startedAt,
      cookieSource: "yt",
      platform: "yt",
    });
    // 注: 用 200 包裹错误——CF 会把源站 5xx 替换成自己的错误页，前端按 data.ok 判断
    return json({ ok: false, error });
  }
}

async function handleYtDownload(request, env) {
  try {
    if (YT_DISABLED || YT_DOWNLOAD_DISABLED) {
      return json({ ok: false, error: "下载功能暂时停用（维护中），解析功能不受影响" });
    }
    if (ytNotAvailable(env)) {
      return json({ ok: false, error: "当前部署不支持 YouTube（需 VPS + yt-dlp）" });
    }
    const url = new URL(request.url);
    const shareUrl = url.searchParams.get("url") || "";
    const quality = url.searchParams.get("quality") || "best";
    if (!isYtUrl(shareUrl)) {
      return json({ ok: false, error: "仅支持 YouTube 链接" });
    }
    if (quality !== "audio" && !/^\d+$/.test(quality)) {
      return json({ ok: false, error: "quality 参数不合法" });
    }
    await env.YT.acquire(); // 并发限制（等待空闲）
    let handle;
    try {
      handle = await env.YT.createStream(shareUrl, quality);
    } catch (err) {
      env.YT.release && env.YT.release();
      log("[handleYtDownload] error:", err.message);
      return json({ ok: false, error: err.message.slice(0, 200) });
    }
    const headers = {
      "Content-Type": handle.contentType,
      "Content-Disposition": `attachment; filename="${handle.filename}"`,
    };
    // 包装：流结束/消费者取消时清理子进程与并发槽位
    let cleaned = false;
    const doCleanup = () => {
      if (!cleaned) {
        cleaned = true;
        handle.cleanup();
      }
    };
    const passthrough = new TransformStream({
      transform(chunk, ctrl) {
        ctrl.enqueue(chunk);
      },
      flush() {
        doCleanup();
      },
      cancel() {
        doCleanup();
      },
    });
    return new Response(handle.stream.pipeThrough(passthrough), { headers });
  } catch (err) {
    log("[handleYtDownload] error:", err.message);
    return json({ ok: false, error: err.message.slice(0, 200) });
  }
}

async function handleAdminYtCookie(request, env) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  if (!env.COOKIE_KV || !env.COOKIE_KV.put) {
    return json({ ok: false, reason: "no_kv", message: "未绑定 KV，无法保存" });
  }
  if (request.method === "POST") {
    try {
      const body = await request.json();
      const cookie = body && typeof body.cookie === "string" ? body.cookie.trim() : "";
      if (!cookie) {
        // 空内容 = 清除
        await env.COOKIE_KV.delete("youtube_cookies");
        log("[admin] YouTube cookies 已清除");
        return json({ ok: true, cleared: true });
      }
      await env.COOKIE_KV.put("youtube_cookies", cookie);
      log("[admin] YouTube cookies 已更新, 长度:", cookie.length);
      return json({ ok: true });
    } catch (e) {
      return json({ ok: false, reason: "error", message: e.message }, 500);
    }
  }
  const stored = await env.COOKIE_KV.get("youtube_cookies");
  return json({ ok: true, configured: !!stored, length: stored ? stored.length : 0 });
}

async function handleAdminYtCookieCheck(request, env) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  if (!env.YT || typeof env.YT.checkCookies !== "function") {
    return json({ ok: false, reason: "no_yt", message: "当前部署不支持 YouTube（需 VPS + yt-dlp）" });
  }
  try {
    const result = await env.YT.checkCookies();
    return json({ ok: true, valid: result.valid, reason: result.reason || "", message: result.message || "", title: result.title || "" });
  } catch (e) {
    return json({ ok: false, reason: "error", message: e.message }, 500);
  }
}

// ---- ASR 语音转文字（SiliconFlow） ----

const ASR_API_URL = "https://api.siliconflow.cn/v1/audio/transcriptions";
const ASR_DEFAULT_MODEL = "TeleAI/TeleSpeechASR";
// Worker 直接下载原视频的上限（SiliconFlow 文件上限约 25MB）；VPS 走 ffmpeg 抽音频，不受此限
const ASR_MAX_BYTES = 25 * 1024 * 1024;

// 当前生效的 ASR 配置：KV 在线设置优先，回退部署注入的 SILICONFLOW_API_KEY 绑定
async function resolveAsrConfig(env) {
  let apiKey = "";
  let model = "";
  if (env.COOKIE_KV && env.COOKIE_KV.get) {
    apiKey = (await env.COOKIE_KV.get("asr_api_key")) || "";
    model = (await env.COOKIE_KV.get("asr_model")) || "";
  }
  if (!apiKey) apiKey = env.SILICONFLOW_API_KEY || "";
  return { apiKey, model: model || ASR_DEFAULT_MODEL };
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// 调 SiliconFlow 转写接口（OpenAI 兼容 multipart），返回文本
async function transcribeViaSiliconFlow(bytes, filename, apiKey, model) {
  const form = new FormData();
  form.append("file", new Blob([bytes]), filename);
  form.append("model", model);
  const resp = await fetch(ASR_API_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!resp.ok) {
    const detail = (await resp.text()).slice(0, 200);
    log("[asr] siliconflow http", resp.status, detail);
    if (resp.status === 401 || resp.status === 403) {
      throw new Error("ASR API key 无效或已过期（SiliconFlow 返回 " + resp.status + "）");
    }
    throw new Error(`SiliconFlow 转写失败: http ${resp.status} ${detail}`);
  }
  const result = await resp.json();
  return (result && result.text) || "";
}

// ---- ASR 结果缓存（KV + LRU 索引，上限默认 100 条，admin 可在线调整） ----
// 索引键 asr:index 存 [{k: cacheKey, t: 最后访问时间}]，超出上限淘汰最久未用
const DEFAULT_ASR_CACHE_MAX = 100;
const ASR_CACHE_INDEX_KEY = "asr:index";
// 匿名（无令牌）MCP 调用 ASR 的时长上限默认值：5 分钟（admin 可在线调整，KV anon_asr_minutes）
const DEFAULT_ANON_ASR_MINUTES = 5;

async function asrCacheReadIndex(env) {
  try {
    const idx = JSON.parse((await env.COOKIE_KV.get(ASR_CACHE_INDEX_KEY)) || "[]");
    return Array.isArray(idx) ? idx : [];
  } catch (_) {
    return [];
  }
}

async function asrCacheGet(env, key) {
  if (!env.COOKIE_KV || !env.COOKIE_KV.get) return null;
  const text = await env.COOKIE_KV.get(key);
  if (text == null) return null;
  // touch：更新访问时间（旧缓存条目首次命中时补登索引）
  if (env.COOKIE_KV.put) {
    const idx = await asrCacheReadIndex(env);
    const entry = idx.find((x) => x.k === key);
    if (entry) entry.t = Date.now();
    else idx.push({ k: key, t: Date.now() });
    await env.COOKIE_KV.put(ASR_CACHE_INDEX_KEY, JSON.stringify(idx));
  }
  return text;
}

async function asrCachePut(env, key, text) {
  if (!env.COOKIE_KV || !env.COOKIE_KV.put) return;
  await env.COOKIE_KV.put(key, text);
  const { asrCacheMax } = await resolveLimits(env);
  let idx = await asrCacheReadIndex(env);
  idx = idx.filter((x) => x.k !== key);
  idx.push({ k: key, t: Date.now() });
  while (idx.length > asrCacheMax) {
    const oldest = idx.reduce((a, b) => (a.t <= b.t ? a : b));
    idx = idx.filter((x) => x !== oldest);
    await env.COOKIE_KV.delete(oldest.k);
    await env.COOKIE_KV.delete(`asrjob:${oldest.k}`);
  }
  await env.COOKIE_KV.put(ASR_CACHE_INDEX_KEY, JSON.stringify(idx));
}

// 执行一次转写任务：取音频 → SiliconFlow → 写缓存与留痕。成功返回文本，失败抛错
// VPS 部署有并发槽位（env.ASR.acquire/release）：全程持有，超出并发的任务在此排队等待
async function runAsrJob(env, request, startedAt, { videoUrl, exportId, cacheKey, model, apiKey }) {
  const hasSlots = env.ASR && typeof env.ASR.acquire === "function";
  if (hasSlots) await env.ASR.acquire();
  try {
    // 取音频：VPS 用 ffmpeg 抽取压缩音频；Worker 直接下载原视频（限 25MB）
    let bytes, filename;
    if (env.ASR && typeof env.ASR.prepareAudio === "function") {
      const audio = await env.ASR.prepareAudio(videoUrl);
      bytes = audio.bytes;
      filename = audio.filename;
    } else {
      const resp = await fetch(videoUrl);
      if (!resp.ok) throw new Error(`下载视频失败: http ${resp.status}`);
      const size = Number(resp.headers.get("content-length") || 0);
      if (size > ASR_MAX_BYTES) throw new Error("视频超过 25MB，当前部署无法转写（VPS 部署可通过 ffmpeg 压缩音频，不受此限）");
      bytes = await resp.arrayBuffer();
      if (bytes.byteLength > ASR_MAX_BYTES) throw new Error("视频超过 25MB，当前部署无法转写（VPS 部署可通过 ffmpeg 压缩音频，不受此限）");
      filename = "video.mp4";
    }
    const text = await transcribeViaSiliconFlow(bytes, filename, apiKey, model);
    if (text) {
      await asrCachePut(env, cacheKey, text);
    }
    logParse(env, {
      ts: Math.floor(startedAt / 1000),
      ip: clientIp(request),
      ua: request.headers.get("user-agent") || "",
      referer: request.headers.get("referer") || "",
      shareUrl: videoUrl,
      exportId: exportId || "",
      author: "",
      description: text.slice(0, 500),
      videoUrl,
      ok: 1,
      error: "",
      durationMs: Date.now() - startedAt,
      cookieSource: "asr",
      platform: "sph",
    });
    return text;
  } catch (err) {
    log("[runAsrJob] error:", err.message);
    logParse(env, {
      ts: Math.floor(startedAt / 1000),
      ip: clientIp(request),
      ua: request.headers.get("user-agent") || "",
      referer: request.headers.get("referer") || "",
      shareUrl: videoUrl,
      exportId: "",
      author: "",
      description: "",
      videoUrl,
      ok: 0,
      error: err.message.slice(0, 300),
      durationMs: Date.now() - startedAt,
      cookieSource: "asr",
      platform: "sph",
    });
    throw err;
  } finally {
    if (hasSlots) env.ASR.release();
  }
}

// 发起一次转写：缓存命中直接返回文本；否则入队异步任务（或无 KV 时同步执行）
// 返回 { text, model, cached } 或 { pending, jobId }；配置缺失/参数错误抛错
async function asrStart(env, request, ctx, { videoUrl, exportId, shareUrl }) {
  const { apiKey, model } = await resolveAsrConfig(env);
  if (!apiKey) {
    throw new Error("未配置 ASR API key（管理员可在 /admin 设置，或部署时注入 SILICONFLOW_API_KEY）");
  }
  // 前端拿不到 exportId 时用分享链接做缓存键（同一视频直链每次解析都会变，分享链接稳定）
  const cacheId = exportId || shareUrl || (await sha256Hex(videoUrl));
  const cacheKey = `asr:${model}:${cacheId}`;
  const cached = await asrCacheGet(env, cacheKey);
  if (cached != null) return { text: cached, model, cached: true };

  // 无 KV 的极简部署：保持同步行为（长视频可能被代理超时截断）
  if (!env.COOKIE_KV || !env.COOKIE_KV.put) {
    const text = await runAsrJob(env, request, Date.now(), { videoUrl, exportId, cacheKey, model, apiKey });
    return { text, model, cached: false };
  }

  // 异步任务：长视频转写可能超过 Cloudflare ~100s 代理超时，改后台执行 + 轮询
  // jobKey 由缓存键派生：同一视频的并发请求共享同一个任务，不重复扣费
  const jobKey = `asrjob:${cacheKey}`;
  const jobRaw = await env.COOKIE_KV.get(jobKey);
  if (jobRaw) {
    let job = {};
    try { job = JSON.parse(jobRaw); } catch (_) { /* 损坏则重建 */ }
    if (job.status === "pending") {
      return { pending: true, jobId: encodeURIComponent(jobKey) };
    }
    // done 但缓存缺失（异常）或 error：清掉重来
    await env.COOKIE_KV.delete(jobKey);
  }
  await env.COOKIE_KV.put(jobKey, JSON.stringify({ status: "pending", startedAt: Date.now() }), { expirationTtl: 3600 });
  const run = runAsrJob(env, request, Date.now(), { videoUrl, exportId, cacheKey, model, apiKey })
    .then(() => env.COOKIE_KV.put(jobKey, JSON.stringify({ status: "done" }), { expirationTtl: 3600 }))
    .catch((err) =>
      env.COOKIE_KV.put(jobKey, JSON.stringify({ status: "error", error: err.message.slice(0, 300) }), { expirationTtl: 3600 })
    )
    .catch((e) => log("[asrStart] job persist error:", e.message));
  if (ctx && typeof ctx.waitUntil === "function") {
    ctx.waitUntil(run);
  }
  return { pending: true, jobId: encodeURIComponent(jobKey) };
}

async function handleAsr(request, env, ctx) {
  try {
    if (ASR_DISABLED) {
      return json({ ok: false, reason: "disabled", error: "语音转文字暂时停用（维护中）" });
    }
    const body = await request.json();
    const videoUrl = body && typeof body.url === "string" ? body.url.trim() : "";
    const exportId = body && typeof body.exportId === "string" ? body.exportId.trim() : "";
    const shareUrl = body && typeof body.shareUrl === "string" ? body.shareUrl.trim() : "";
    if (!/^https?:\/\//i.test(videoUrl)) {
      return json({ ok: false, reason: "bad_request", error: "url 参数不合法" }, 400);
    }
    const r = await asrStart(env, request, ctx, { videoUrl, exportId, shareUrl });
    if (r.pending) {
      return json({ ok: true, pending: true, jobId: r.jobId });
    }
    return json({ ok: true, text: r.text, model: r.model, cached: r.cached });
  } catch (err) {
    log("[handleAsr] error:", err.message);
    return json({ ok: false, reason: "error", error: err.message.slice(0, 300) });
  }
}

// GET /api/asr/status?jobId= —— 轮询转写任务状态
async function handleAsrStatus(request, env) {
  if (!env.COOKIE_KV || !env.COOKIE_KV.get) {
    return json({ ok: false, error: "当前部署不支持异步转写" });
  }
  const jobKey = decodeURIComponent(new URL(request.url).searchParams.get("jobId") || "");
  if (!jobKey.startsWith("asrjob:asr:")) {
    return json({ ok: false, error: "jobId 不合法" }, 400);
  }
  const raw = await env.COOKIE_KV.get(jobKey);
  if (!raw) {
    return json({ ok: false, error: "任务不存在或已过期，请重新发起转写" });
  }
  let job = {};
  try { job = JSON.parse(raw); } catch (_) { /* 按 pending 处理 */ }
  if (job.status === "done") {
    const text = await asrCacheGet(env, jobKey.slice("asrjob:".length));
    if (text != null) {
      return json({ ok: true, status: "done", text, cached: true });
    }
    return json({ ok: false, error: "转写结果已过期，请重新发起转写" });
  }
  if (job.status === "error") {
    return json({ ok: true, status: "error", error: job.error || "转写失败" });
  }
  return json({ ok: true, status: "pending" });
}

// ---- MCP server（Streamable HTTP 无状态模式） ----
// 把站点解析/转写能力暴露给 AI 客户端。admin 页配置开关与访问令牌（KV）。
// 注意：MCP 调用已用令牌认证，不再计入 IP 每日限流。

const MCP_PROTOCOL_VERSION = "2025-03-26";
const MCP_SERVER_INFO = { name: "sph-probe", version: "1.0.0" };

const MCP_TOOLS = [
  {
    name: "parse_channels_video",
    description:
      "解析微信视频号分享链接，返回作者、简介、视频下载直链（h264/h265）。只做信息解析；除非用户明确要求转文字，否则不要继续调用 transcribe_video",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "视频号分享链接，如 https://weixin.qq.com/sph/xxxx" },
      },
      required: ["url"],
    },
  },
  {
    name: "parse_youtube_video",
    description: "解析 YouTube 视频信息：标题、时长、作者、清晰度选项。仅 VPS（yt-dlp）部署可用",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "YouTube 视频链接" },
      },
      required: ["url"],
    },
  },
  {
    name: "transcribe_video",
    description:
      `【仅在用户明确要求语音转文字/转写/字幕时才调用，解析视频信息不需要调用它】视频语音转文字（ASR），消耗服务端付费额度。长视频为异步任务：返回 pending 时，稍后以相同参数再次调用（或用 get_transcription 按 shareUrl 查询）获取结果。匿名调用有时长上限（默认 5 分钟，管理员可调整）`,
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "视频直链（http/https）" },
        shareUrl: { type: "string", description: "分享链接（可选，用作缓存键；直链每次解析会变）" },
      },
      required: ["url"],
    },
  },
  {
    name: "get_transcription",
    description:
      "获取视频的语音转文字（ASR）结果：done（含文本）/ pending（转写中）/ not_found（需先调 transcribe_video）。结果缓存上限 100 条，LRU 淘汰",
    inputSchema: {
      type: "object",
      properties: {
        shareUrl: { type: "string", description: "分享链接（转写时使用的缓存键）" },
        exportId: { type: "string", description: "视频 exportId（可选，优先于 shareUrl）" },
      },
    },
  },
];

async function resolveMcpConfig(env) {
  let enabled = false, token = "";
  if (env.COOKIE_KV && env.COOKIE_KV.get) {
    enabled = (await env.COOKIE_KV.get("mcp_enabled")) === "1";
    token = (await env.COOKIE_KV.get("mcp_token")) || "";
  }
  return { enabled, token };
}

// 当前可用的 MCP 工具（屏蔽中的功能不出现在列表里）
function mcpTools() {
  const asrOff = ASR_DISABLED;
  return MCP_TOOLS.filter(
    (t) =>
      !(t.name === "parse_youtube_video" && YT_DISABLED) &&
      !(asrOff && (t.name === "transcribe_video" || t.name === "get_transcription"))
  );
}

// 执行 MCP 工具调用，返回可 JSON 序列化的结果（失败抛错）
// extra.anonymous：开放访问（无令牌）调用，ASR 限 5 分钟内视频
async function mcpCallTool(name, args, env, request, ctx, extra = {}) {
  if (name === "parse_youtube_video" && YT_DISABLED) throw new Error("YouTube 功能暂时停用（维护中）");
  if ((name === "transcribe_video" || name === "get_transcription") && ASR_DISABLED) throw new Error("语音转文字暂时停用（维护中）");
  if (name === "parse_channels_video") {
    const shareUrl = String(args.url || "").trim();
    if (!shareUrl) throw new Error("缺少 url 参数");
    const startedAt = Date.now();
    const cookieInfo = await resolveCookieInfo({}, env);
    const { result, exportId } = await fetchVideoProfile(shareUrl, cookieInfo.value);
    const fi = (result.data && result.data.feedInfo) || {};
    const ai = (result.data && result.data.authorInfo) || {};
    const videoUrl = (fi.h264VideoInfo && fi.h264VideoInfo.videoUrl) || (fi.h265VideoInfo && fi.h265VideoInfo.videoUrl) || fi.videoUrl || "";
    logParse(env, {
      ts: Math.floor(startedAt / 1000),
      ip: clientIp(request),
      ua: request.headers.get("user-agent") || "",
      referer: "",
      shareUrl,
      exportId: exportId || "",
      author: ai.nickname || "",
      description: (fi.description || "").slice(0, 500),
      videoUrl,
      ok: 1,
      error: "",
      durationMs: Date.now() - startedAt,
      cookieSource: "mcp",
      platform: "sph",
    });
    return {
      exportId,
      author: ai.nickname || "",
      authorAvatar: ai.headImgUrl || "",
      description: fi.description || "",
      videoUrl: {
        default: videoUrl,
        h264: (fi.h264VideoInfo && fi.h264VideoInfo.videoUrl) || "",
        h265: (fi.h265VideoInfo && fi.h265VideoInfo.videoUrl) || "",
      },
    };
  }
  if (name === "parse_youtube_video") {
    const shareUrl = String(args.url || "").trim();
    if (ytNotAvailable(env)) throw new Error("当前部署不支持 YouTube（需 VPS + yt-dlp）");
    if (!isYtUrl(shareUrl)) throw new Error("仅支持 YouTube 链接");
    const startedAt = Date.now();
    const info = await env.YT.getInfo(shareUrl);
    logParse(env, {
      ts: Math.floor(startedAt / 1000),
      ip: clientIp(request),
      ua: request.headers.get("user-agent") || "",
      referer: "",
      shareUrl,
      exportId: "",
      author: info.uploader || "",
      description: (info.title || "").slice(0, 500),
      videoUrl: info.thumbnail || "",
      ok: 1,
      error: "",
      durationMs: Date.now() - startedAt,
      cookieSource: "mcp",
      platform: "yt",
    });
    return info;
  }
  if (name === "transcribe_video") {
    const videoUrl = String(args.url || "").trim();
    const shareUrl = String(args.shareUrl || "").trim();
    if (!/^https?:\/\//i.test(videoUrl)) throw new Error("url 参数不合法（需视频直链）");
    if (extra.anonymous) {
      // 保护：匿名调用只放行 5 分钟内的视频。先查缓存——已转写过的直接返回，不卡时长
      const { model } = await resolveAsrConfig(env);
      const cacheKey = `asr:${model}:${shareUrl || (await sha256Hex(videoUrl))}`;
      const cached = await asrCacheGet(env, cacheKey);
      if (cached != null) return { status: "done", text: cached, cached: true };
      let duration = -1;
      if (env.ASR && typeof env.ASR.probeDuration === "function") {
        try {
          duration = await env.ASR.probeDuration(videoUrl);
        } catch (e) {
          log("[mcp] probeDuration error:", e.message);
        }
      }
      const { anonAsrMinutes } = await resolveLimits(env);
      if (duration < 0) {
        throw new Error(`暂时无法确认视频时长，匿名调用暂只支持 ${anonAsrMinutes} 分钟内的视频～可联系站点管理员申请访问令牌`);
      }
      if (duration > anonAsrMinutes * 60) {
        throw new Error(`该视频约 ${Math.round(duration / 60)} 分钟，超出匿名调用的 ${anonAsrMinutes} 分钟上限～可联系站点管理员申请访问令牌`);
      }
    }
    const r = await asrStart(env, request, ctx, { videoUrl, exportId: "", shareUrl });
    if (r.pending) {
      return { status: "pending", message: "转写进行中（长视频可能需要几分钟）。请稍后以相同参数再次调用本工具，或用 get_transcription 查询结果。" };
    }
    return { status: "done", text: r.text, cached: r.cached };
  }
  if (name === "get_transcription") {
    const shareUrl = String(args.shareUrl || "").trim();
    const exportId = String(args.exportId || "").trim();
    const cacheId = exportId || shareUrl;
    if (!cacheId) throw new Error("需要 shareUrl 或 exportId 参数");
    const { model } = await resolveAsrConfig(env);
    const cacheKey = `asr:${model}:${cacheId}`;
    const text = await asrCacheGet(env, cacheKey);
    if (text != null) return { status: "done", text };
    // 未命中缓存：看任务是否在进行/失败过
    if (env.COOKIE_KV && env.COOKIE_KV.get) {
      const raw = await env.COOKIE_KV.get(`asrjob:${cacheKey}`);
      if (raw) {
        let job = {};
        try { job = JSON.parse(raw); } catch (_) { /* 按未知处理 */ }
        if (job.status === "pending") return { status: "pending", message: "转写进行中，请稍后再查" };
        if (job.status === "error") return { status: "error", error: job.error || "转写失败，可重新调用 transcribe_video" };
      }
    }
    return { status: "not_found", message: "未找到该视频的转写结果，请先调用 transcribe_video 发起转写" };
  }
  throw new Error("未知工具: " + name);
}

// 处理单条 JSON-RPC 消息；notification（无 id）返回 null
// extra.anonymous：开放访问（无令牌）调用
async function mcpDispatch(msg, env, request, ctx, extra = {}) {
  const { id, method, params } = msg || {};
  if (id === undefined || id === null) return null; // notification，无需响应
  if (method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: MCP_SERVER_INFO,
        instructions:
          "视频号视频解析与语音转文字服务。解析视频信息用 parse_channels_video；transcribe_video 消耗付费额度，仅在用户明确要求转文字时才调用，不要主动转写。",
      },
    };
  }
  if (method === "ping") {
    return { jsonrpc: "2.0", id, result: {} };
  }
  if (method === "tools/list") {
    return { jsonrpc: "2.0", id, result: { tools: mcpTools() } };
  }
  if (method === "tools/call") {
    const toolName = params && params.name;
    const toolArgs = (params && params.arguments) || {};
    try {
      const out = await mcpCallTool(toolName, toolArgs, env, request, ctx, extra);
      return {
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] },
      };
    } catch (e) {
      return {
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: e.message }], isError: true },
      };
    }
  }
  return { jsonrpc: "2.0", id, error: { code: -32601, message: "method not found: " + method } };
}

async function handleMcp(request, env, ctx) {
  const { enabled, token } = await resolveMcpConfig(env);
  if (!enabled) {
    return json({ error: "MCP 服务未启用（管理员可在 /admin 开启）" }, 403);
  }
  if (token && bearerToken(request) !== token) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders(), "Content-Type": "application/json", "WWW-Authenticate": 'Bearer realm="mcp"' },
    });
  }
  if (request.method === "GET") {
    // 能力发现（部分客户端/人工排障用）
    return json({
      ...MCP_SERVER_INFO,
      protocol: MCP_PROTOCOL_VERSION,
      transport: "streamable-http (stateless, json responses)",
      tools: mcpTools().map((t) => t.name),
      auth: token ? "bearer" : "none",
      rateLimit: token ? null : `tools/call ${(await resolveLimits(env)).dailyLimit} 次/天/IP`,
    });
  }
  let msg;
  try {
    msg = await request.json();
  } catch (_) {
    return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }, 400);
  }
  // 空令牌 = 开放访问：tools/call 按源 IP 每天限 10 次（initialize/tools/list 握手不占额度）
  // 正常调用不打扰；只在超限时提示已用次数
  if (!token && msg && msg.method === "tools/call") {
    const { dailyLimit } = await resolveLimits(env);
    const limit = await checkDailyParseLimit(request, env, "ratemcp", dailyLimit);
    if (!limit.allowed) {
      return json({
        jsonrpc: "2.0",
        id: msg.id ?? null,
        result: {
          content: [{ type: "text", text: limitMessage(limit.used, dailyLimit, true) }],
          isError: true,
        },
      });
    }
  }
  const resp = await mcpDispatch(msg, env, request, ctx, { anonymous: !token });
  if (resp === null) {
    return new Response(null, { status: 202, headers: corsHeaders() });
  }
  return new Response(JSON.stringify(resp), {
    headers: { ...corsHeaders(), "Content-Type": "application/json", "MCP-Protocol-Version": MCP_PROTOCOL_VERSION },
  });
}

async function handleAdminMcpConfig(request, env) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  if (!env.COOKIE_KV || !env.COOKIE_KV.put) {
    return json({ ok: false, reason: "no_kv", message: "未绑定 KV，无法保存" });
  }
  if (request.method === "GET") {
    const { enabled, token } = await resolveMcpConfig(env);
    return json({ ok: true, enabled, configured: !!token, token, tools: mcpTools().map((t) => t.name) });
  }
  try {
    const body = await request.json();
    const enabled = !!body.enabled;
    let token = typeof body.token === "string" ? body.token.trim() : "";
    // 空令牌是合法模式（开放访问，按 IP 限流）；仅在明确要求时生成
    if (!token && body.generateToken) {
      token = [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, "0")).join("");
    }
    await env.COOKIE_KV.put("mcp_enabled", enabled ? "1" : "0");
    if (token) {
      await env.COOKIE_KV.put("mcp_token", token);
    } else if (body.clearToken) {
      await env.COOKIE_KV.delete("mcp_token");
    }
    const cur = await resolveMcpConfig(env);
    log("[admin] MCP", cur.enabled ? "已启用" : "已停用", ", token:", cur.token ? `已设置(长度${cur.token.length})` : "未设置");
    return json({ ok: true, enabled: cur.enabled, configured: !!cur.token, token: cur.token, tools: mcpTools().map((t) => t.name) });
  } catch (e) {
    return json({ ok: false, reason: "error", message: e.message }, 500);
  }
}

// 管理页「测试」：直接走一遍 initialize + tools/list，验证协议栈可用
async function handleAdminMcpTest(request, env) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  try {
    const init = await mcpDispatch({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, env, request, {});
    const list = await mcpDispatch({ jsonrpc: "2.0", id: 2, method: "tools/list" }, env, request, {});
    if (!init.result || !list.result) throw new Error("协议响应异常");
    const tools = list.result.tools || [];
    const { enabled, token } = await resolveMcpConfig(env);
    return json({
      ok: true,
      enabled,
      configured: !!token,
      protocol: init.result.protocolVersion,
      serverInfo: init.result.serverInfo,
      tools: tools.map((t) => t.name),
      message: `协议正常，${tools.length} 个工具可用`,
    });
  } catch (e) {
    return json({ ok: false, message: e.message }, 500);
  }
}

// GET/POST /api/admin/limits —— 限流参数管理（需 Bearer token）
async function handleAdminLimits(request, env) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  if (request.method === "GET") {
    const { dailyLimit, anonAsrMinutes, asrCacheMax } = await resolveLimits(env);
    return json({
      ok: true,
      dailyLimit,
      anonAsrMinutes,
      asrCacheMax,
      defaults: {
        dailyLimit: DEFAULT_DAILY_PARSE_LIMIT,
        anonAsrMinutes: DEFAULT_ANON_ASR_MINUTES,
        asrCacheMax: DEFAULT_ASR_CACHE_MAX,
      },
      kv: !!(env.COOKIE_KV && env.COOKIE_KV.put),
    });
  }
  if (!env.COOKIE_KV || !env.COOKIE_KV.put) {
    return json({ ok: false, reason: "no_kv", message: "未绑定 KV，无法保存" });
  }
  try {
    const body = await request.json();
    const dailyLimit = Number(body.dailyLimit);
    const anonAsrMinutes = Number(body.anonAsrMinutes);
    const asrCacheMax = Number(body.asrCacheMax);
    if (!Number.isInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > 1000) {
      return json({ ok: false, reason: "bad_request", message: "每日次数上限需为 1-1000 的整数" }, 400);
    }
    if (!Number.isInteger(anonAsrMinutes) || anonAsrMinutes < 1 || anonAsrMinutes > 120) {
      return json({ ok: false, reason: "bad_request", message: "匿名 ASR 时长上限需为 1-120 的整数（分钟）" }, 400);
    }
    if (!Number.isInteger(asrCacheMax) || asrCacheMax < 10 || asrCacheMax > 10000) {
      return json({ ok: false, reason: "bad_request", message: "ASR 缓存条数上限需为 10-10000 的整数" }, 400);
    }
    await env.COOKIE_KV.put("daily_limit", String(dailyLimit));
    await env.COOKIE_KV.put("anon_asr_minutes", String(anonAsrMinutes));
    await env.COOKIE_KV.put("asr_cache_max", String(asrCacheMax));
    log("[admin] 限流参数已更新: 每日", dailyLimit, "次, 匿名 ASR", anonAsrMinutes, "分钟, 缓存", asrCacheMax, "条");
    return json({ ok: true, dailyLimit, anonAsrMinutes, asrCacheMax });
  } catch (e) {
    return json({ ok: false, reason: "error", message: e.message }, 500);
  }
}

async function handleAdminAsrConfig(request, env) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  if (request.method === "GET") {
    const { apiKey, model } = await resolveAsrConfig(env);
    return json({
      ok: true,
      configured: !!apiKey,
      hasEnvKey: !!(env.SILICONFLOW_API_KEY || ""),
      kv: !!(env.COOKIE_KV && env.COOKIE_KV.put),
      model,
      defaultModel: ASR_DEFAULT_MODEL,
    });
  }
  if (!env.COOKIE_KV || !env.COOKIE_KV.put) {
    return json({ ok: false, reason: "no_kv", message: "未绑定 KV，无法保存（key 由部署配置注入）" });
  }
  try {
    const body = await request.json();
    const apiKey = body && typeof body.apiKey === "string" ? body.apiKey.trim() : "";
    const model = body && typeof body.model === "string" ? body.model.trim() : "";
    if (apiKey) {
      await env.COOKIE_KV.put("asr_api_key", apiKey);
    } else {
      // 空 key = 清除在线配置（回退到部署注入的绑定）
      await env.COOKIE_KV.delete("asr_api_key");
    }
    if (model) {
      await env.COOKIE_KV.put("asr_model", model);
    } else {
      await env.COOKIE_KV.delete("asr_model");
    }
    log("[admin] ASR 配置已更新, key:", apiKey ? `已设置(长度${apiKey.length})` : "已清除", "model:", model || ASR_DEFAULT_MODEL);
    return json({ ok: true });
  } catch (e) {
    log("[handleAdminAsrConfig] error:", e.message);
    return json({ ok: false, reason: "error", message: e.message }, 500);
  }
}

// ---- 示例链接 & 广告位 ----

const DEFAULT_EXAMPLES = [
  { title: "试试示例视频", url: "https://weixin.qq.com/sph/Axv548mzBF" },
];

async function handleExamples(request, env) {
  if (env.DB && env.DB.getExamples) {
    try {
      const list = await env.DB.getExamples();
      if (Array.isArray(list)) return json({ list });
    } catch (e) {
      log("[handleExamples] error:", e.message);
    }
  }
  return json({ list: DEFAULT_EXAMPLES, source: "default" });
}

async function handleAd(request, env) {
  if (env.DB && env.DB.getAd) {
    try {
      const cfg = await env.DB.getAd();
      if (cfg) return json(cfg);
    } catch (e) {
      log("[handleAd] error:", e.message);
    }
  }
  return json({ enabled: false, html: "", position: "footer" });
}

// 校验示例链接列表：最多 3 条，每条需 url
function validateExamples(list) {
  if (!Array.isArray(list)) return "列表格式不正确";
  if (list.length > 3) return "最多 3 条示例链接";
  for (const item of list) {
    if (!item || typeof item.url !== "string" || !item.url.trim()) return "每条示例链接都必须填写链接";
    if (!/^https?:\/\//i.test(item.url.trim())) return `链接格式不正确: ${item.url}`;
  }
  return "";
}

async function requireAdmin(request, env) {
  const pwd = await resolveAdminPassword(env);
  if (!pwd) return json({ ok: false, reason: "disabled", message: "未配置管理员密码" });
  if (!(await verifyAdminToken(pwd, bearerToken(request)))) {
    return json({ ok: false, reason: "unauthorized", message: "未认证或已过期" }, 401);
  }
  return null;
}

async function handleAdminChangePassword(request, env) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  if (!env.COOKIE_KV || !env.COOKIE_KV.put) {
    return json({ ok: false, reason: "no_kv", message: "未绑定 KV，密码由部署配置，请修改配置后重新部署" });
  }
  try {
    const body = await request.json();
    const current = body && typeof body.current === "string" ? body.current : "";
    const next = body && typeof body.next === "string" ? body.next : "";
    if (!current) return json({ ok: false, reason: "bad_request", message: "请输入当前密码" }, 400);
    if (next.length < 6) return json({ ok: false, reason: "bad_request", message: "新密码至少 6 位" }, 400);
    const pwd = await resolveAdminPassword(env);
    if (current !== pwd) {
      return json({ ok: false, reason: "denied", message: "当前密码不正确" });
    }
    await env.COOKIE_KV.put("admin_password", next);
    log("[admin] 管理员密码已修改");
    return json({ ok: true });
  } catch (e) {
    log("[handleAdminChangePassword] error:", e.message);
    return json({ ok: false, reason: "error", message: e.message }, 500);
  }
}

async function handleAdminExamples(request, env) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  if (!env.DB || !env.DB.setExamples) {
    return json({ ok: false, reason: "no_db", message: "未连接数据库（当前部署不支持）" });
  }
  if (request.method === "GET") {
    const list = await env.DB.getExamples();
    return json({ ok: true, list: list || [] });
  }
  try {
    const body = await request.json();
    const err = validateExamples(body.list);
    if (err) return json({ ok: false, reason: "bad_request", message: err }, 400);
    await env.DB.setExamples(body.list);
    log("[admin] 示例链接已更新:", body.list.length, "条");
    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, reason: "error", message: e.message }, 500);
  }
}

async function handleAdminAd(request, env) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  if (!env.DB || !env.DB.setAd) {
    return json({ ok: false, reason: "no_db", message: "未连接数据库（当前部署不支持）" });
  }
  if (request.method === "GET") {
    const cfg = await env.DB.getAd();
    return json({ ok: true, ...(cfg || { enabled: false, html: "", position: "footer" }) });
  }
  try {
    const body = await request.json();
    const cfg = {
      enabled: !!body.enabled,
      html: typeof body.html === "string" ? body.html.slice(0, 20000) : "",
      position: body.position === "top" ? "top" : "footer",
    };
    await env.DB.setAd(cfg);
    log("[admin] 广告位已更新, enabled:", cfg.enabled);
    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, reason: "error", message: e.message }, 500);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(), "Content-Type": "application/json" },
  });
}

// 解析请求携带的 cookie：请求体优先 → 全站 KV 覆盖 → 部署时注入的 COOKIE 绑定兜底
// 返回 { value, source }，source 用于留痕（body/kv/env/none）
async function resolveCookieInfo(body, env) {
  const fromBody = body && typeof body.cookie === "string" && body.cookie.trim();
  if (fromBody) return { value: normalizeCookie(fromBody), source: "body" };
  if (env.COOKIE_KV) {
    const stored = await env.COOKIE_KV.get("cookie");
    if (stored) return { value: normalizeCookie(stored), source: "kv" };
  }
  const envCookie = env.COOKIE || "";
  return { value: normalizeCookie(envCookie), source: envCookie ? "env" : "none" };
}

function domainMatches(d, host) {
  if (d.startsWith(".")) return host === d.slice(1) || host.endsWith(d);
  return host === d;
}

// 将 cookie 归一化为合法的 Cookie 请求头
// 支持两种输入：已有的 "a=1; b=2" 请求头格式，或浏览器插件导出的 Netscape Cookie 文件格式
function normalizeCookie(raw) {
  if (!raw) return "";
  const text = String(raw).trim();
  const isNetscape = text.split(/\r?\n/).some((line) => {
    const l = line.trim();
    if (!l || l.startsWith("#")) return false;
    return l.split(/\s+/).length >= 6 && /^(#HttpOnly_)?\.?[^\s]+\s+(TRUE|FALSE)\s+/.test(l);
  });
  if (!isNetscape) return text;

  const host = "yuanbao.tencent.com";
  const now = Date.now() / 1000;
  const map = {};
  let kept = 0;
  for (const line of text.split(/\r?\n/)) {
    const l = line.trim();
    if (!l || l.startsWith("#")) continue;
    const parts = l.split(/\s+/);
    if (parts.length < 6) continue;
    const domain = parts[0].replace(/^#HttpOnly_/, "");
    const expires = Number(parts[4] || 0);
    const name = parts[5];
    const value = parts.slice(6).join(" ");
    if (expires && expires < now) continue; // 已过期
    if (!domainMatches(domain, host)) continue; // 域不适用
    map[name] = value;
    kept++;
  }
  const out = Object.entries(map)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  log(`[normalizeCookie] netscape 格式, 保留 ${kept} 条 cookie`);
  return out;
}

// 检查用的示例分享链接（仅用于验证 cookie 能否通过元宝认证）
const CHECK_COOKIE_URL = "https://weixin.qq.com/sph/Axv548mzBF";

// ---- 频率限制：同一 IP 每天解析次数上限（admin 可在线调整，KV daily_limit） ----

const DEFAULT_DAILY_PARSE_LIMIT = 10;

// 当前生效的限流参数：KV 在线设置优先，回退默认值
async function resolveLimits(env) {
  let dailyLimit = DEFAULT_DAILY_PARSE_LIMIT;
  let anonAsrMinutes = DEFAULT_ANON_ASR_MINUTES;
  let asrCacheMax = DEFAULT_ASR_CACHE_MAX;
  if (env.COOKIE_KV && env.COOKIE_KV.get) {
    const d = Number(await env.COOKIE_KV.get("daily_limit"));
    if (Number.isInteger(d) && d > 0) dailyLimit = d;
    const m = Number(await env.COOKIE_KV.get("anon_asr_minutes"));
    if (Number.isInteger(m) && m > 0) anonAsrMinutes = m;
    const c = Number(await env.COOKIE_KV.get("asr_cache_max"));
    if (Number.isInteger(c) && c > 0) asrCacheMax = c;
  }
  return { dailyLimit, anonAsrMinutes, asrCacheMax };
}

// 按日计数（东八区，与统计页一致）。返回 { allowed, used, remaining }
// KV 未绑定时放行（极简部署）；携带有效管理员 token 的请求不受限
// scope 区分额度池：网页解析（rate）与 MCP 开放访问（ratemcp）互相独立
async function checkDailyParseLimit(request, env, scope = "rate", limit = DEFAULT_DAILY_PARSE_LIMIT) {
  if (!env.COOKIE_KV || !env.COOKIE_KV.get) return { allowed: true, used: 0, remaining: -1 };
  const pwd = await resolveAdminPassword(env);
  if (pwd && (await verifyAdminToken(pwd, bearerToken(request)))) {
    return { allowed: true, used: 0, remaining: -1 };
  }
  const ip = clientIp(request) || "unknown";
  const day = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  const key = `${scope}:${day}:${ip}`;
  const count = Number((await env.COOKIE_KV.get(key)) || 0);
  if (count >= limit) {
    return { allowed: false, used: count, remaining: 0 };
  }
  // 48h 过期：跨天后旧键自动清理（dev server 的文件 KV 忽略过期，键量小可接受）
  await env.COOKIE_KV.put(key, String(count + 1), { expirationTtl: 172800 });
  return { allowed: true, used: count + 1, remaining: limit - count - 1 };
}

// 委婉的超限提示：告知已用次数；MCP 调用者额外提示可申请令牌
function limitMessage(used, limit, forMcp) {
  const base = `今天的免费次数已经用完啦（今天已用 ${used}/${limit} 次），明天再来吧～`;
  return forMcp ? `${base}如需更高额度，可联系站点管理员申请访问令牌。` : base;
}

function clientIp(request) {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-real-ip") ||
    (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
    ""
  );
}

// 解析留痕：记录每次解析请求（成功/失败），供后续分析
function logParse(env, entry) {
  if (env.DB && env.DB.logParse) {
    try {
      env.DB.logParse(entry);
    } catch (e) {
      log("[logParse] error:", e.message);
    }
  }
}

async function handleFetchVideoProfile(request, env) {
  const startedAt = Date.now();
  let shareUrl = "";
  let cookieSource = "";
  try {
    const body = await request.json();
    shareUrl = body.url || "";
    if (!shareUrl) {
      return json({ error: "missing url" }, 400);
    }
    const { dailyLimit } = await resolveLimits(env);
    const limit = await checkDailyParseLimit(request, env, "rate", dailyLimit);
    if (!limit.allowed) {
      logParse(env, {
        ts: Math.floor(startedAt / 1000),
        ip: clientIp(request),
        ua: request.headers.get("user-agent") || "",
        referer: request.headers.get("referer") || "",
        shareUrl,
        exportId: "",
        author: "",
        description: "",
        videoUrl: "",
        ok: 0,
        error: "rate_limited",
        durationMs: Date.now() - startedAt,
        cookieSource: "",
      });
      return json({ error: limitMessage(limit.used, dailyLimit, false), dailyRemaining: 0 });
    }
    const cookieInfo = await resolveCookieInfo(body, env);
    cookieSource = cookieInfo.source;
    const { result, exportId } = await fetchVideoProfile(shareUrl, cookieInfo.value);
    const fi = (result.data && result.data.feedInfo) || {};
    const ai = (result.data && result.data.authorInfo) || {};
    logParse(env, {
      ts: Math.floor(startedAt / 1000),
      ip: clientIp(request),
      ua: request.headers.get("user-agent") || "",
      referer: request.headers.get("referer") || "",
      shareUrl,
      exportId: exportId || "",
      author: ai.nickname || "",
      description: (fi.description || "").slice(0, 500),
      videoUrl: (fi.h264VideoInfo && fi.h264VideoInfo.videoUrl) || (fi.h265VideoInfo && fi.h265VideoInfo.videoUrl) || fi.videoUrl || "",
      ok: 1,
      error: "",
      durationMs: Date.now() - startedAt,
      cookieSource,
    });
    return json({ ...result, dailyRemaining: limit.remaining });
  } catch (err) {
    log("[handleFetchVideoProfile] error:", err.message);
    logParse(env, {
      ts: Math.floor(startedAt / 1000),
      ip: clientIp(request),
      ua: request.headers.get("user-agent") || "",
      referer: request.headers.get("referer") || "",
      shareUrl,
      exportId: "",
      author: "",
      description: "",
      videoUrl: "",
      ok: 0,
      error: err.message.slice(0, 300),
      durationMs: Date.now() - startedAt,
      cookieSource,
    });
    return json({ error: err.message }, 500);
  }
}

async function handleCheckCookie(request, env) {
  try {
    const body = await request.json();
    const { value: cookie } = await resolveCookieInfo(body, env);
    if (!cookie) {
      return json({ valid: false, reason: "no_cookie", message: "未配置 cookie" });
    }
    const parseData = await parseShareUrl(CHECK_COOKIE_URL, cookie);
    return json({ valid: true, exportId: parseData.wx_export_id });
  } catch (err) {
    log("[handleCheckCookie] error:", err.message);
    const invalid = /http 401/.test(err.message);
    return json({
      valid: false,
      reason: invalid ? "invalid_cookie" : "error",
      message: invalid ? "cookie 无效或已过期（元宝返回 401）" : err.message,
    });
  }
}

// ---- admin simple auth ----

const ADMIN_TOKEN_TTL = 12 * 3600; // token 有效期 12 小时

// 当前生效的管理员密码：KV 在线修改优先，回退部署时注入的绑定
async function resolveAdminPassword(env) {
  if (env.COOKIE_KV && env.COOKIE_KV.get) {
    const stored = await env.COOKIE_KV.get("admin_password");
    if (stored) return stored;
  }
  return env.ADMIN_PASSWORD || "";
}

async function hmacHex(key, msg) {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function makeAdminToken(password) {
  const exp = Math.floor(Date.now() / 1000) + ADMIN_TOKEN_TTL;
  const payload = btoa(JSON.stringify({ exp })).replace(/=+$/, "");
  const sig = await hmacHex(password, payload);
  return `${payload}.${sig}`;
}

async function verifyAdminToken(password, token) {
  if (!password || !token) return false;
  try {
    const [payload, sig] = String(token).split(".");
    if (!payload || !sig) return false;
    const expect = await hmacHex(password, payload);
    if (sig !== expect) return false;
    const { exp } = JSON.parse(atob(payload));
    return Number(exp) > Date.now() / 1000;
  } catch (e) {
    return false;
  }
}

function bearerToken(request) {
  const h = request.headers.get("authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7) : "";
}

async function handleAdminAuth(request, env) {
  try {
    const pwd = await resolveAdminPassword(env);
    if (!pwd) {
      return json({ ok: false, reason: "disabled", message: "未配置管理员密码" });
    }
    const body = await request.json();
    const password = body && typeof body.password === "string" ? body.password : "";
    if (!password) return json({ ok: false, reason: "bad_request", message: "缺少密码" }, 400);
    if (password !== pwd) {
      return json({ ok: false, reason: "denied", message: "密码错误" });
    }
    return json({ ok: true, token: await makeAdminToken(pwd) });
  } catch (err) {
    log("[handleAdminAuth] error:", err.message);
    return json({ ok: false, reason: "error", message: err.message }, 500);
  }
}

async function handleAdminCookie(request, env) {
  try {
    const pwd = await resolveAdminPassword(env);
    if (!pwd) {
      return json({ ok: false, reason: "disabled", message: "未配置管理员密码" });
    }
    const authed = await verifyAdminToken(pwd, bearerToken(request));
    if (!authed) return json({ ok: false, reason: "unauthorized", message: "未认证或已过期" }, 401);
    if (!env.COOKIE_KV) {
      if (request.method === "POST") {
        return json({ ok: false, reason: "no_kv", message: "未绑定 KV，无法持久化" });
      }
      return json({ ok: true, configured: false, kv: false });
    }
    if (request.method === "POST") {
      const body = await request.json();
      const cookie = body && typeof body.cookie === "string" ? body.cookie.trim() : "";
      if (!cookie) return json({ ok: false, reason: "bad_request", message: "缺少 cookie" }, 400);
      await env.COOKIE_KV.put("cookie", cookie);
      log("[admin] 全站 cookie 已更新, 长度:", cookie.length);
      return json({ ok: true, persisted: true });
    }
    const stored = await env.COOKIE_KV.get("cookie");
    return json({ ok: true, configured: !!stored, kv: true });
  } catch (err) {
    log("[handleAdminCookie] error:", err.message);
    return json({ ok: false, reason: "error", message: err.message }, 500);
  }
}
