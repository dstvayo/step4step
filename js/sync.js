'use strict';

const Sync = (() => {
  const FB_BASE = 'https://www.gstatic.com/firebasejs/10.12.0';
  let _ready = false;
  let _userId = null;
  let _db = null;
  let _unsub = null;
  let _ignoreNextSnapshot = false; // verhindert Feedback-Loop beim eigenen Push

  /* ── Konfiguration ── */
  function getConfig() {
    try { return JSON.parse(DB.getSetting('firebaseConfig','null')||'null'); } catch { return null; }
  }
  function hasConfig() { return !!getConfig(); }
  function isConnected() { return _ready && !!_userId; }
  function getUserEmail() {
    try { return firebase.auth().currentUser?.email || null; } catch { return null; }
  }

  /* ── Firebase SDK laden ── */
  function _addScript(src) {
    return new Promise((res,rej) => {
      if (document.querySelector(`script[src="${src}"]`)) { res(); return; }
      const s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }
  async function _loadSDK() {
    await _addScript(`${FB_BASE}/firebase-app-compat.js`);
    await _addScript(`${FB_BASE}/firebase-firestore-compat.js`);
    await _addScript(`${FB_BASE}/firebase-auth-compat.js`);
  }

  /* ── Initialisierung ── */
  async function init() {
    const cfg = getConfig();
    if (!cfg) return false;
    try {
      await _loadSDK();
      if (!firebase.apps.length) firebase.initializeApp(cfg);
      _db = firebase.firestore();
      _ready = true;

      // Redirect-Ergebnis abfangen (nach Google-Login-Weiterleitung)
      try {
        await firebase.auth().getRedirectResult();
      } catch(e) { console.warn('Redirect result:', e.message); }

      return new Promise(resolve => {
        firebase.auth().onAuthStateChanged(user => {
          if (user) {
            _userId = user.uid;
            _pullAll().then(() => { _listen(); if(typeof render==='function') render(); });
            resolve(true);
          } else {
            _userId = null;
            resolve(false);
          }
        });
      });
    } catch(e) {
      console.error('Sync.init:', e);
      return false;
    }
  }

  /* ── Google Sign-In via Redirect (funktioniert in PWA + iOS) ── */
  async function signIn() {
    if (!_ready) await init();
    const p = new firebase.auth.GoogleAuthProvider();
    // signInWithRedirect statt Popup – zuverlässig in allen Umgebungen
    await firebase.auth().signInWithRedirect(p);
    // Seite wird weitergeleitet – Ergebnis wird beim Zurückkehren in init() abgefangen
  }

  async function signOut() {
    if (_unsub) { _unsub(); _unsub = null; }
    await firebase.auth().signOut();
    _userId = null;
    if (typeof render==='function') render();
  }

  /* ── Firestore-Referenz ── */
  function _ref() { return _db.collection('s4s_users').doc(_userId); }

  /* ── Alle Daten von Firestore holen ── */
  async function _pullAll() {
    try {
      const snap = await _ref().get();
      if (!snap.exists) return;
      const d = snap.data();
      if (d.tasks)      localStorage.setItem('tasks',      JSON.stringify(d.tasks));
      if (d.results)    localStorage.setItem('results',    JSON.stringify(d.results));
      if (d.categories) localStorage.setItem('categories', JSON.stringify(d.categories));
    } catch(e) { console.warn('Sync pull:', e); }
  }

  /* ── Echtzeit-Listener (andere Geräte → dieses Gerät) ── */
  function _listen() {
    if (_unsub) _unsub();
    _unsub = _ref().onSnapshot(snap => {
      if (!snap.exists || _ignoreNextSnapshot) { _ignoreNextSnapshot=false; return; }
      const d = snap.data();
      if (d.tasks)      localStorage.setItem('tasks',      JSON.stringify(d.tasks));
      if (d.results)    localStorage.setItem('results',    JSON.stringify(d.results));
      if (d.categories) localStorage.setItem('categories', JSON.stringify(d.categories));
      if (typeof render==='function') render();
    }, e => console.warn('Sync listener:', e));
  }

  /* ── Lokale Daten nach Firestore schreiben ── */
  async function pushAll() {
    if (!_userId || !_db) return;
    try {
      _ignoreNextSnapshot = true; // eigenes Update ignorieren
      await _ref().set({
        tasks:      JSON.parse(localStorage.getItem('tasks')      || '[]'),
        results:    JSON.parse(localStorage.getItem('results')    || '[]'),
        categories: JSON.parse(localStorage.getItem('categories') || '[]'),
        updatedAt:  firebase.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    } catch(e) { console.warn('Sync push:', e); }
  }

  return { hasConfig, isConnected, getUserEmail, init, signIn, signOut, pushAll };
})();
