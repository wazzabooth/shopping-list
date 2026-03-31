#!/bin/bash
set -e

# ── My Shop — Update Script ───────────────────────────────────────────────────
# Updates the shopping list app to the latest version from GitHub
# Usage: bash /opt/shopping-list/update.sh

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${CYAN}🛒 My Shop — Update${NC}"
echo ""

# ── Check root ────────────────────────────────────────────────────────────────
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}Please run as root${NC}"
  exit 1
fi

INSTALL_DIR=${1:-/opt/shopping-list}

if [ ! -d "$INSTALL_DIR" ]; then
  echo -e "${RED}Directory not found: ${INSTALL_DIR}${NC}"
  echo "Usage: bash update.sh [install-dir]"
  exit 1
fi

cd "$INSTALL_DIR"

# ── Check git ─────────────────────────────────────────────────────────────────
if [ ! -d ".git" ]; then
  echo -e "${RED}Not a git repo — cannot update. Re-run install.sh instead.${NC}"
  exit 1
fi

# ── Backup data files ─────────────────────────────────────────────────────────
echo -e "→ Backing up data..."
BACKUP_DIR="/tmp/shopping-list-backup-$(date +%Y%m%d%H%M%S)"
mkdir -p "$BACKUP_DIR"
[ -f auth.json   ] && cp auth.json   "$BACKUP_DIR/"
[ -f stats.json  ] && cp stats.json  "$BACKUP_DIR/"
[ -f shopping.db ] && cp shopping.db "$BACKUP_DIR/"
echo -e "  ${GREEN}✓ Data backed up to ${BACKUP_DIR}${NC}"

# ── Pull latest ───────────────────────────────────────────────────────────────
echo -e "→ Pulling latest version..."
CURRENT=$(git rev-parse --short HEAD)
git pull origin main > /dev/null 2>&1
NEW=$(git rev-parse --short HEAD)

if [ "$CURRENT" = "$NEW" ]; then
  echo -e "  ${YELLOW}Already up to date (${CURRENT})${NC}"
else
  echo -e "  ${GREEN}✓ Updated ${CURRENT} → ${NEW}${NC}"
fi

# ── Restore data files ────────────────────────────────────────────────────────
echo -e "→ Restoring data..."
[ -f "$BACKUP_DIR/auth.json"   ] && cp "$BACKUP_DIR/auth.json"   .
[ -f "$BACKUP_DIR/stats.json"  ] && cp "$BACKUP_DIR/stats.json"  .
[ -f "$BACKUP_DIR/shopping.db" ] && cp "$BACKUP_DIR/shopping.db" .
echo -e "  ${GREEN}✓ Data restored${NC}"

# ── Install any new dependencies ──────────────────────────────────────────────
echo -e "→ Updating dependencies..."
npm install --omit=dev > /dev/null 2>&1
echo -e "  ${GREEN}✓ Dependencies up to date${NC}"

# ── Restart service ───────────────────────────────────────────────────────────
echo -e "→ Restarting service..."
systemctl restart shopping-list
sleep 2

if systemctl is-active --quiet shopping-list; then
  echo -e "  ${GREEN}✓ Service running${NC}"
else
  echo -e "  ${RED}✗ Service failed — check: journalctl -u shopping-list -n 20${NC}"
  echo -e "  ${YELLOW}Your data is backed up at: ${BACKUP_DIR}${NC}"
  exit 1
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}✅ Update complete!${NC}"
echo ""
