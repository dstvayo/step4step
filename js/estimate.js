'use strict';

/* ── Zeitschätzung aus der eigenen Historie (lokal, ohne API) ──
   A: ähnliche erledigte Aufgaben über Titel-Wortvergleich finden
   B: persönlicher Schätzfaktor (gebraucht ÷ geplant) je Kategorie bzw. gesamt
   D: Archiv – erledigte Aufgaben gruppiert, mit gelernter Zeit wieder anlegbar */
const Estimate = (() => {
  const SIMILAR_MIN = 0.5;   // Dice-Koeffizient, ab dem ein Titel als „ähnlich“ gilt
  const FACTOR_MIN_N = 3;    // so viele Einträge braucht ein Schätzfaktor mindestens
  const STOPWORDS = new Set(('der die das den dem des ein eine einen einem einer eines und oder ' +
    'für fur mit von vom zum zur zu im in am an auf aus bei bis nach über uber unter um ' +
    'noch mal bitte kurz schnell mein meine meinen meinem meiner dein deine sich ich wir ' +
    'es ist sind was wie wo heute morgen').split(' '));
  const SUFFIXES = ['ungen', 'ung', 'ern', 'en', 'er', 'es', 'e', 'n', 's'];

  function _stem(w) {
    for (const s of SUFFIXES) {
      if (w.length - s.length >= 4 && w.endsWith(s)) return w.slice(0, -s.length);
    }
    return w;
  }

  /* Titel → Liste vergleichbarer Wortstämme */
  function tokens(title) {
    const clean = String(title || '').toLowerCase()
      .replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ß/g, 'ss')
      .replace(/[^a-z0-9]+/g, ' ');
    return [...new Set(clean.split(' ').filter(w => w.length > 1 && !STOPWORDS.has(w)).map(_stem))];
  }
  const key = title => tokens(title).slice().sort().join(' ');

  const _sameStem = (a, b) => a === b || (Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a)));

  /* Dice-Koeffizient über Wortstämme: 1 = gleich, 0 = nichts gemeinsam */
  function similarity(ta, tb) {
    if (!ta.length || !tb.length) return 0;
    const common = ta.filter(a => tb.some(b => _sameStem(a, b))).length;
    return 2 * common / (ta.length + tb.length);
  }

  const _avg = arr => arr.reduce((s, x) => s + x, 0) / arr.length;

  /* A: ähnlichste erledigte Aufgaben (beste zuerst, bei Gleichstand die neueste) */
  function findSimilar(title, category, log = DB.getDoneLog()) {
    const t = tokens(title);
    if (!t.length) return [];
    return log
      .map(e => {
        let score = similarity(t, tokens(e.title));
        if (score > 0 && e.category === category) score += 0.1;
        return { entry: e, score };
      })
      .filter(m => m.score >= SIMILAR_MIN)
      .sort((a, b) => b.score - a.score || b.entry.date.localeCompare(a.entry.date));
  }

  /* B: persönlicher Faktor, zuerst je Kategorie, sonst über alle Aufgaben */
  function factor(category, log = DB.getDoneLog()) {
    const calc = entries => {
      const last = entries.slice(-20);
      if (last.length < FACTOR_MIN_N) return null;
      const f = last.reduce((s, e) => s + e.actual_minutes, 0) / Math.max(1, last.reduce((s, e) => s + e.estimated_minutes, 0));
      return { value: Math.min(3, Math.max(0.5, f)), n: last.length };
    };
    const byCat = calc(log.filter(e => e.category === category));
    if (byCat) return { ...byCat, scope: 'category' };
    const all = calc(log);
    return all ? { ...all, scope: 'all' } : null;
  }

  /* Vorschlag für das Formular; null wenn es nichts Sinnvolles zu sagen gibt */
  function suggest(title, category, estimated) {
    const log = DB.getDoneLog();
    const all = findSimilar(title, category, log);
    // nur Treffer mitteln, die fast so gut passen wie der beste (sonst verwässert z. B.
    // „Wäsche aufhängen“ den Vorschlag für „Wäsche waschen“)
    const top = all.filter(m => m.score >= (all[0]?.score || 0) - 0.15).slice(0, 3);
    if (top.length) {
      const w = top.reduce((s, m) => s + m.score, 0);
      const minutes = Math.max(1, Math.round(top.reduce((s, m) => s + m.entry.actual_minutes * m.score, 0) / w));
      return { source: 'similar', minutes, match: top[0].entry, count: top.length };
    }
    const f = factor(category, log);
    if (f && estimated > 0 && Math.abs(f.value - 1) >= 0.1) {
      const minutes = Math.max(1, Math.round(estimated * f.value));
      if (minutes !== estimated) return { source: 'factor', minutes, factor: f.value, scope: f.scope, category };
    }
    return null;
  }

  /* Gelernte Zeit für eine Serie (wiederkehrend / aus Archiv neu angelegt): Ø der letzten 3 */
  function learnedMinutes(seriesId, title) {
    const log = DB.getDoneLog();
    let entries = seriesId ? log.filter(e => e.series_id === seriesId) : [];
    if (!entries.length) { const k = key(title); entries = log.filter(e => key(e.title) === k); }
    if (!entries.length) return null;
    return Math.max(1, Math.round(_avg(entries.slice(-3).map(e => e.actual_minutes))));
  }

  /* D: Archiv – erledigte Aufgaben nach Titel gruppiert, neueste zuerst */
  function archive() {
    const groups = new Map();
    DB.getDoneLog().forEach(e => {
      const k = key(e.title) || e.title;
      const g = groups.get(k) || { key: k, entries: [] };
      g.entries.push(e);
      groups.set(k, g);
    });
    return [...groups.values()].map(g => {
      const last = g.entries[g.entries.length - 1];
      return {
        key: g.key, title: last.title, category: last.category, priority: last.priority, difficulty: last.difficulty,
        series_id: last.series_id, count: g.entries.length, lastDate: last.date,
        lastActual: last.actual_minutes,
        learned: Math.max(1, Math.round(_avg(g.entries.slice(-3).map(e => e.actual_minutes)))),
      };
    }).sort((a, b) => b.lastDate.localeCompare(a.lastDate));
  }

  /* Nur ausblenden – für die Statistik bleiben die Einträge erhalten */
  function removeFromArchive(k) {
    DB.setTimeLog(DB.getTimeLog().map(e =>
      e.actual_minutes > 0 && (key(e.title) || e.title) === k ? { ...e, hidden: true } : e));
  }

  return { tokens, key, similarity, findSimilar, factor, suggest, learnedMinutes, archive, removeFromArchive };
})();
