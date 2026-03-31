#!/bin/bash
set -e

# ── My Shop — Install Script ──────────────────────────────────────────────────
# Installs the shopping list app on a fresh Ubuntu LXC
# Usage: curl -fsSL https://raw.githubusercontent.com/wazzabooth/shopping-list/main/install.sh | bash

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}"
echo "  ____  _                       _             _     _     _  "
echo " / ___|| |__   ___  _ __  _ __ (_)_ __   __ _| |   (_)___| |_"
echo " \___ \| '_ \ / _ \| '_ \| '_ \| | '_ \ / _\` | |   | / __| __|"
echo "  ___) | | | | (_) | |_) | |_) | | | | | (_| | |___| \__ \ |_"
echo " |____/|_| |_|\___/| .__/| .__/|_|_| |_|\__, |_____|_|___/\__|"
echo "                   |_|   |_|             |___/                 "
echo -e "${NC}"
echo -e "${GREEN}🛒 My Shop — Self-Hosted Shopping List${NC}"
echo ""

# ── Check root ────────────────────────────────────────────────────────────────
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}Please run as root${NC}"
  exit 1
fi

# ── Prompt for config ─────────────────────────────────────────────────────────
echo -e "${YELLOW}Configuration${NC}"
echo ""

read -p "Domain (e.g. shopping.yourdomain.com): " DOMAIN
read -p "JWT secret (leave blank to auto-generate): " JWT_SECRET
if [ -z "$JWT_SECRET" ]; then
  JWT_SECRET=$(cat /dev/urandom | tr -dc 'a-zA-Z0-9' | fold -w 40 | head -n 1)
  echo -e "  Generated JWT secret: ${CYAN}${JWT_SECRET}${NC}"
fi
read -p "Install directory [/opt/shopping-list]: " INSTALL_DIR
INSTALL_DIR=${INSTALL_DIR:-/opt/shopping-list}
read -p "Port [3000]: " PORT
PORT=${PORT:-3000}

echo ""
echo -e "${YELLOW}Installing...${NC}"
echo ""

# ── Install Node.js ───────────────────────────────────────────────────────────
echo -e "→ Installing Node.js 20..."
if ! command -v node &> /dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - > /dev/null 2>&1
  apt-get install -y nodejs > /dev/null 2>&1
  echo -e "  ${GREEN}✓ Node.js $(node --version) installed${NC}"
else
  echo -e "  ${GREEN}✓ Node.js $(node --version) already installed${NC}"
fi

# ── Clone repo ────────────────────────────────────────────────────────────────
echo -e "→ Downloading app..."
if [ -d "$INSTALL_DIR" ]; then
  echo -e "  ${YELLOW}⚠ Directory exists — backing up to ${INSTALL_DIR}.bak${NC}"
  mv "$INSTALL_DIR" "${INSTALL_DIR}.bak"
fi

apt-get install -y git > /dev/null 2>&1
git clone https://github.com/wazzabooth/shopping-list.git "$INSTALL_DIR" > /dev/null 2>&1
echo -e "  ${GREEN}✓ Downloaded to ${INSTALL_DIR}${NC}"

# ── Install dependencies ──────────────────────────────────────────────────────
echo -e "→ Installing dependencies..."
cd "$INSTALL_DIR"
npm install --omit=dev > /dev/null 2>&1
echo -e "  ${GREEN}✓ Dependencies installed${NC}"

# ── Systemd service ───────────────────────────────────────────────────────────
echo -e "→ Creating systemd service..."
cat > /etc/systemd/system/shopping-list.service << UNIT
[Unit]
Description=My Shop — Shopping List
After=network.target

[Service]
WorkingDirectory=${INSTALL_DIR}
ExecStart=/usr/bin/node ${INSTALL_DIR}/server.js
Restart=always
RestartSec=5
User=root
Environment=PORT=${PORT}
Environment=JWT_SECRET=${JWT_SECRET}

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable shopping-list > /dev/null 2>&1
systemctl start shopping-list
sleep 2

if systemctl is-active --quiet shopping-list; then
  echo -e "  ${GREEN}✓ Service running${NC}"
else
  echo -e "  ${RED}✗ Service failed to start — check: journalctl -u shopping-list -n 20${NC}"
  exit 1
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}✅ Installation complete!${NC}"
echo ""
echo -e "  ${CYAN}Web UI:${NC}     http://$(hostname -I | awk '{print $1}'):${PORT}"
if [ -n "$DOMAIN" ]; then
echo -e "  ${CYAN}Public URL:${NC} https://${DOMAIN}"
fi
echo -e "  ${CYAN}Login:${NC}      username: user  password: user"
echo ""
echo -e "  ${YELLOW}⚠ You will be prompted to change your credentials on first login${NC}"
echo ""
if [ -n "$DOMAIN" ]; then
echo -e "  Next steps:"
echo -e "  1. Point your Cloudflare Tunnel at http://$(hostname -I | awk '{print $1}'):${PORT}"
echo -e "  2. Set up your Alexa skill using the README"
echo -e "  3. Open https://${DOMAIN} and log in"
fi
echo ""
