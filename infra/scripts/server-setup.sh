#!/bin/sh
# ============================================================
# KopiX — one-time VPS setup (Ubuntu 22.04 / 24.04)
#
# Run as root:
#   curl -fsSL https://raw.githubusercontent.com/chigerartem/KopiX/main/infra/scripts/server-setup.sh | sh
#
# After this script: follow docs/DEPLOY.md for clone → .env → start.
# ============================================================
set -e

echo "=== 1. System update ==="
apt-get update -y && apt-get upgrade -y
apt-get install -y curl git ca-certificates gnupg build-essential

echo "=== 2. Node.js 22 LTS ==="
if ! command -v node >/dev/null 2>&1 || [ "$(node -e 'console.log(process.versions.node.split(".")[0])')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
else
  echo "Node.js 22+ already installed — skipping"
fi
echo "Node $(node -v)  |  npm $(npm -v)"

echo "=== 3. pm2 (global) ==="
npm install -g pm2

echo "=== 4. Caddy ==="
if ! command -v caddy >/dev/null 2>&1; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    | tee /etc/apt/sources.list.d/caddy-stable.list
  apt-get update && apt-get install -y caddy
else
  echo "Caddy already installed — skipping"
fi

echo "=== 5. Docker (for Postgres + Redis only) ==="
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
  apt-get install -y docker-compose-plugin
else
  echo "Docker already installed — skipping"
fi

echo "=== 6. Create kopix user ==="
if ! id kopix >/dev/null 2>&1; then
  useradd -m -s /bin/bash kopix
  usermod -aG docker kopix
  echo "User 'kopix' created and added to docker group."
else
  echo "User 'kopix' already exists — skipping"
fi

echo "=== 7. Create backup dir ==="
mkdir -p /var/backups/kopix
chown kopix:kopix /var/backups/kopix

echo "=== 8. Firewall (22, 80, 443) ==="
if command -v ufw >/dev/null 2>&1; then
  ufw allow 22/tcp
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw allow 443/udp   # HTTP/3
  ufw --force enable
  echo "ufw rules applied"
else
  echo "ufw not found — configure firewall manually (allow ports 22, 80, 443)"
fi

echo "=== 9. Enable services on boot ==="
systemctl enable docker
systemctl enable caddy

echo ""
echo "============================================================"
echo "  Setup complete!"
echo "============================================================"
echo ""
echo "Next steps (run as the 'kopix' user):"
echo ""
echo "  su - kopix"
echo "  git clone https://github.com/chigerartem/KopiX.git /opt/kopix"
echo "  cp /opt/kopix/.env.example /opt/kopix/.env"
echo "  nano /opt/kopix/.env          # fill in all values"
echo ""
echo "  cd /opt/kopix"
echo "  docker compose -f infra/compose/docker-compose.data.yml up -d"
echo "  npm ci && npm run build && npm run db:migrate"
echo ""
echo "  sudo cp infra/caddy/Caddyfile /etc/caddy/Caddyfile"
echo "  # ↑ edit it to replace APP_DOMAIN with your actual domain"
echo "  sudo systemctl reload caddy"
echo ""
echo "  pm2 start ecosystem.config.cjs"
echo "  pm2 save"
echo "  pm2 startup systemd -u kopix --hp /home/kopix"
echo "  # ↑ run the sudo command it prints"
echo ""
echo "  npm run webhook:register"
echo ""
echo "  See docs/DEPLOY.md for the full walkthrough."
