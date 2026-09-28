'use strict';
const DB = (() => {
  const get = k => JSON.parse(localStorage.getItem(k) || '[]');
  const set = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  const defaultCats = [
    { id: 'c1', name: 'Privat',     color: '#1E3A54' },
    { id: 'c2', name: 'Arbeit',     color: '#3D5E87' },
    { id: 'c3', name: 'Familie',    color: '#4E7F6E' },
    { id: 'c4', name: 'Gesundheit', color: '#8A6D3B' },
  ];
  return {
    getTasks:   () => get('tasks'),
    saveTask(t) { const a = get('tasks'); const i = a.findIndex(x=>x.id===t.id); i>=0?a[i]=t:a.push(t); set('tasks',a); },
    deleteTask(id) { set('tasks', get('tasks').filter(t=>t.id!==id)); },

    getResults:   () => get('results'),
    saveResult(r) { const a = get('results'); const i = a.findIndex(x=>x.id===r.id); i>=0?a[i]=r:a.push(r); set('results',a); },

    // Aufgaben-Protokoll: erledigt (ontime/overtime), skipped, postponed
    // → Grundlage für Zeitvorschläge, Archiv und 4-Wochen-Statistik
    getTimeLog:   () => get('time_log'),
    // nur erledigte, nicht aus dem Archiv entfernte Einträge (für Zeitvorschläge + Archiv)
    getDoneLog:   () => get('time_log').filter(e => e.actual_minutes > 0 && !e.hidden),
    setTimeLog:   v => set('time_log', v.slice(-500)),
    addTimeLog(e) { const a = get('time_log'); a.push(e); set('time_log', a.slice(-500)); },

    getCategories() { const a = get('categories'); if(a.length) return a; set('categories',defaultCats); return defaultCats; },
    saveCategory(c) { const a = this.getCategories(); const i = a.findIndex(x=>x.id===c.id); i>=0?a[i]=c:a.push(c); set('categories',a); },
    deleteCategory(id) { set('categories', get('categories').filter(c=>c.id!==id)); },

    getSettings:   () => JSON.parse(localStorage.getItem('settings')||'{}'),
    getSetting(k,def) { const s=this.getSettings(); return k in s ? s[k] : def; },
    setSetting(k,v) { const s=this.getSettings(); s[k]=v; localStorage.setItem('settings',JSON.stringify(s)); },
  };
})();
