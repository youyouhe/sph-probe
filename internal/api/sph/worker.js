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
      return handleAsr(request, env);
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
    if (ytNotAvailable(env)) {
      return json({ ok: false, error: "当前部署不支持 YouTube（需 VPS + yt-dlp）" });
    }
    if (!isYtUrl(shareUrl)) {
      return json({ ok: false, error: "仅支持 YouTube 链接" });
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
    return json({ ok: true, downloadEnabled: !YT_DOWNLOAD_DISABLED, ...info });
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
    if (YT_DOWNLOAD_DISABLED) {
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

async function handleAsr(request, env) {
  const startedAt = Date.now();
  let videoUrl = "";
  try {
    const body = await request.json();
    videoUrl = body && typeof body.url === "string" ? body.url.trim() : "";
    const exportId = body && typeof body.exportId === "string" ? body.exportId.trim() : "";
    // 前端拿不到 exportId 时用分享链接做缓存键（同一视频直链每次解析都会变，分享链接稳定）
    const shareUrl = body && typeof body.shareUrl === "string" ? body.shareUrl.trim() : "";
    if (!/^https?:\/\//i.test(videoUrl)) {
      return json({ ok: false, reason: "bad_request", error: "url 参数不合法" }, 400);
    }
    const { apiKey, model } = await resolveAsrConfig(env);
    if (!apiKey) {
      return json({ ok: false, reason: "no_key", error: "未配置 ASR API key（管理员可在 /admin 设置，或部署时注入 SILICONFLOW_API_KEY）" });
    }

    // 缓存：同一视频不重复扣费
    const cacheId = exportId || shareUrl || (await sha256Hex(videoUrl));
    const cacheKey = `asr:${model}:${cacheId}`;
    if (env.COOKIE_KV && env.COOKIE_KV.get) {
      const cached = await env.COOKIE_KV.get(cacheKey);
      if (cached) {
        return json({ ok: true, text: cached, model, cached: true });
      }
    }

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
      if (size > ASR_MAX_BYTES) {
        return json({ ok: false, reason: "too_large", error: "视频超过 25MB，当前部署无法转写（VPS 部署可通过 ffmpeg 压缩音频，不受此限）" });
      }
      bytes = await resp.arrayBuffer();
      if (bytes.byteLength > ASR_MAX_BYTES) {
        return json({ ok: false, reason: "too_large", error: "视频超过 25MB，当前部署无法转写（VPS 部署可通过 ffmpeg 压缩音频，不受此限）" });
      }
      filename = "video.mp4";
    }

    const text = await transcribeViaSiliconFlow(bytes, filename, apiKey, model);
    if (env.COOKIE_KV && env.COOKIE_KV.put && text) {
      await env.COOKIE_KV.put(cacheKey, text);
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
    return json({ ok: true, text, model, cached: false });
  } catch (err) {
    log("[handleAsr] error:", err.message);
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
    return json({ ok: false, reason: "error", error: err.message.slice(0, 300) });
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
    return json(result);
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
