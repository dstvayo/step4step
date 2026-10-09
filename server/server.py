#!/usr/bin/env python3
"""Step4Step Heim-Sync – kleiner Synchronisations-Server für das Heim-WLAN.

Die Daten bleiben auf diesem Mac (kein Internet, keine Cloud).
- HTTPS mit eigenem Zertifikat (eigene Heim-CA, auf den Geräten einmalig vertraut)
- Zugriff nur mit Zugangscode (Bearer-Token)
- Abgleich pro Datensatz (Aufgabe, Ergebnis, Kategorie, Protokoll-Eintrag):
  wer zuletzt synchronisiert, gewinnt – aber nur für den jeweiligen Datensatz.
- Tägliche Sicherung des Datenbestands, die letzten 10 bleiben erhalten.
- App-Backups der Geräte (Button „Backup jetzt erstellen“) landen auf dem USB-Stick
  (config.json → backup_target), je Gerät die letzten 10. Ist der Stick nicht da,
  bleiben sie auf dem Mac und werden beim nächsten Mal auf den Stick verschoben.

Nur Python-Standardbibliothek. Start: python3 server.py [--http] [--port N] [--dir PFAD]
"""
import argparse, datetime, hmac, json, os, re, shutil, ssl, sys, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

COLLECTIONS = ('tasks', 'results', 'categories', 'time_log')
MAX_BODY = 10 * 1024 * 1024
SNAPSHOTS_KEEP = 10
ALLOWED_ORIGINS = ('https://dstvayo.github.io',)
LOCAL_ORIGIN_PREFIXES = ('http://localhost:', 'http://127.0.0.1:')

DEFAULT_BACKUP_TARGET = '/Volumes/BrainUpdate/S4S-Backups/app-daten'
BACKUPS_KEEP = 10

LOCK = threading.Lock()


class BackupStore:
    """App-Backups der Geräte: auf das Backup-Laufwerk, sonst vorübergehend auf den Mac."""

    def __init__(self, target, pending_dir):
        self.target = target
        self.pending = pending_dir
        os.makedirs(pending_dir, exist_ok=True)

    def _target_ok(self):
        """Ist das Backup-Ziel wirklich beschreibbar? (Laufwerk eingehängt UND macOS erlaubt den Zugriff)"""
        if self.target.startswith('/Volumes/'):
            vol = '/'.join(self.target.split('/')[:3])
            if not os.path.ismount(vol):
                return False
        probe = os.path.join(self.target, '.s4s-schreibtest')
        try:
            os.makedirs(self.target, exist_ok=True)
            with open(probe, 'w') as f:
                f.write('ok')
            os.remove(probe)
            return True
        except OSError:  # z. B. macOS-Datenschutz: Hintergrunddienst ohne Zugriff auf Wechseldatenträger
            return False

    @staticmethod
    def _rotate(folder):
        files = sorted(n for n in os.listdir(folder) if n.startswith('s4s-backup-') and n.endswith('.json'))
        for old in files[:-BACKUPS_KEEP]:
            os.remove(os.path.join(folder, old))
        return min(len(files), BACKUPS_KEEP)

    def _flush_pending(self):
        """Auf dem Mac zwischengespeicherte Backups auf das Laufwerk verschieben."""
        moved = 0
        for dev in os.listdir(self.pending):
            src_dir = os.path.join(self.pending, dev)
            if not os.path.isdir(src_dir):
                continue
            dst_dir = os.path.join(self.target, dev)
            os.makedirs(dst_dir, exist_ok=True)
            for n in os.listdir(src_dir):
                shutil.move(os.path.join(src_dir, n), os.path.join(dst_dir, n)); moved += 1
            self._rotate(dst_dir)
            os.rmdir(src_dir)
        return moved

    def save(self, device_label, name, body):
        dev = re.sub(r'[^A-Za-z0-9_-]', '_', device_label)[:40] or 'Geraet'
        if not re.fullmatch(r's4s-backup-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.json', name):
            raise ValueError('ungültiger Dateiname')
        on_drive = self._target_ok()
        folder = os.path.join(self.target if on_drive else self.pending, dev)
        os.makedirs(folder, exist_ok=True)
        path = os.path.join(folder, name)
        tmp = path + '.tmp'
        with open(tmp, 'wb') as f:
            f.write(body); f.flush(); os.fsync(f.fileno())
        os.replace(tmp, path)
        with open(path, 'rb') as f:  # Kontrolle: vollständig geschrieben?
            if f.read() != body:
                raise OSError('Backup-Datei fehlerhaft geschrieben')
        kept = self._rotate(folder)
        moved = self._flush_pending() if on_drive else 0
        return {'ok': True, 'stored': 'drive' if on_drive else 'mac', 'folder': folder,
                'kept': kept, 'moved_pending': moved}


