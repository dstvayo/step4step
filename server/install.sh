#!/bin/bash
# Step4Step Heim-Sync – Einrichtung auf dem Mac (erneut ausführbar: vorhandener
# Zugangscode, Zertifikate und Daten bleiben erhalten, nur der Server wird aktualisiert).
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"
DIR="$HOME/Library/Application Support/S4S-Sync"
PORT=8743
HOST="$(scutil --get LocalHostName).local"
LABEL="de.step4step.heimsync"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
OPENSSL=/usr/bin/openssl

mkdir -p "$DIR/data"
chmod 700 "$DIR"
cp "$SRC/server.py" "$DIR/server.py"

# ── Zugangscode (einmalig) ──
if [ ! -f "$DIR/config.json" ]; then
  TOKEN=$(/usr/bin/python3 -c "import secrets;a='ABCDEFGHJKMNPQRSTUVWXYZ23456789';print('-'.join(''.join(secrets.choice(a) for _ in range(4)) for _ in range(6)))")
  printf '{\n  "host": "%s",\n  "port": %s,\n  "token": "%s"\n}\n' "$HOST" "$PORT" "$TOKEN" > "$DIR/config.json"
  chmod 600 "$DIR/config.json"
  echo "✓ Zugangscode erzeugt"
fi

# ── Heim-CA (einmalig) – nur für .local und private IP-Adressen gültig ──
cd "$DIR"
if [ ! -f ca.key ]; then
  cat > ca.cnf <<'CNF'
[req]
distinguished_name = dn
prompt = no
[dn]
CN = S4S Heim-CA (Dirk Schneider)
O = Step4Step privat
[v3_ca]
basicConstraints = critical, CA:TRUE, pathlen:0
keyUsage = critical, keyCertSign, cRLSign
subjectKeyIdentifier = hash
nameConstraints = critical, permitted;DNS:.local, permitted;DNS:localhost, permitted;IP:192.168.0.0/255.255.0.0, permitted;IP:10.0.0.0/255.0.0.0, permitted;IP:172.16.0.0/255.240.0.0, permitted;IP:127.0.0.0/255.0.0.0
CNF
  $OPENSSL genrsa -out ca.key 3072 2>/dev/null
  chmod 600 ca.key
  $OPENSSL req -x509 -new -key ca.key -sha256 -days 3650 -config ca.cnf -extensions v3_ca -out ca.crt
  echo "✓ Heim-CA erstellt"
fi

# ── Server-Zertifikat (neu bei jedem Lauf, damit aktuelle IP-Adressen enthalten sind) ──
SAN="DNS:$HOST,DNS:localhost,IP:127.0.0.1"
for IF in en0 en1 en2; do IP=$(ipconfig getifaddr "$IF" 2>/dev/null || true); [ -n "$IP" ] && SAN="$SAN,IP:$IP"; done
# Tailscale (unterwegs): 100.x-Adresse und MagicDNS-Name ins Zertifikat aufnehmen
TS=/Applications/Tailscale.app/Contents/MacOS/Tailscale; [ -x "$TS" ] || TS=$(command -v tailscale || true)
if [ -n "$TS" ]; then
  TSIP=$("$TS" ip -4 2>/dev/null | head -1 || true); [ -n "$TSIP" ] && SAN="$SAN,IP:$TSIP"
  TSDNS=$("$TS" status --json 2>/dev/null | /usr/bin/python3 -c "import json,sys;print(json.load(sys.stdin)['Self']['DNSName'].rstrip('.'))" 2>/dev/null || true)
  [ -n "$TSDNS" ] && SAN="$SAN,DNS:$TSDNS"
fi
cat > server.cnf <<CNF
[req]
distinguished_name = dn
prompt = no
[dn]
CN = $HOST
[v3]
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = $SAN
CNF
$OPENSSL genrsa -out server.key 2048 2>/dev/null
chmod 600 server.key
$OPENSSL req -new -key server.key -config server.cnf -out server.csr
# iOS akzeptiert höchstens 825 Tage Laufzeit
$OPENSSL x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -days 800 -sha256 \
  -extfile server.cnf -extensions v3 -out server.crt 2>/dev/null
rm -f server.csr
echo "✓ Server-Zertifikat für $SAN"

# Zertifikat zum Übertragen aufs iPhone (öffentlich, enthält keinen Schlüssel)
cp ca.crt "$SRC/S4S-Heim-CA.crt"

# ── Autostart (LaunchAgent) ──
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array>
    <string>/usr/bin/python3</string><string>$DIR/server.py</string><string>--dir</string><string>$DIR</string>
  </array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$DIR/server.log</string>
  <key>StandardErrorPath</key><string>$DIR/server.log</string>
</dict></plist>
PL
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "✓ Server gestartet und für den Autostart eingetragen"

TOKEN=$(/usr/bin/python3 -c "import json;print(json.load(open('$DIR/config.json'))['token'])")
echo
echo "════════════════════════════════════════════════"
echo " Server-Adresse:  $HOST:$PORT  (Heim-WLAN)"
[ -n "${TSIP:-}" ] && echo " Unterwegs:       ${TSDNS:-$TSIP}:$PORT  (Tailscale)"
echo " Zugangscode:     $TOKEN"
echo " Zertifikat:      $SRC/S4S-Heim-CA.crt"
echo "════════════════════════════════════════════════"
