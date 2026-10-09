#!/bin/bash
# Step4Step ↔ Erinnerungen (Calendar 366) – Einrichtung auf dem Mac mini (erneut ausführbar)
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"
DIR="$HOME/Library/Application Support/S4S-Sync"
APP="$DIR/S4S-Erinnerungen.app"
EXE="$APP/Contents/MacOS/S4S-Erinnerungen"
LABEL="de.step4step.erinnerungen"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

command -v swiftc >/dev/null || { echo "✗ Swift fehlt – bitte zuerst ausführen: xcode-select --install"; exit 1; }
[ -f "$DIR/config.json" ] || { echo "✗ Heim-Sync ist nicht eingerichtet (zuerst server/install.sh)"; exit 1; }

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
mkdir -p "$APP/Contents/MacOS"
cp "$SRC/Info.plist" "$APP/Contents/Info.plist"
swiftc -O "$SRC/main.swift" -o "$EXE" -framework EventKit
codesign --force --deep -s - "$APP"
echo "✓ Programm gebaut"

echo "→ Erster Abgleich. Falls macOS nach Zugriff auf Erinnerungen fragt: „Erlauben“ / „Vollzugriff“."
open -W "$APP" --args --once || true
tail -3 "$DIR/reminders-bridge.log" 2>/dev/null || true

cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$EXE</string></array>
  <key>StartInterval</key><integer>120</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardErrorPath</key><string>$DIR/reminders-bridge.log</string>
</dict></plist>
PL
for i in $(seq 1 20); do launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || break; sleep 0.5; done
launchctl bootstrap "gui/$(id -u)" "$PLIST" || { sleep 2; launchctl bootstrap "gui/$(id -u)" "$PLIST"; }
echo "✓ Abgleich läuft jetzt alle 2 Minuten (Protokoll: $DIR/reminders-bridge.log)"