def log(msg):
    print(f"{datetime.datetime.now():%Y-%m-%d %H:%M:%S} {msg}", flush=True)


def _newer(server_rec, incoming):
    """True, wenn die Server-Fassung nachweislich jünger ist als die eingehende."""
    try:
        return float(server_rec.get('updatedAt') or 0) > float(incoming.get('updatedAt') or 0)
    except (TypeError, ValueError, AttributeError):
        return False


class Store:
    """Datenbestand in einer JSON-Datei, atomar geschrieben."""

    def __init__(self, data_dir):
        self.dir = data_dir
        self.path = os.path.join(data_dir, 'store.json')
        self.snap_dir = os.path.join(data_dir, 'snapshots')
        os.makedirs(self.snap_dir, exist_ok=True)
        if os.path.exists(self.path):
            with open(self.path, encoding='utf-8') as f:
                self.data = json.load(f)
        else:
            self.data = {'rev': 0, 'colls': {c: {} for c in COLLECTIONS}, 'devices': {}}
        for c in COLLECTIONS:
            self.data['colls'].setdefault(c, {})

    def save(self):
        tmp = self.path + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(self.data, f, ensure_ascii=False)
            f.flush(); os.fsync(f.fileno())
        os.replace(tmp, self.path)
        self._snapshot()

    def _snapshot(self):
        name = f"store-{datetime.date.today():%Y-%m-%d}.json"
        target = os.path.join(self.snap_dir, name)
        if not os.path.exists(target):
            with open(self.path, 'rb') as src, open(target, 'wb') as dst:
                dst.write(src.read())
            snaps = sorted(n for n in os.listdir(self.snap_dir) if n.startswith('store-'))
            for old in snaps[:-SNAPSHOTS_KEEP]:
                os.remove(os.path.join(self.snap_dir, old))

    def sync(self, device, name, since, changes):
        d = self.data
        now = datetime.datetime.now().isoformat(timespec='seconds')
        applied = 0
        keep = {}
        for coll in COLLECTIONS:
            ch = changes.get(coll) or {}
            items = d['colls'][coll]
            for rec in ch.get('upserts') or []:
                if not isinstance(rec, dict) or not rec.get('id'):
                    continue
                old = items.get(str(rec['id']))
                # Konflikt: Server hat eine neuere Fassung (updatedAt) → behalten und an das Gerät zurückgeben
                if old and not old['deleted'] and _newer(old['record'], rec):
                    keep.setdefault(coll, set()).add(str(rec['id']))
                    continue
                d['rev'] += 1; applied += 1
                items[str(rec['id'])] = {'rev': d['rev'], 'deleted': False, 'device': device, 'ts': now, 'record': rec}
            for rid in ch.get('deletes') or []:
                d['rev'] += 1; applied += 1
                items[str(rid)] = {'rev': d['rev'], 'deleted': True, 'device': device, 'ts': now, 'record': None}
        d['devices'][device] = {'name': name, 'last_seen': now}
        # Alles seit dem letzten Abgleich dieses Geräts, das von anderen Geräten stammt
        out = {}
        for coll in COLLECTIONS:
            lst = [{'id': rid, 'deleted': e['deleted'], 'record': e['record']}
                   for rid, e in d['colls'][coll].items()
                   if (e['rev'] > since and e['device'] != device) or rid in keep.get(coll, ())]
            if lst:
                out[coll] = lst
        self.save()
        return {'rev': d['rev'], 'applied': applied, 'changes': out}

    def summary(self):
        d = self.data
        return {
            'rev': d['rev'],
            'counts': {c: sum(1 for e in d['colls'][c].values() if not e['deleted']) for c in COLLECTIONS},
            'devices': d['devices'],
        }


