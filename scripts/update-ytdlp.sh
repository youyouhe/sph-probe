#!/usr/bin/env bash
# yt-dlp 自动更新（YouTube 风控补丁更新频繁，需保持最新）
# 由 cron 每天调用；日志写入 /opt/sph/data/yt-dlp-update.log（自动滚动 200 行）
set -u

LOG=/opt/sph/data/yt-dlp-update.log
OLD=$(yt-dlp --version 2>/dev/null || echo "none")

echo "[$(date '+%F %T')] 更新前: $OLD" >>"$LOG"
if sudo pip3 install -q -U yt-dlp 2>>"$LOG"; then
  NEW=$(yt-dlp --version 2>/dev/null || echo "unknown")
  echo "[$(date '+%F %T')] 更新后: $NEW" >>"$LOG"
  if [ "$OLD" != "$NEW" ]; then
    echo "[$(date '+%F %T')] yt-dlp 已更新: $OLD -> $NEW（建议抽查 YouTube 解析）" >>"$LOG"
  fi
else
  echo "[$(date '+%F %T')] 更新失败（查看上方 pip 错误）" >>"$LOG"
fi

# 日志滚动
tail -200 "$LOG" >"$LOG.tmp" 2>/dev/null && mv "$LOG.tmp" "$LOG"
