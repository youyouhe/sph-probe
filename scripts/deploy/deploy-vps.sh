#!/usr/bin/env bash
# ============================================================
# SPH 视频号探针一键部署脚本（VPS）
#
# 用法:
#   ./deploy-vps.sh user@server-ip [domain]
#   例: ./deploy-vps.sh root@1.2.3.4 sph.smartbid.site
#
# 前置:
#   - VPS（建议 Ubuntu 22.04+ / Debian 12+，香港/日本机房）
#   - 已配置 SSH 免密登录（或输入密码）
#   - 远程用户需有 sudo 权限（NOPASSWD 最佳，脚本自动以 sudo 执行特权命令）
#   - DNS 已添加 A 记录: <domain> -> VPS IP（Cloudflare 代理模式亦可）
#
# 脚本行为:
#   1. 本地打包源码（排除 .git / data / node_modules）
#   2. 上传；若缺 Node 22+ 或 nginx 则自动安装（node:sqlite 依赖）
#   3. 创建 /opt/sph + 专用用户 + 随机 admin 密码(.env)
#   4. 安装 nginx 反代 + systemd 开机自启
#   5. 输出部署摘要（含 admin 密码，请立即保存）
#   6. HTTPS：Cloudflare 代理模式已自带边缘证书，无需 certbot
# ============================================================
set -euo pipefail

HOST="${1:?用法: deploy-vps.sh user@server-ip [domain]}"
DOMAIN="${2:-sph.smartbid.site}"
REMOTE_DIR=/opt/sph
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

echo "==> 本地打包源码..."
TMP="$(mktemp -d)"
tar czf "$TMP/sph.tar.gz" -C "$ROOT" \
  --exclude=.git \
  --exclude=data \
  --exclude=node_modules \
  --exclude=docs/node_modules \
  --exclude='*.log' \
  .

echo "==> 上传到 $HOST ..."
scp "$TMP/sph.tar.gz" "$HOST:/tmp/sph.tar.gz"

echo "==> 远程安装（sudo 执行）..."
ssh "$HOST" "sudo bash -s '$DOMAIN' '$REMOTE_DIR'" <<'REMOTE'
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
DOMAIN="${1:?}"
REMOTE_DIR="${2:?}"

# --- Node 22+ ---
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 22 ]; then
  echo "--> 安装 Node 22 ..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
echo "--> Node: $(node -v)"

# --- nginx ---
if ! command -v nginx >/dev/null 2>&1; then
  echo "--> 安装 nginx ..."
  apt-get install -y nginx
fi

# --- ffmpeg（ASR 抽取音频 / yt-dlp 合并音视频流） ---
if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "--> 安装 ffmpeg ..."
  apt-get install -y ffmpeg
fi

# --- 部署目录与用户 ---
id -u sph >/dev/null 2>&1 || useradd -r -m -d "$REMOTE_DIR" sph
mkdir -p "$REMOTE_DIR/data"

echo "--> 解压源码 ..."
tar xzf /tmp/sph.tar.gz -C "$REMOTE_DIR"

# --- .env（首次生成随机 admin 密码） ---
if [ ! -f "$REMOTE_DIR/.env" ]; then
  # 注意: 不能用 tr|head 管道生成随机串（pipefail 下 head 提前退出会误杀脚本）
  ADMIN_PASS="$(tr -d '-' < /proc/sys/kernel/random/uuid | head -c 16)"
  cat > "$REMOTE_DIR/.env" <<ENV
SPH_ADMIN_PASSWORD=$ADMIN_PASS
SPH_DB=$REMOTE_DIR/data/sph.db
SPH_KV=$REMOTE_DIR/data/kv.json
# SILICONFLOW_API_KEY=sk-xxx   # 可选：ASR 转文字（也可部署后在 /admin 在线配置）
ENV
  echo "ADMIN_PASSWORD=$ADMIN_PASS" > "$REMOTE_DIR/.admin_password"
  chmod 600 "$REMOTE_DIR/.admin_password"
  echo "--> 已生成随机 admin 密码: $ADMIN_PASS（保存在 $REMOTE_DIR/.admin_password）"
fi
chown -R sph:sph "$REMOTE_DIR"
chmod 755 "$REMOTE_DIR/scripts/sph-dev-server.mjs"

# --- systemd ---
echo "--> 配置 systemd ..."
cp "$REMOTE_DIR/scripts/deploy/sph-probe.service" /etc/systemd/system/sph-probe.service
systemctl daemon-reload
systemctl enable sph-probe
systemctl restart sph-probe
sleep 1
systemctl --no-pager -l status sph-probe | head -8 || true

# --- 反向代理：优先复用已有 Caddy，否则用 nginx ---
if command -v caddy >/dev/null 2>&1; then
  echo "--> 配置 Caddy ..."
  CADDYFILE=/etc/caddy/Caddyfile
  # 确保自定义日志可写（Caddy 以 caddy 用户运行）
  mkdir -p /var/log/caddy && touch /var/log/caddy/sph.log && chown caddy:caddy /var/log/caddy/sph.log
  if ! grep -q "$DOMAIN" "$CADDYFILE"; then
    cat >> "$CADDYFILE" <<CADDY_BLOCK

# SPH 视频号探针（Caddy 自动 HTTPS；Cloudflare 代理 SSL 模式请用 Full）
$DOMAIN {
    reverse_proxy 127.0.0.1:8787
    encode gzip
    log {
        output file /var/log/caddy/sph.log
    }
}
CADDY_BLOCK
  fi
  caddy validate --config "$CADDYFILE" --adapter caddyfile
  systemctl restart caddy || systemctl reload caddy || true
else
  echo "--> 配置 nginx ..."
  sed "s/__DOMAIN__/$DOMAIN/g" "$REMOTE_DIR/scripts/deploy/nginx-sph-probe.conf" > /etc/nginx/sites-available/sph-probe
  ln -sf /etc/nginx/sites-available/sph-probe /etc/nginx/sites-enabled/sph-probe
  nginx -t
  systemctl enable nginx >/dev/null 2>&1 || true
  systemctl restart nginx
fi

rm -f /tmp/sph.tar.gz
echo "==> 部署完成"
REMOTE

rm -rf "$TMP"

echo ""
echo "=============================================="
echo "  部署摘要"
echo "=============================================="
echo "  站点:   https://$DOMAIN/  (Cloudflare 代理 + 边缘 HTTPS)"
echo "  管理:   https://$DOMAIN/admin"
echo "  密码:   ssh $HOST 'sudo cat $REMOTE_DIR/.admin_password'"
echo ""
echo "  下一步:"
echo "  1. 浏览器打开 /admin 登录，设置全站 Cookie（管理面板 → 保存并检查）"
echo "  2. 若未使用 Cloudflare 代理，需自行配置 HTTPS (certbot --nginx -d $DOMAIN)"
echo "  3. 如启用 ufw 防火墙: sudo ufw allow 80/tcp && sudo ufw allow 443/tcp"
echo "=============================================="