def make_handler(store, token, backups):
    class Handler(BaseHTTPRequestHandler):
        server_version = 'S4S-HeimSync/1.0'

        def log_message(self, fmt, *args):  # Zugriffe knapp protokollieren, keine Inhalte
            log(f"{self.client_address[0]} {fmt % args}")

        def _cors(self):
            origin = self.headers.get('Origin', '')
            if origin in ALLOWED_ORIGINS or origin.startswith(LOCAL_ORIGIN_PREFIXES):
                self.send_header('Access-Control-Allow-Origin', origin)
                self.send_header('Vary', 'Origin')
                self.send_header('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-S4S-Device, X-S4S-Filename')
                self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
                self.send_header('Access-Control-Allow-Private-Network', 'true')
                self.send_header('Access-Control-Max-Age', '600')

        def _json(self, code, obj):
            body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
            self.send_response(code)
            self._cors()
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _authorized(self):
            auth = self.headers.get('Authorization', '')
            given = auth[7:] if auth.startswith('Bearer ') else ''
            return bool(given) and hmac.compare_digest(given.encode(), token.encode())

        def do_OPTIONS(self):
            self.send_response(204); self._cors(); self.end_headers()

        def do_GET(self):
            path = urlparse(self.path).path
            if path == '/':
                return self._json(200, {'service': 'Step4Step Heim-Sync', 'ok': True})
            if not self._authorized():
                time.sleep(0.5)  # bremst Rateversuche
                return self._json(401, {'error': 'Zugangscode ungültig'})
            if path == '/api/ping':
                with LOCK:
                    return self._json(200, {'ok': True, **store.summary()})
            self._json(404, {'error': 'unbekannt'})

        def do_POST(self):
            path = urlparse(self.path).path
            if not self._authorized():
                time.sleep(0.5)
                return self._json(401, {'error': 'Zugangscode ungültig'})
            length = int(self.headers.get('Content-Length') or 0)
            if length <= 0 or length > MAX_BODY:
                return self._json(413, {'error': 'Anfrage zu groß oder leer'})
            if path == '/api/backup':
                body = self.rfile.read(length)
                try:
                    json.loads(body)  # nur gültiges JSON annehmen
                    with LOCK:
                        res = backups.save(self.headers.get('X-S4S-Device', ''), self.headers.get('X-S4S-Filename', ''), body)
                    log(f"Backup {self.headers.get('X-S4S-Device')}: {res['stored']} ({res['kept']} Versionen)")
                    return self._json(200, res)
                except (ValueError, OSError) as e:
                    log(f"Backup-FEHLER: {e}")
                    return self._json(500, {'error': f'Backup fehlgeschlagen: {e}'})
            if path != '/api/sync':
                return self._json(404, {'error': 'unbekannt'})
            try:
                req = json.loads(self.rfile.read(length))
                device = str(req.get('device') or '')[:64]
                if not device:
                    return self._json(400, {'error': 'Geräte-ID fehlt'})
                with LOCK:
                    res = store.sync(device, str(req.get('name') or '')[:64],
                                     int(req.get('since') or 0), req.get('changes') or {})
                if res['applied'] or res['changes']:
                    log(f"Sync {req.get('name')}: {res['applied']} hochgeladen, "
                        f"{sum(len(v) for v in res['changes'].values())} geliefert, rev={res['rev']}")
                self._json(200, res)
            except (ValueError, TypeError) as e:
                self._json(400, {'error': f'Ungültige Anfrage: {e}'})

    return Handler


def main():
    base = os.path.dirname(os.path.abspath(__file__))
    ap = argparse.ArgumentParser()
    ap.add_argument('--dir', default=base, help='Ordner mit config.json, Zertifikaten und data/')
    ap.add_argument('--port', type=int)
    ap.add_argument('--http', action='store_true', help='ohne TLS, nur für lokale Tests (localhost)')
    args = ap.parse_args()

    with open(os.path.join(args.dir, 'config.json'), encoding='utf-8') as f:
        cfg = json.load(f)
    port = args.port or cfg.get('port', 8743)
    store = Store(os.path.join(args.dir, 'data'))
    backups = BackupStore(cfg.get('backup_target', DEFAULT_BACKUP_TARGET), os.path.join(args.dir, 'data', 'app-backups-wartend'))

    if args.http:
        httpd = ThreadingHTTPServer(('127.0.0.1', port), make_handler(store, cfg['token'], backups))
        log(f"Test-Modus (HTTP, nur localhost) auf Port {port}")
    else:
        httpd = ThreadingHTTPServer(('0.0.0.0', port), make_handler(store, cfg['token'], backups))
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.minimum_version = ssl.TLSVersion.TLSv1_2
        ctx.load_cert_chain(os.path.join(args.dir, 'server.crt'), os.path.join(args.dir, 'server.key'))
        httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
        log(f"Heim-Sync läuft: https://{cfg.get('host', 'localhost')}:{port} · Backups nach {backups.target}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    sys.exit(main())
