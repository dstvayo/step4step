#!/bin/bash
# Step4Step – Auto-Push zu GitHub (alle 30 Min via Cron)

PROJECT="/Users/ds-mac/Library/Mobile Documents/com~apple~CloudDocs/6 - App-Projekte/Cloude Pro App S4S/web"
LOG="$PROJECT/autopush.log"

cd "$PROJECT" || exit 1

# Nur pushen wenn es wirklich Änderungen gibt
git add -A
if git diff --cached --quiet; then
  echo "$(date '+%d.%m.%Y %H:%M') – Keine Änderungen." >> "$LOG"
  exit 0
fi

git commit -m "Auto-Update: $(date '+%d.%m.%Y %H:%M')"
git push

echo "$(date '+%d.%m.%Y %H:%M') – ✅ Gepusht." >> "$LOG"
