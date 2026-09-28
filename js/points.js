'use strict';

/* ── Punktesystem ──
   Punkte je Aufgabe = Priorität (1–3) + Aufwand (0–2) + Dauer (1 je angefangene 15 min, max. 4)
   Pünktlich erledigt  → volle Punkte
   Über der Zeit       → halbe Punkte (aufgerundet)
   Übersprungen/später → 0 Punkte (kein Abzug)
   Ganze Heute-Liste erledigt → +25 % Bonus auf die möglichen Punkte des Blocks */
const Points = (() => {
  const PRI  = { low: 1, medium: 2, high: 3 };
  const DIFF = { easy: 0, medium: 1, hard: 2 };
  const LEVEL_STEP = 25;
  const BONUS_RATE = 0.25;

  const _dur = min => Math.min(4, Math.max(1, Math.ceil((min || 5) / 15)));
  const base = t => (PRI[t.priority] ?? 2) + (DIFF[t.difficulty] ?? 1) + _dur(t.estimated_minutes);
  const earned = (t, late) => late ? Math.ceil(base(t) / 2) : base(t);
  const bonusFor = baseSum => baseSum > 0 ? Math.max(1, Math.round(baseSum * BONUS_RATE)) : 0;

  /* Maximal erreichbare Punkte einer Aufgabenliste */
  function blockMax(tasks) {
    const sum = tasks.reduce((s, t) => s + base(t), 0);
    return { base: sum, bonus: bonusFor(sum), total: sum + bonusFor(sum) };
  }

  function level(total) {
    return { level: Math.floor(total / LEVEL_STEP) + 1, into: total % LEVEL_STEP, step: LEVEL_STEP };
  }

  function breakdown(t) {
    return { pri: PRI[t.priority] ?? 2, diff: DIFF[t.difficulty] ?? 1, dur: _dur(t.estimated_minutes) };
  }

  return { base, earned, bonusFor, blockMax, level, breakdown, LEVEL_STEP, BONUS_RATE };
})();
