#!/bin/sh
# ============================================================
# KopiX — one-time VPS setup script
# Tested on Ubuntu 22.04 / 24.04
#
# Run as root (or with sudo):
#   curl -fsSL https://raw.githubusercontent.com/chigerartem/KopiX/main/infra/scripts/server-setup.sh | sh
# ============================================================
set -e

echo "=== 1. System update ==="
apt-get update -y && apt-get upgrade -y

echo "=== 2. Install Docker ==="
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
else
  echo "Docker already installed — skipping"
fi

echo "=== 3. Install Docker Compose plugin ==="
apt-get install -y docker-compose-plugin

echo "=== 4. Create deploy directory ==="
mkdir -p /opt/kopix/infra/compose
mkdir -p /opt/kopix/infra/scripts

echo "=== 5. Open firewall ports (80, 443) ==="
if command -v ufw >/dev/null 2>&1; then
  ufw allow 22/tcp   # SSH — keep open!
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw allow 443/udp  # HTTP/3
  ufw --force enable
  echo "ufw rules applied"
else
  echo "ufw not found — configure firewall manually (allow 80, 443, 443/udp)"
fi

echo "=== 6. Enable Docker to start on boot ==="
systemctl enable docker

echo "=== 7. Generate deploy SSH key pair ==="
KEYFILE="/root/.ssh/kopix_deploy"
if [ ! -f "$KEYFILE" ]; then
  ssh-keygen -t ed25519 -C "kopix-deploy@$(hostname)" -f "$KEYFILE" -N ""
  cat "$KEYFILE.pub" >> /root/.ssh/authorized_keys
  chmod 600 /root/.ssh/authorized_keys
  echo ""
  echo ">>> IMPORTANT: Copy the PRIVATE key below into the DEPLOY_SSH_KEY GitHub Secret <<<"
  echo "--------------------------------------------------------------------------"
  cat "$KEYFILE"
  echo "--------------------------------------------------------------------------"
else
  echo "Deploy key already exists at $KEYFILE — skipping generation"
fi

echo ""
echo "=== Setup complete ==="
echo ""
echo "Next steps:"
echo "  1. Add the private key above to GitHub → Settings → Secrets → DEPLOY_SSH_KEY"
echo "  2. Fill in infra/compose/.env.example, rename it to .env"
echo "  3. Run: base64 -w 0 .env > /tmp/prod_env_b64 && cat /tmp/prod_env_b64"
echo "  4. Paste the output into GitHub Secret: PROD_ENV_B64"
echo "  5. Set remaining GitHub Secrets (see docs/DEPLOY.md)"
echo "  6. Push a commit to main branch — GitHub Actions will deploy automatically"
