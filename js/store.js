'use strict';

/* ── Datenspeicher ──
   Alle App-Daten liegen dauerhaft in IndexedDB (groß, von iOS als App-Daten behandelt).
   Beim Start wird alles einmal in den Arbeitsspeicher gelesen; Lesen und Schreiben sind
   danach synchron wie bei localStorage. Geschrieben wird sofort in den Arbeitsspeicher und
   nach wenigen Millisekunden im Hintergrund in IndexedDB.
   localStorage wird zusätzlich als Reservekopie mitgeschrieben (falls IndexedDB ausfällt).
   Erster Start nach dem Umbau: vorhandene localStorage-Daten werden übernommen. */
const Store = (() => {
  const DB_NAME = 's4s-data', OS = 'kv', MARKER = '__migrated';
  const mem = new Map();
  const pending = new Map();          // key → Wert | null (= löschen)
  const listeners = [];
  let idb = null, flushTimer = null, mode = 'local';

  const _open = () => new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(OS);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });

  const _loadAll = db => new Promise((res, rej) => {
    const out = new Map();
    const rq = db.transaction(OS, 'readonly').objectStore(OS).openCursor();
    rq.onsuccess = () => { const c = rq.result; if (c) { out.set(c.key, c.value); c.continue(); } else res(out); };
    rq.onerror = () => rej(rq.error);
  });

  function _lsKeys() {
    const k = []; try { for (let i = 0; i < localStorage.length; i++) k.push(localStorage.key(i)); } catch {}
    return k;
  }
  function _mirror(k, v) {
    try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* Speicher voll – IndexedDB reicht */ }
  }

  function flush() {
    clearTimeout(flushTimer); flushTimer = null;
    if (!idb || !pending.size) return Promise.resolve();
    const batch = [...pending]; pending.clear();
    return new Promise(res => {
      const tx = idb.transaction(OS, 'readwrite'); const st = tx.objectStore(OS);
      for (const [k, v] of batch) v === null ? st.delete(k) : st.put(v, k);
      tx.oncomplete = () => res();
      tx.onerror = tx.onabort = () => { batch.forEach(([k, v]) => { if (!pending.has(k)) pending.set(k, v); }); res(); };
    });
  }
  const _schedule = () => { if (idb && !flushTimer) flushTimer = setTimeout(flush, 50); };

  async function init() {
    try { navigator.storage?.persist?.().catch(() => {}); } catch {}
    try {
      idb = await _open();
      const data = await _loadAll(idb);
      if (!data.has(MARKER)) {
        // Erster Start mit IndexedDB: Bestand aus localStorage übernehmen (IndexedDB-Werte haben Vorrang)
        for (const k of _lsKeys()) if (!data.has(k)) { data.set(k, localStorage.getItem(k)); pending.set(k, data.get(k)); }
        pending.set(MARKER, new Date().toISOString());
      }
      data.forEach((v, k) => { if (k !== MARKER) mem.set(k, v); });
      mode = 'idb';
      await flush();
    } catch (e) {
      console.warn('[Store] IndexedDB nicht verfügbar, nutze localStorage', e);
      idb = null; mode = 'local';
      for (const k of _lsKeys()) mem.set(k, localStorage.getItem(k));
    }
    // Beim Verlassen/Wegwischen sofort schreiben
    document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
    window.addEventListener('pagehide', () => flush());
  }

  function getItem(k) { return mem.has(k) ? mem.get(k) : null; }
  function setItem(k, v) {
    v = String(v); mem.set(k, v); pending.set(k, v); _mirror(k, v); _schedule();
    listeners.forEach(fn => { try { fn(k); } catch (e) { console.error(e); } });
  }
  function removeItem(k) { mem.delete(k); pending.set(k, null); _mirror(k, null); _schedule(); }
  function keys() { return [...mem.keys()]; }
  async function clear() {
    for (const k of mem.keys()) pending.set(k, null);
    mem.clear(); try { localStorage.clear(); } catch {}
    await flush();
  }
  const onChange = fn => listeners.push(fn);

  async function usage() {
    try { const e = await navigator.storage.estimate(); const p = await navigator.storage.persisted?.(); return { used: e.usage, quota: e.quota, persisted: !!p, mode }; }
    catch { return { mode }; }
  }

  /* Start: Speicher laden, danach die App-Skripte der Reihe nach einbinden */
  async function boot(scripts) {
    await init();
    for (const src of scripts) {
      await new Promise((res, rej) => {
        const s = document.createElement('script'); s.src = src; s.onload = res;
        s.onerror = () => rej(new Error('Laden fehlgeschlagen: ' + src));
        document.body.appendChild(s);
      });
    }
  }

  return { init, boot, getItem, setItem, removeItem, keys, clear, flush, onChange, usage, get mode() { return mode; } };
})();
