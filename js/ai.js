'use strict';

const AI = (() => {
  const MODEL = 'gemini-2.0-flash';
  const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

  function getKey() { return DB.getSetting('geminiKey', ''); }
  function hasKey() { return !!getKey(); }

  /* ── Core API call (Google Gemini) ── */
  async function _call(messages, { system = '', maxTokens = 1024 } = {}) {
    const key = getKey();
    if (!key) throw new Error('NO_KEY');

    // Gemini nutzt "user" / "model" statt "user" / "assistant"
    const contents = messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const body = {
      contents,
      generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7 },
    };
    if (system) body.system_instruction = { parts: [{ text: system }] };

    const res = await fetch(
      `${API_BASE}/${MODEL}:generateContent?key=${key}`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `API Fehler ${res.status}`);
    }
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }

  /* ── Shared task context for prompts ── */
  function _taskContext() {
    const tasks   = DB.getTasks();
    const today   = tasks.filter(t => t.status === 'today');
    const later   = tasks.filter(t => ['later', 'skipped'].includes(t.status));
    const results = DB.getResults().slice(-14);
    const avgPct  = results.length
      ? Math.round(results.reduce((s, r) => s + r.completed / Math.max(r.planned, 1), 0) / results.length * 100)
      : null;
    const now  = new Date();
    const days = ['Sonntag','Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag'];
    return [
      `Zeit: ${now.toLocaleTimeString('de',{hour:'2-digit',minute:'2-digit'})}, ${days[now.getDay()]}`,
      `Heute-Liste (${today.length}): ${today.map(t=>`"${t.title}" (${t.estimated_minutes}min, ${t.priority})`).join('; ')||'leer'}`,
      `Aufgaben-Inbox (${later.length}): ${later.slice(0,8).map(t=>`"${t.title}" (${t.estimated_minutes}min, ${t.priority}, ${t.postpone_count||0}x verschoben)`).join('; ')||'leer'}`,
      avgPct !== null ? `Erfolgsrate der letzten Sessions: ${avgPct}%` : 'Noch keine Session-Daten',
    ].join('\n');
  }

  /* ── System prompt ── */
  const SYSTEM_COACH = `Du bist ein einfühlsamer Arbeitscoach für Menschen mit Neurodivergenz (ADHS, Autismus u.ä.).
Dein Ziel: Überforderung reduzieren, Entscheidungsblockaden lösen, Handlungsfähigkeit stärken.
Regeln:
- Immer auf Deutsch antworten
- Maximal 3 Empfehlungen oder Punkte gleichzeitig
- Kurz, konkret, wertschätzend – kein Fachchinesisch, keine langen Listen
- Fokus auf den NÄCHSTEN konkreten Mini-Schritt (nicht das große Ziel)
- Bei Überforderung: erst kurz beruhigen, dann 1 einzige Handlung nennen
- Nie mehr als 3 Sätze pro Abschnitt`;

  /* ── Feature 1: Aufgabenzerlegung ── */
  async function decomposeTasks(taskTitle, estimatedMinutes) {
    const text = await _call([{
      role: 'user',
      content: `Teile diese Aufgabe in 3–6 konkrete Teilschritte auf:\nAufgabe: "${taskTitle}" (${estimatedMinutes} Min geschätzt)\n\nAntworte NUR mit einem JSON-Array, keine Erklärungen:\n[{"title":"Schritt","estimated_minutes":5,"difficulty":"easy","energy":"low"}]\ndifficulty: easy/medium/hard, energy: low/medium/high`,
    }], { maxTokens: 700 });
    const match = text.match(/\[[\s\S]*?\]/);
    if (!match) throw new Error('Ungültige KI-Antwort');
    return JSON.parse(match[0]);
  }

  /* ── Feature 3: Fokusmodus ── */
  async function getFocusRecommendations(availableMinutes, energy, concentration) {
    const tasks = DB.getTasks().filter(t => ['later','skipped'].includes(t.status));
    if (!tasks.length) return [];
    const taskList = tasks.slice(0, 20).map((t, i) =>
      `${i+1}. "${t.title}" – ${t.estimated_minutes}min, Priorität: ${t.priority}, ${t.postpone_count||0}x verschoben`
    ).join('\n');
    const text = await _call([{
      role: 'user',
      content: `Verfügbare Zeit: ${availableMinutes}Min | Energie: ${energy}/10 | Konzentration: ${concentration}/10\nAufgaben:\n${taskList}\n\nWähle max. 3 passende Aufgaben. NUR JSON, keine Erklärungen:\n[{"index":1,"reason":"Kurze Begründung (max 8 Wörter)"}]`,
    }], { maxTokens: 400 });
    const match = text.match(/\[[\s\S]*?\]/);
    if (!match) return [];
    const picks = JSON.parse(match[0]);
    return picks.map(p => ({ task: tasks[p.index - 1], reason: p.reason })).filter(p => p.task);
  }

  /* ── Feature 6: Tagesplan ── */
  async function getDailyPlan() {
    return _call([{
      role: 'user',
      content: `Erstelle einen kurzen Tagesplan basierend auf diesen Daten:\n${_taskContext()}\nMaximal 5 priorisierte Empfehlungen, je 1 Satz Begründung. Formatiere mit Nummern.`,
    }], { maxTokens: 600 });
  }

  /* ── Feature 8: Gesprächsmodus ── */
  async function chat(history, userMessage) {
    return _call(
      [...history, { role: 'user', content: userMessage }],
      { system: SYSTEM_COACH + '\n\nAktuelle Aufgaben-Daten:\n' + _taskContext(), maxTokens: 500 }
    );
  }

  /* ── Feature 4: Prokrastinations-Erkennung (lokal) ── */
  function getProcrastinationWarnings() {
    return DB.getTasks()
      .filter(t => ['later','skipped'].includes(t.status) && (t.postpone_count || 0) >= 3)
      .sort((a, b) => (b.postpone_count || 0) - (a.postpone_count || 0))
      .slice(0, 3);
  }

  /* ── Feature 9: Lokale Smart-Empfehlungen (ohne API) ── */
  function getSmartSuggestions() {
    const tasks = DB.getTasks().filter(t => ['later','skipped'].includes(t.status));
    if (!tasks.length) return [];
    const hour = new Date().getHours();
    const scored = tasks.map(t => {
      let score = 0;
      if (t.priority === 'high')   score += 30;
      if (t.priority === 'medium') score += 15;
      score += Math.min((t.postpone_count || 0) * 8, 40);
      if (t.estimated_minutes <= 5)  score += 18;
      else if (t.estimated_minutes <= 15) score += 9;
      if (hour < 12 && t.priority === 'high')    score += 10;
      if (hour >= 17 && t.estimated_minutes <= 15) score += 10;
      return { task: t, score };
    });
    return scored.sort((a, b) => b.score - a.score).slice(0, 3).map(s => s.task);
  }

  /* ── Feature 7: Wochen-Motivationstext ── */
  function getMotivationStats() {
    const results = DB.getResults();
    const today   = new Date();
    const thisWeek = results.filter(r => { const d=new Date(r.date); const diff=(today-d)/86400000; return diff>=0&&diff<7; });
    const lastWeek = results.filter(r => { const d=new Date(r.date); const diff=(today-d)/86400000; return diff>=7&&diff<14; });
    const thisCount = thisWeek.reduce((s, r) => s + r.completed, 0);
    const lastCount = lastWeek.reduce((s, r) => s + r.completed, 0);
    const diff = lastCount > 0 ? Math.round((thisCount - lastCount) / lastCount * 100) : null;
    return { thisCount, lastCount, diff };
  }

  /* ── Chat-Verlauf in localStorage ── */
  function getChatHistory() {
    try { return JSON.parse(localStorage.getItem('ai_chat') || '[]'); } catch { return []; }
  }
  function saveChatHistory(h) { localStorage.setItem('ai_chat', JSON.stringify(h.slice(-40))); }
  function clearChatHistory() { localStorage.removeItem('ai_chat'); }

  return {
    hasKey, getKey,
    decomposeTasks, getFocusRecommendations, getDailyPlan, chat,
    getProcrastinationWarnings, getSmartSuggestions, getMotivationStats,
    getChatHistory, saveChatHistory, clearChatHistory,
  };
})();
