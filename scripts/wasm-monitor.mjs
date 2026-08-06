#!/usr/bin/env node
/**
 * decrypt-video-core wasm 版本监控
 *
 * 背景: 微信视频号前端解密依赖 res.wx.qq.com 托管的 decrypt-video-core wasm。
 * 腾讯升级该组件时版本号变化；若算法变更，wasm 结构（导出符号表）与
 * "WxIsaac64" 类指纹（embind 数据段）会随之改变——这两项都可以离线检测，
 * 无需运行 wasm（Node 无法直接跑浏览器版 Emscripten glue）。
 *
 * 用法:
 *   node scripts/wasm-monitor.mjs            # 常规检查（cron 用）
 *   node scripts/wasm-monitor.mjs --json     # 机器可读输出
 *   node scripts/wasm-monitor.mjs --analyze 1.4.0   # 强制分析指定版本（调试用）
 *
 * 退出码:
 *   0 = 无新版本，或新版本结构与算法组件未变（仅重编译）
 *   1 = 分析失败（网络/解析错误）
 *   2 = 检测到可能的结构/算法变更（需要人工确认）
 *
 * 部署建议: cron 每天一次
 *   0 8 * * * node /opt/sph/scripts/wasm-monitor.mjs >> /var/log/sph-wasm-monitor.log 2>&1
 */
import { createHash } from "node:crypto";

const BASE = {
  version: "1.3.0",
  sha256: "dca796bacec37d8522c7983b3945e5d579bd74164e3b21f0ebc773be6dfc8b6e",
  size: 3785516,
  exportsHash: null, // 运行时计算
  hasIsaac: true, // wasm 数据段包含 "WxIsaac64"（embind 类指纹）
};
const BASE_URL = "https://res.wx.qq.com/t/wx_fed/cdn_libs/res/decrypt-video-core";
const ISAAC_MARKER = "WxIsaac64";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/148.0.0.0 Safari/537.36";
const json = process.argv.includes("--json");
const analyzeVersion = process.argv.indexOf("--analyze") >= 0 ? process.argv[process.argv.indexOf("--analyze") + 1] : null;

function log(msg) {
  if (!json) console.log(msg);
}
function jsonOut(obj) {
  if (json) console.log(JSON.stringify(obj));
}

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

/* ---------- wasm 离线特征提取 ---------- */
function analyzeWasm(buf) {
  let mod;
  try {
    mod = new WebAssembly.Module(buf);
  } catch (e) {
    return { error: "wasm 解析失败: " + e.message.slice(0, 120) };
  }
  const exports = WebAssembly.Module.exports(mod).map((e) => e.name).sort();
  const imports = WebAssembly.Module.imports(mod).map((i) => `${i.module}.${i.name}`).sort();
  return {
    size: buf.length,
    sha256: sha256(buf),
    hasIsaac: buf.includes(ISAAC_MARKER),
    exportsCount: exports.length,
    importsCount: imports.length,
    exportsHash: sha256(Buffer.from(exports.join("\n"))),
    importsHash: sha256(Buffer.from(imports.join("\n"))),
  };
}

/* ---------- 版本探测 ---------- */
function genCandidates(baseVersion) {
  const [major, minor, patch] = baseVersion.split(".").map(Number);
  const out = [];
  for (let p = patch + 1; p <= 9; p++) out.push(`${major}.${minor}.${p}`);
  for (let m = minor + 1; m <= 9; m++) for (let p = 0; p <= 9; p++) out.push(`${major}.${m}.${p}`);
  for (let M = major + 1; M <= 2; M++) out.push(`${M}.0.0`);
  return out;
}

async function versionExists(v) {
  const url = `${BASE_URL}/${v}/wasm_video_decode.wasm`;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    const resp = await fetch(url, { method: "HEAD", headers: { "User-Agent": UA }, signal: ctl.signal });
    clearTimeout(timer);
    return resp.ok;
  } catch (e) {
    return false; // 网络抖动视为不存在，下次再查
  }
}

// 并发探测（res.wx.qq.com 响应较慢，串行会超时）
async function findLatestVersion(candidates) {
  const CONCURRENCY = 10;
  let latest = null;
  for (let i = 0; i < candidates.length; i += CONCURRENCY) {
    const chunk = candidates.slice(i, i + CONCURRENCY);
    const results = await Promise.all(chunk.map(async (v) => ({ v, ok: await versionExists(v) })));
    for (const { v, ok } of results) {
      if (ok) latest = v;
    }
  }
  return latest;
}

