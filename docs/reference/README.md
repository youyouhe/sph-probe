# 参考存档

本目录存放生产环境（doscan-hub `/opt/sph`）的历史遗留文件，不参与构建与部署。

## 来源说明

sph-probe 最初是在上游开源项目
[ltaoo/wx_channels_download](https://github.com/ltaoo/wx_channels_download)
（微信视频号下载器，Go 语言，License 为非标准许可）的源码树内开发的：
`internal/api/sph/` 与 `scripts/sph-dev-server.mjs` 均创建于该源码树中，
后抽取为本仓库。上游源码树已于 2026-08-21 从生产环境移除
（移除前整树归档于生产机 `/root/sph-backup-20260821.tar.gz`）。

## 文件清单

| 文件 | 说明 |
| --- | --- |
| `sph.go.txt` | 手写的 cobra 子命令 `sph_deploy`（2026-08-06），依赖上游 Go 树的 `wx_channel/pkg/cloudflare/worker`，可将 `internal/api/sph/` 部署到 Cloudflare Worker。仅作存档；如需部署 CF Worker，建议改用 wrangler。 |
| `sph-cli.md.txt` | `sph_deploy` 命令的使用文档（与上条配套）。 |

注意：两个文件仅在上游 Go 源码树内可用，本仓库不包含其依赖。
