'use strict';

/* ── Heim-Sync: Abgleich mit dem Sync-Server auf dem Mac mini (nur Heim-WLAN) ──
   Die Daten verlassen das Heimnetz nicht. Unterwegs bleibt alles lokal und wird beim
   nächsten Kontakt mit dem Server abgeglichen.
   Änderungserkennung: Für jeden Datensatz merkt sich das Gerät einen Fingerabdruck des
   zuletzt abgeglichenen Stands. Abweichung = geändert, fehlt = gelöscht. */
const HomeSync = (() => {
  const COLLS = ['tasks', 'results', 'categories', 'time_log'];
  const STATE_KEY = 'homesync_state';
  const TIMEOUT_MS = 8000;
  let running = null, applying = false, timer = null;

  const cfg = () => DB.getSetting('homeSync', null);   // {url, token, device_id, device_name}
  const isConfigured = () => !!cfg();
  const isApplying = () => applying;

  function _state() {
    try { return JSON.parse(localStorage.getItem(STATE_KEY)) || { rev: 0, base: {} }; }
    catch { return { rev: 0, base: {} }; }
  }
  const _saveState = st => localStorage.setItem(STATE_KEY, JSON.stringify(st));
  const _read = c => { try { return JSON.parse(localStorage.getItem(c) || '[]'); } catch { return []; } };

  /* Fingerabdruck eines Datensatzes (FNV-1a) */
  function _hash(o) {
    const s = JSON.stringify(o); let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(36) + '.' + s.length;
  }

  function _deviceName() {
    const ua = navigator.userAgent;
    return /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Macintosh/.test(ua) ? 'Mac' : /Android/.test(ua) ? 'Android' : 'Gerät';
  }

  async function _post(c, body) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(c.url + '/api/sync', {
        method: 'POST', signal: ctl.signal,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + c.token },
        body: JSON.stringify(body),
      });
      if (res.status === 401) throw new Error('Zugangscode ungültig');
      if (!res.ok) throw new Error('Server-Fehler ' + res.status);
      return res.json();
    } finally { clearTimeout(t); }
  }

  /* Änderungen vom Server einspielen; liefert neue Fingerabdrücke */
  function _apply(serverChanges, base) {
    let n = 0;
    applying = true;
    try {
      for (const coll of COLLS) {
        const list = serverChanges[coll]; if (!list?.length) continue;
        const recs = _read(coll);
        const pos = new Map(recs.map((r, i) => [r?.id, i]));
        const removed = new Set();
        const b = base[coll] || (base[coll] = {});
        for (const ch of list) {
          if (ch.deleted) { if (pos.has(ch.id)) removed.add(ch.id); delete b[ch.id]; }
          else {
            if (pos.has(ch.id)) recs[pos.get(ch.id)] = ch.record; else { pos.set(ch.id, recs.length); recs.push(ch.record); }
            removed.delete(ch.id);
            b[ch.id] = _hash(ch.record);
          }
          n++;
        }
        localStorage.setItem(coll, JSON.stringify(recs.filter(r => !removed.has(r?.id))));
      }
    } finally { applying = false; }
    return n;
  }

  function _localChanges(base) {
    const changes = {}; const sent = {};
    for (const coll of COLLS) {
      const b = base[coll] || {}; const seen = new Set(); const up = [];
      for (const r of _read(coll)) {
        if (!r || !r.id) continue;
        seen.add(String(r.id));
        const h = _hash(r);
        if (b[r.id] !== h) { up.push(r); (sent[coll] ||= {})[r.id] = h; }
      }
      const del = Object.keys(b).filter(id => !seen.has(id));
      if (up.length || del.length) changes[coll] = { upserts: up, deletes: del };
      if (del.length) (sent[coll] ||= {}), del.forEach(id => sent[coll][id] = null);
    }
    return { changes, sent };
  }

  async function _run() {
    const c = cfg(); if (!c) return { skipped: true };
    const st = _state();
    let received = 0;

    // Erster Kontakt dieses Geräts: erst den Server-Stand holen (Server gewinnt bei gleichen IDs),
    // danach nur noch lokal neue Datensätze hochladen. Verhindert, dass z. B. Standard-Kategorien
    // eines neuen Geräts die angepassten Daten der anderen Geräte überschreiben.
    if (!st.rev && !Object.keys(st.base).length) {
      const first = await _post(c, { device: c.device_id, name: c.device_name, since: 0, changes: {} });
      received += _apply(first.changes || {}, st.base);
      st.rev = first.rev; _saveState(st);
    }

    const { changes, sent } = _localChanges(st.base);
    const res = await _post(c, { device: c.device_id, name: c.device_name, since: st.rev, changes });
    for (const coll in sent) {
      const b = st.base[coll] || (st.base[coll] = {});
      for (const [id, h] of Object.entries(sent[coll])) { if (h === null) delete b[id]; else b[id] = h; }
    }
    received += _apply(res.changes || {}, st.base);
    st.rev = res.rev; _saveState(st);

    const info = { at: new Date().toISOString(), ok: true, sent: res.applied, received };
    DB.setSetting('homeSyncLast', info);
    return info;
  }

  /* Abgleich; parallele Aufrufe teilen sich einen Lauf */
  async function sync() {
    if (running) return running;
    running = _run().catch(e => {
      const reason = e.name === 'AbortError' || e.name === 'TypeError'
        ? 'Server nicht erreichbar (nicht im Heim-WLAN?)' : e.message;
      DB.setSetting('homeSyncLast', { ...(DB.getSetting('homeSyncLast', {}) || {}), ok: false, error: reason, tried: new Date().toISOString() });
      return { ok: false, error: reason };
    }).finally(() => { running = null; });
    return running;
  }

  /* Nach lokalen Änderungen gebündelt abgleichen */
  function schedule() {
    if (!isConfigured() || applying) return;
    clearTimeout(timer); timer = setTimeout(sync, 3000);
  }

  /* Verbindung testen und speichern */
  async function connect(address, token) {
    let url = address.trim().replace(/\/+$/, '');
    if (!/^https?:\/\//.test(url)) url = 'https://' + url;
    if (!/:\d+$/.test(url.replace(/^https?:\/\//, ''))) url += ':8743';
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    let res;
    try { res = await fetch(url + '/api/ping', { headers: { Authorization: 'Bearer ' + token.trim() }, signal: ctl.signal }); }
    catch { throw new Error('Server nicht erreichbar. Bist du im Heim-WLAN, läuft der Mac und ist das Zertifikat auf diesem Gerät vertraut?'); }
    finally { clearTimeout(t); }
    if (res.status === 401) throw new Error('Zugangscode ungültig.');
    if (!res.ok) throw new Error('Server-Fehler ' + res.status);
    const info = await res.json();
    const old = cfg();
    DB.setSetting('homeSync', {
      url, token: token.trim(),
      device_id: old?.device_id || crypto.randomUUID(),
      device_name: old?.device_name || _deviceName(),
    });
    localStorage.removeItem(STATE_KEY);  // neuer Server → erster Kontakt
    return info;
  }

  function disconnect() {
    DB.setSetting('homeSync', null);
    DB.setSetting('homeSyncLast', null);
    localStorage.removeItem(STATE_KEY);
  }

  /* Nach dem Einspielen eines Backups: wie ein erster Kontakt behandeln (zusammenführen statt löschen) */
  function resetState() { localStorage.removeItem(STATE_KEY); }

  return { isConfigured, isApplying, sync, schedule, connect, disconnect, resetState, STATE_KEY };
})();
