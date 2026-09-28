'use strict';

/* ── Lokales Backup (nichts wird ins Internet übertragen) ──
   Inhalt: alle App-Daten aus dem Browser-Speicher (Aufgaben, Historie, Zeit-Protokoll,
   Kategorien, Einstellungen inkl. API-Schlüssel/Firebase-Konfiguration) + alle App-Dateien.
   Ziel:   ein frei wählbarer lokaler Ordner (z. B. USB-Stick BrainUpdate), dort bleiben die
           letzten 10 Backups. Browser ohne Ordnerwahl (Safari, iPhone) speichern/teilen die Datei. */
const Backup = (() => {
  const KEEP = 10;
  const PREFIX = 's4s-backup-';
  const REMIND_DAYS = 28;
  // App-Dateien, die mitgesichert werden (bei neuen Dateien hier und in sw.js ergänzen)
  const APP_FILES = [
    'index.html', 'manifest.json', 'sw.js', 'css/style.css',
    'js/db.js', 'js/estimate.js', 'js/points.js', 'js/backup.js', 'js/homesync.js', 'js/ai.js', 'js/sync.js', 'js/app.js',
    'icons/icon.svg', 'icons/icon-maskable.svg', 'icons/icon-192.png', 'icons/icon-512.png',
    'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png',
  ];

  /* ── Ordner-Handle dauerhaft merken (IndexedDB, bleibt auf diesem Gerät) ── */
  function _idb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('s4s-backup', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('handles');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function _idbReq(mode, fn) {
    const db = await _idb();
    return new Promise((res, rej) => {
      const req = fn(db.transaction('handles', mode).objectStore('handles'));
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  }
  const _getDir = () => _idbReq('readonly', s => s.get('dir')).catch(() => null);
  const _setDir = h => _idbReq('readwrite', s => s.put(h, 'dir'));

  const canChooseFolder = () => 'showDirectoryPicker' in window;

  async function chooseFolder() {
    const h = await window.showDirectoryPicker({ id: 's4s-backup', mode: 'readwrite' });
    await _setDir(h);
    DB.setSetting('backupFolderName', h.name);
    return h;
  }

  async function _permitted(h) {
    const o = { mode: 'readwrite' };
    if (await h.queryPermission(o) === 'granted') return true;
    return (await h.requestPermission(o)) === 'granted';
  }

  /* ── Backup-Inhalt zusammenstellen ── */
  function _b64(buf) {
    let s = ''; const b = new Uint8Array(buf);
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
    return btoa(s);
  }
  async function _collect() {
    const data = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      data[k] = localStorage.getItem(k);
    }
    const files = {};
    for (const path of APP_FILES) {
      try {
        const r = await fetch(path, { cache: 'no-cache' });
        if (!r.ok) continue;
        files[path] = /\.png$/.test(path)
          ? { encoding: 'base64', content: _b64(await r.arrayBuffer()) }
          : { encoding: 'utf8', content: await r.text() };
      } catch (e) { /* offline: Datei fehlt im Backup, Daten sind trotzdem gesichert */ }
    }
    return {
      format: 's4s-backup', format_version: 1,
      created_at: new Date().toISOString(),
      device: navigator.userAgent,
      counts: {
        tasks: DB.getTasks().length, results: DB.getResults().length,
        time_log: DB.getTimeLog().length, files: Object.keys(files).length,
      },
      data, files,
    };
  }

  const _stamp = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}_` +
    `${String(d.getHours()).padStart(2,'0')}-${String(d.getMinutes()).padStart(2,'0')}-${String(d.getSeconds()).padStart(2,'0')}`;

  /* Nur die neuesten KEEP Backups behalten (Dateinamen sind nach Zeit sortierbar) */
  async function _rotate(dir) {
    const names = [];
    for await (const [name, h] of dir.entries()) {
      if (h.kind === 'file' && name.startsWith(PREFIX) && name.endsWith('.json')) names.push(name);
    }
    names.sort();
    const old = names.slice(0, Math.max(0, names.length - KEEP));
    for (const n of old) await dir.removeEntry(n);
    return names.length - old.length;
  }

  /* Backup erstellen. Rückgabe: {mode:'folder'|'share'|'download', name, kept?, folder?} */
  async function create() {
    const payload = await _collect();
    const name = `${PREFIX}${_stamp(new Date())}.json`;
    const text = JSON.stringify(payload);
    let result;

    if (canChooseFolder()) {
      let dir = await _getDir();
      if (!dir || !(await _permitted(dir).catch(() => false))) dir = await chooseFolder();
      const fh = await dir.getFileHandle(name, { create: true });
      const w = await fh.createWritable();
      await w.write(text); await w.close();
      // Kontrolle: Datei zurücklesen und vergleichen
      const check = await (await fh.getFile()).text();
      if (check.length !== text.length) throw new Error('Backup-Datei konnte nicht vollständig geschrieben werden.');
      result = { mode: 'folder', name, folder: dir.name, kept: await _rotate(dir) };
    } else {
      const file = new File([text], name, { type: 'application/json' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Step4Step-Backup' }); // Abbruch wirft AbortError
        result = { mode: 'share', name };
      } else {
        const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(file), download: name });
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        result = { mode: 'download', name };
      }
    }
    DB.setSetting('lastBackupAt', payload.created_at);
    DB.setSetting('lastBackupInfo', { ...result, counts: payload.counts });
    return result;
  }

  /* Backup einspielen: ersetzt alle App-Daten dieses Geräts */
  async function restore(file) {
    const b = JSON.parse(await file.text());
    if (b.format !== 's4s-backup' || !b.data) throw new Error('Das ist keine Step4Step-Backup-Datei.');
    const keepBackupSettings = DB.getSettings();
    localStorage.clear();
    Object.entries(b.data).forEach(([k, v]) => localStorage.setItem(k, v));
    // Backup-Stand dieses Geräts nicht mit dem alten Stand überschreiben
    ['lastBackupAt', 'lastBackupInfo', 'backupFolderName', 'homeSync', 'homeSyncLast'].forEach(k => {
      if (k in keepBackupSettings) DB.setSetting(k, keepBackupSettings[k]);
    });
    // Heim-Sync danach wie ein erster Kontakt: zusammenführen, nichts auf dem Server löschen
    if (typeof HomeSync !== 'undefined') HomeSync.resetState();
    return b;
  }

  function daysSinceLast() {
    const last = DB.getSetting('lastBackupAt', '');
    return last ? Math.floor((Date.now() - new Date(last).getTime()) / 86400000) : null;
  }
  /* Erinnerung: nie gesichert (und es gibt Daten) oder letztes Backup älter als 4 Wochen */
  function isDue() {
    const d = daysSinceLast();
    if (d === null) return DB.getTasks().length > 0 || DB.getResults().length > 0;
    return d >= REMIND_DAYS;
  }

  return { create, restore, chooseFolder, canChooseFolder, daysSinceLast, isDue, KEEP, REMIND_DAYS };
})();
