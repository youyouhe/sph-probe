# sph-probe · 视频号探针

微信视频号 / YouTube 分享链接解析站点。粘贴分享链接，解析出视频信息（作者、描述、清晰度、直链），支持在线预览与下载。

可以作为 **Cloudflare Worker** 部署，也可以用内置的 Node 开发服务器直接跑在 **VPS** 上（同一套代码，零依赖）。

## 功能

- **视频号解析**：粘贴 `https://weixin.qq.com/sph/...` 分享链接 → 标题、作者、封面、多清晰度直链
- **语音转文字（ASR）**：解析后一键转写视频语音，走 SiliconFlow（默认 `TeleAI/TeleSpeechASR`，可切 `FunAudioLLM/SenseVoiceSmall`），结果按视频缓存不重复扣费
- **YouTube 解析**：通过 yt-dlp 解析视频信息与清晰度（VPS 模式；下载中转默认关闭，`YT_DOWNLOAD_DISABLED` 开关）
- **管理后台** `/admin`：密码认证 → 在线更新全站 Cookie、YouTube cookies、示例链接、广告位、修改密码
- **统计页** `/stats`：解析量趋势、成功率、来源分布（数据来自 parse_logs）
- **示例链接 / 广告位**：首页内容运营位，后台可配

## 目录结构

```
internal/api/sph/     站点源码（worker.js / index.html / stats.html）
scripts/
  sph-dev-server.mjs  本地/VPS 服务器：模拟 Worker 运行时，改文件刷新即生效
  update-ytdlp.sh     yt-dlp 每日自动更新（cron）
  wasm-monitor.mjs    腾讯 decrypt-video-core wasm 版本/结构变更监控（cron）
  deploy/             VPS 一键部署（systemd + nginx）
build/icon.png        站点图标（部署时内联为 base64）
```

## 本地开发

```bash
# 无需任何依赖，Node 22+（用到 node:sqlite）
node scripts/sph-dev-server.mjs            # http://127.0.0.1:8787

# 带真实 Cookie 即可真实解析（元宝 Web 端 Cookie）
SPH_COOKIE="你的元宝cookie" node scripts/sph-dev-server.mjs

# 启用 /admin 管理入口
SPH_ADMIN_PASSWORD="管理密码" node scripts/sph-dev-server.mjs
```

修改 `index.html` / `worker.js` 后刷新浏览器即生效（每次请求重新构建模块）。

环境变量：

| 变量 | 说明 |
|------|------|
| `SPH_COOKIE` | 视频号接口所需的元宝 Web 端 Cookie |
| `SPH_ADMIN_PASSWORD` | 管理员密码，设置后启用 `/admin` |
| `SILICONFLOW_API_KEY` | SiliconFlow API Key，启用 ASR 转文字（也可在 `/admin` 在线配置） |
| `SPH_KV` / `SPH_DB` | KV / SQLite 数据文件路径（默认 `data/`） |
| `HOST` / `PORT` | 监听地址，默认 `0.0.0.0:8787` |

> ASR 依赖 ffmpeg 抽取音频（VPS 部署脚本会自动装；本地需自行安装）。Cloudflare Worker 模式直接上传原视频，超过 25MB 无法转写。

## VPS 部署

```bash
./scripts/deploy/deploy-vps.sh root@服务器IP your-domain.com
```

脚本会自动：安装 Node 22+ 与 nginx → 创建 `/opt/sph` 与专用用户 → 生成随机 admin 密码 → 配置 systemd 开机自启 + nginx 反代。建议搭配 cron：

```cron
0 8 * * * node /opt/sph/scripts/wasm-monitor.mjs >> /var/log/sph-wasm-monitor.log 2>&1
30 3 * * * /opt/sph/scripts/update-ytdlp.sh
```

## Cloudflare Worker 部署

`worker.js` 是标准 Worker 模块，部署时把 `index.html`、`stats.html`、`build/icon.png`（base64）作为附加模块上传即可。绑定：

| 绑定 | 类型 | 说明 |
|------|------|------|
| `COOKIE` | plain text | 元宝 Web 端 Cookie（必填） |
| `ADMIN_PASSWORD` | plain text | 管理员密码（可选，启用 `/admin`） |
| `COOKIE_KV` | KV namespace | 全站 Cookie 在线更新（可选） |
| `SILICONFLOW_API_KEY` | plain text | SiliconFlow API Key（可选，ASR 转文字；也可在 `/admin` 配置） |

> 本项目衍生于 [ltaoo/wx_channels_download](https://github.com/ltaoo/wx_channels_download) 的 sph 命令，解析逻辑对应其 `fetch_video_profile.go`。
