#!/usr/bin/env bash
# deploy.sh — Build Fieshzen (Feishin + Tizen wrapper) and install on Samsung Frame TV via SAWSUBE
# Usage: ./deploy.sh [SAWSUBE_URL] [TV_ID]
set -e

SAWSUBE_URL="${1:-http://127.0.0.1:8000}"
TV_ID="${2:-1}"
LOG="/tmp/sawsube.log"

# ── Ensure SAWSUBE is running ────────────────────────────────────────────────
if ! curl -sf "$SAWSUBE_URL/api/health" > /dev/null 2>&1; then
  echo "SAWSUBE not reachable at $SAWSUBE_URL — starting it..."
  (cd /home/will/Github/SAWSUBE && nohup .venv/bin/python -m backend.main >> "$LOG" 2>&1 &)
  sleep 4
  if ! curl -sf "$SAWSUBE_URL/api/health" > /dev/null 2>&1; then
    echo "ERROR: SAWSUBE failed to start. Check $LOG" >&2
    exit 1
  fi
  echo "SAWSUBE started."
fi

# ── Trigger build + install ──────────────────────────────────────────────────
echo "→ Triggering Fieshzen build + install (TV ID $TV_ID)..."
RESPONSE=$(curl -sf -X POST "$SAWSUBE_URL/api/tizenbrew/$TV_ID/build-install-fieshzen")
JOB_ID=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('job_id',''))" 2>/dev/null)
echo "  Job started: $JOB_ID"
echo ""
echo "→ Streaming SAWSUBE log (Ctrl+C when done)..."
echo "  Look for: 'Tizen application is successfully installed'"
echo ""
tail -f "$LOG"
