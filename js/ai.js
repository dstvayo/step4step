'use strict';

const AI = (() => {
  const MODEL = 'gemini-2.5-flash';
  const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

  function getKey() { return DB.getSetting('geminiKey', ''); }
  function hasKey() { return !!getKey(); }

  /* ── Core API call (Google Gemini) ── */
  async function _call(messages, { system = '', maxTokens = 1024, json = false } = {}) {
    const key = getKey();
    if (!key) throw new Error('NO_KEY');

    // Gemini nutzt "user" / "model" statt "user" / "assistant"
    const contents = messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const body = {
      contents,
      generationConfig: {
        maxOutputTokens: maxTokens, temperature: 0.7,
        // gemini-2.5-flash "denkt" standardmäßig – diese Denk-Tokens zählen gegen maxOutputTokens
        // und haben Antworten abgeschnitten (Aufgaben fehlten im Plan/Fokus). Denken aus.
        thinkingConfig: { thinkingBudget: 0 },
      },
    };
    if (json) body.generationConfig.responseMimeType = 'application/json';
    if (system) body.system_instruction = { parts: [{ text: system }] };

    const res = await fetch(
      `${API_BASE}/${MODEL}:generateContent?key=${key}`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const msg = err.error?.message || `API Fehler ${res.status}`;
      if (res.status === 429 || msg.toLowerCase().includes('quota')) {
        throw new Error('Quota überschritten – bitte Billing unter console.cloud.google.com aktivieren (kostenlos).');
      }
      if (res.status === 400 && msg.toLowerCase().includes('api key')) {
        throw new Error('Ungültiger API-Schlüssel – bitte in den Einstellungen prüfen.');
      }
      throw new Error(msg);
    }
    const data = await res.json();
    const cand = data.candidates?.[0];
    const text = (cand?.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('');
    if (!text && cand?.finishReason === 'MAX_TOKENS') throw new Error('KI-Antwort wurde abgeschnitten – bitte erneut versuchen.');
    return text;
  }

  function _parseJsonArray(text) {
    const start = text.indexOf('['), end = text.lastIndexOf(']');
    if (start < 0 || end <= start) throw new Error('Ungültige KI-Antwort');
    return JSON.parse(text.slice(start, end + 1));
  }

  /* ── Alle offenen Aufgaben (Heute + Inbox), wichtigste zuerst ── */
  const OPEN_STATUSES = ['today', 'later', 'skipped'];
  const PRI_ORDER = { high: 0, medium: 1, low: 2 };
  function _openTasks() {
    return DB.getTasks()
      .filter(t => OPEN_STATUSES.includes(t.status))
      .sort((a, b) =>
        (a.status === 'today' ? 0 : 1) - (b.status === 'today' ? 0 : 1) ||
        (a.status === 'today' ? (a.today_order || 0) - (b.today_order || 0) : 0) ||
        (PRI_ORDER[a.priority] ?? 1) - (PRI_ORDER[b.priority] ?? 1) ||
        (b.postpone_count || 0) - (a.postpone_count || 0));
  }
  const PRI_DE = { high: 'hoch', medium: 'mittel', low: 'niedrig' };
  function _taskLine(t) {
    return `"${t.title}" (${t.estimated_minutes} min, Priorität ${PRI_DE[t.priority] || t.priority}, ${t.category}` +
      `${t.recurring ? ', wiederkehrend' : ''}${t.postpone_count ? `, ${t.postpone_count}x verschoben` : ''})`;
  }

  /* ── Shared task context for prompts ── */
  function _taskContext() {
    const open    = _openTasks();
    const today   = open.filter(t => t.status === 'today');
    const later   = open.filter(t => t.status !== 'today');
    const blockMin = DB.getSetting('todayBlockMinutes', 0);
    const results = DB.getResults().slice(-14);
    const avgPct  = results.length
      ? Math.round(results.reduce((s, r) => s + r.completed / Math.max(r.planned, 1), 0) / results.length * 100)
      : null;
    const now  = new Date();
    const days = ['Sonntag','Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag'];
    return [
      `Zeit: ${now.toLocaleTimeString('de',{hour:'2-digit',minute:'2-digit'})}, ${days[now.getDay()]}`,
      blockMin ? `Zeitblock heute: ${blockMin} min` : 'Kein Zeitblock festgelegt',
      `Heute-Liste (${today.length} Aufgaben, ${today.reduce((s,t)=>s+t.estimated_minutes,0)} min):`,
      ...(today.length ? today.map(t => '- ' + _taskLine(t)) : ['- leer']),
      `Aufgaben-Inbox (${later.length} Aufgaben):`,
      ...(later.length ? later.map(t => '- ' + _taskLine(t)) : ['- leer']),
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
    }], { maxTokens: 1000, json: true });
    return _parseJsonArray(text);
  }

  /* ── Feature 3: Fokusmodus ── */
  async function getFocusRecommendations(availableMinutes, energy, concentration) {
    const tasks = _openTasks();
    if (!tasks.length) return [];
    const taskList = tasks.map((t, i) =>
      `${i+1}. ${_taskLine(t)}${t.status === 'today' ? ' [bereits in Heute-Liste]' : ''}`
    ).join('\n');
    const text = await _call([{
      role: 'user',
      content: `Verfügbare Zeit: ${availableMinutes}Min | Energie: ${energy}/10 | Konzentration: ${concentration}/10\nAlle ${tasks.length} offenen Aufgaben:\n${taskList}\n\nPrüfe ALLE Aufgaben und wähle max. 3, die zusammen in die verfügbare Zeit passen und zu Energie/Konzentration passen. NUR JSON, keine Erklärungen:\n[{"index":1,"reason":"Kurze Begründung (max 8 Wörter)"}]`,
    }], { maxTokens: 600, json: true });
    const picks = _parseJsonArray(text);
    return picks.map(p => ({ task: tasks[p.index - 1], reason: p.reason })).filter(p => p.task);
  }

  /* ── Feature 6: Tagesplan ── */
  async function getDailyPlan() {
    return _call([{
      role: 'user',
      content: `Erstelle einen kurzen Tagesplan basierend auf diesen Daten:\n${_taskContext()}\n\n` +
        `Berücksichtige dabei ALLE oben genannten Aufgaben (Heute-Liste und Inbox) und den Zeitblock.\n` +
        `1. Nummerierte Reihenfolge für heute (max. 5 Aufgaben, die in den Zeitblock passen), je 1 Satz Begründung.\n` +
        `2. Danach eine Zeile "Später:" mit den übrigen Aufgaben (nur Titel, kommagetrennt).\n` +
        `Keine Markdown-Formatierung (keine Sternchen).`,
    }], { maxTokens: 1500 });
  }

  /* ── Feature 8: Gesprächsmodus ── */
  async function chat(history, userMessage) {
    return _call(
      [...history, { role: 'user', content: userMessage }],
      { system: SYSTEM_COACH + '\n\nAktuelle Aufgaben-Daten:\n' + _taskContext(), maxTokens: 1000 }
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
