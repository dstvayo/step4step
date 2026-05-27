'use strict';
const DB = (() => {
  const get = k => JSON.parse(localStorage.getItem(k) || '[]');
  const set = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  const defaultCats = [
    { id: 'c1', name: 'Privat',     color: '#4f46e5' },
    { id: 'c2', name: 'Arbeit',     color: '#0ea5e9' },
    { id: 'c3', name: 'Familie',    color: '#10b981' },
    { id: 'c4', name: 'Gesundheit', color: '#f59e0b' },
  ];
  return {
    getTasks:   () => get('tasks'),
    saveTask(t) { const a = get('tasks'); const i = a.findIndex(x=>x.id===t.id); i>=0?a[i]=t:a.push(t); set('tasks',a); },
    deleteTask(id) { set('tasks', get('tasks').filter(t=>t.id!==id)); },

    getResults:   () => get('results'),
    saveResult(r) { const a = get('results'); const i = a.findIndex(x=>x.id===r.id); i>=0?a[i]=r:a.push(r); set('results',a); },

    getCategories() { const a = get('categories'); if(a.length) return a; set('categories',defaultCats); return defaultCats; },
    saveCategory(c) { const a = this.getCategories(); const i = a.findIndex(x=>x.id===c.id); i>=0?a[i]=c:a.push(c); set('categories',a); },
    deleteCategory(id) { set('categories', get('categories').filter(c=>c.id!==id)); },

    getSettings:   () => JSON.parse(localStorage.getItem('settings')||'{}'),
    getSetting(k,def) { const s=this.getSettings(); return k in s ? s[k] : def; },
    setSetting(k,v) { const s=this.getSettings(); s[k]=v; localStorage.setItem('settings',JSON.stringify(s)); },
  };
})();
