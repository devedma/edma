#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# EDMA Branding — Apply to Blockscout Explorer
# ═══════════════════════════════════════════════════════════════
#
# Usage: bash apply-branding.sh
# Run from: ~/Projects/edma-l2/blockscout/docker-compose
#
# This script:
# 1. Updates common-frontend.env with EDMA branding
# 2. Restarts the frontend container
# ═══════════════════════════════════════════════════════════════

set -e

ENVFILE="envs/common-frontend.env"

if [ ! -f "$ENVFILE" ]; then
  echo "✗ Cannot find $ENVFILE"
  echo "  Run this script from ~/Projects/edma-l2/blockscout/docker-compose"
  exit 1
fi

echo "═══════════════════════════════════════════════════════════"
echo "  Applying EDMA branding to Blockscout"
echo "═══════════════════════════════════════════════════════════"

# ─── Raw GitHub URLs for assets ─────────────────────────────────
LOGO_LIGHT="https://raw.githubusercontent.com/devedma/edma/main/docs/branding/edma-logo-light.svg"
LOGO_DARK="https://raw.githubusercontent.com/devedma/edma/main/docs/branding/edma-logo-dark.svg"
ICON="https://raw.githubusercontent.com/devedma/edma/main/docs/branding/edma-icon.svg"
ICON_DARK="https://raw.githubusercontent.com/devedma/edma/main/docs/branding/edma-icon-dark.svg"

# ─── Function: set or add env var ─────────────────────────────
set_env() {
  local key="$1"
  local value="$2"
  if grep -q "^${key}=" "$ENVFILE" 2>/dev/null; then
    # Replace existing (macOS-compatible sed)
    sed -i '' "s|^${key}=.*|${key}=${value}|" "$ENVFILE"
    echo "  ✓ Updated: ${key}"
  elif grep -q "^#.*${key}=" "$ENVFILE" 2>/dev/null; then
    # Uncomment and set
    sed -i '' "s|^#.*${key}=.*|${key}=${value}|" "$ENVFILE"
    echo "  ✓ Uncommented: ${key}"
  else
    # Add new
    echo "${key}=${value}" >> "$ENVFILE"
    echo "  ✓ Added: ${key}"
  fi
}

# ─── Apply EDMA branding ─────────────────────────────────────

echo ""
echo "── Network Identity ──"
set_env "NEXT_PUBLIC_NETWORK_NAME" "EDMA"
set_env "NEXT_PUBLIC_NETWORK_SHORT_NAME" "EDMA"
set_env "NEXT_PUBLIC_NETWORK_ID" "741"
set_env "NEXT_PUBLIC_IS_TESTNET" "true"

echo ""
echo "── Logos ──"
set_env "NEXT_PUBLIC_NETWORK_LOGO" "${LOGO_LIGHT}"
set_env "NEXT_PUBLIC_NETWORK_LOGO_DARK" "${LOGO_DARK}"
set_env "NEXT_PUBLIC_NETWORK_ICON" "${ICON}"
set_env "NEXT_PUBLIC_NETWORK_ICON_DARK" "${ICON_DARK}"

echo ""
echo "── Hero Banner (homepage) ──"
# Navy gradient with amber accent line — EDMA brand colors
# Note: # must be escaped in env files for Blockscout
set_env "NEXT_PUBLIC_HOMEPAGE_PLATE_BACKGROUND" "linear-gradient(135deg, rgba(5,4,67,1) 0%, rgba(15,12,80,1) 50%, rgba(25,20,90,1) 100%)"
set_env "NEXT_PUBLIC_PLATE_TEXT_COLOR" "rgba(255,255,255,1)"

echo ""
echo "── Misc ──"
set_env "NEXT_PUBLIC_NETWORK_CURRENCY_NAME" "Ether"
set_env "NEXT_PUBLIC_NETWORK_CURRENCY_SYMBOL" "ETH"
set_env "NEXT_PUBLIC_NETWORK_CURRENCY_DECIMALS" "18"
set_env "NEXT_PUBLIC_HOMEPAGE_CHARTS" "['daily_txs']"

# ─── Restart frontend ────────────────────────────────────────
echo ""
echo "── Restarting frontend + proxy ──"
docker compose restart frontend proxy
sleep 5

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  ✓ EDMA branding applied!"
echo ""
echo "  Open your explorer in the browser and refresh."
echo "  You should see:"
echo "    • EDMA logo in the sidebar"
echo "    • Navy gradient hero banner"
echo "    • EDMA network name + chain 741"
echo "    • Custom favicon (E mark)"
echo "═══════════════════════════════════════════════════════════"