async function downloadWasm(v) {
  const url = `${BASE_URL}/${v}/wasm_video_decode.wasm`;
  const resp = await fetch(url, { headers: { "User-Agent": UA } });
  if (!resp.ok) throw new Error(`下载失败 HTTP ${resp.status}`);
  return Buffer.from(await resp.arrayBuffer());
}

/* ---------- 判定 ---------- */
function classify(base, info) {
  if (info.error) return { level: 1, message: info.error };
  if (!info.hasIsaac) {
    return { level: 2, message: `⚠️ WxIsaac64 类指纹缺失——解密组件可能被移除或改名，算法很可能已变更` };
  }
  if (info.exportsHash !== base.exportsHash || info.importsHash !== base.importsHash) {
    return {
      level: 2,
      message: `⚠️ wasm 导入/导出结构变化（exports ${base.exportsCount}→${info.exportsCount}, imports ${base.importsCount}→${info.importsCount}）——接口或算法可能变更，需要人工分析`,
    };
  }
  if (info.sha256 !== base.sha256) {
    return {
      level: 0,
      message: `ℹ️ 结构未变但字节不同（size ${base.size}→${info.size}）——大概率仅重新编译/优化，算法应未变。建议抽查密钥流一致性`,
    };
  }
  return { level: 0, message: "与基线完全一致" };
}

/* ---------- 主流程 ---------- */
try {
  // 1. 分析基线版本（运行时提取特征，避免硬编码误差）
  log(`[${new Date().toISOString()}] 分析基线版本 ${BASE.version}...`);
  const baseBuf = await downloadWasm(BASE.version);
  const base = analyzeWasm(baseBuf);
  if (base.error) throw new Error("基线分析失败: " + base.error);
  if (base.sha256 !== BASE.sha256) {
    log(`⚠️ 注意: 基线版本 ${BASE.version} 的 sha256 与内置记录不一致——腾讯可能重新发布了旧版本`);
  }
  const baseInfo = { ...BASE, ...base };

  let targetVersion = analyzeVersion;
  let reason = "强制分析指定版本";

  if (!targetVersion) {
    // 2. 并发向上探测新版本
    let latest = null;
    latest = await findLatestVersion(genCandidates(BASE.version));
    if (!latest) {
      log(`[${new Date().toISOString()}] OK: 未发现 decrypt-video-core 新版本（基线 ${BASE.version}）`);
      jsonOut({ ok: true, status: "no_update", baseline: BASE.version, checkedAt: new Date().toISOString() });
      process.exit(0);
    }
    targetVersion = latest;
    reason = `探测到新版本 ${latest}`;
  }

  log(`[${new Date().toISOString()}] ${reason}，下载分析中...`);
  const buf = await downloadWasm(targetVersion);
  const info = analyzeWasm(buf);
  const verdict = classify(baseInfo, info);

  log(`版本:      ${targetVersion}`);
  log(`大小:      ${info.size} (基线 ${baseInfo.size})`);
  log(`sha256:    ${info.sha256}`);
  log(`WxIsaac64: ${info.hasIsaac ? "存在" : "缺失!!!"}`);
  log(`导出:      ${info.exportsCount} (基线 ${baseInfo.exportsCount})`);
  log(`导入:      ${info.importsCount} (基线 ${baseInfo.importsCount})`);
  log(`结论:      ${verdict.message}`);
  if (verdict.level >= 2) {
    log("");
    log("人工分析步骤:");
    log("  1. 下载: curl -O https://res.wx.qq.com/t/wx_fed/cdn_libs/res/decrypt-video-core/" + targetVersion + "/wasm_video_decode.js");
    log("  2. 对比 1.3.0 的 WxIsaac64 构造/生成逻辑（wasm2wat 反编译或对比 embind 注册参数）");
    log("  3. 若算法变更，需同步更新 pkg/decrypt 的 Go 实现");
  }
  jsonOut({ ok: verdict.level === 0, status: verdict.level >= 2 ? "algorithm_change" : verdict.level === 1 ? "analysis_error" : "recompiled", version: targetVersion, baseline: BASE.version, ...info, verdict: verdict.message, checkedAt: new Date().toISOString() });
  process.exit(verdict.level);
} catch (e) {
  log(`[${new Date().toISOString()}] 错误: ${e.message}`);
  jsonOut({ ok: false, status: "error", error: e.message, checkedAt: new Date().toISOString() });
  process.exit(1);
}
