'use strict';

/* ── Projekte ──
   Ein Projekt hat Name, Kategorie, Priorität, Planzeit und Notiz (Sammlung „projects“).
   Teilaufgaben sind normale Aufgaben mit project_id: dieselben Felder (Priorität, Zeit, …),
   dieselbe Heute-Liste, derselbe Timer. Sie stehen nicht in der Aufgabenliste, sondern im Projekt.
   Erledigte Teilaufgaben stehen im Zeitprotokoll (mit project_id) → Fortschritt. */

const PROJ_PLAN_PRESETS = [30, 60, 120, 240, 480, 960];
const DONE_OUTCOMES = ['ontime', 'overtime', 'done_extern'];

const fmtMin = m => {
  m = Math.round(m || 0);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
};

/* Kennzahlen eines Projekts */
function projStats(p) {
  const open = DB.getTasks().filter(t => t.project_id === p.id);
  const doneIds = new Set(DB.getTimeLog()
    .filter(e => e.project_id === p.id && DONE_OUTCOMES.includes(e.outcome)).map(e => e.task_id));
  open.forEach(t => doneIds.delete(t.id));   // wiederkehrend & schon wieder offen → nicht doppelt zählen
  const openMin = open.reduce((s, t) => s + (t.estimated_minutes || 0), 0);
  const doneMin = DB.getTimeLog().filter(e => e.project_id === p.id && DONE_OUTCOMES.includes(e.outcome))
    .reduce((s, e) => s + (e.actual_minutes || e.estimated_minutes || 0), 0);
  const total = open.length + doneIds.size;
  return {
    open, openMin, doneMin, doneCount: doneIds.size, total,
    todayCount: open.filter(t => t.status === 'today').length,
    pct: total ? Math.round(doneIds.size / total * 100) : 0,
  };
}

const projBadge = t => {
  if (!t.project_id) return '';
  const p = DB.getProject(t.project_id);
  return `<span class="badge badge-proj" title="Projekt">📁 ${esc(p ? p.name : 'Projekt')}</span>`;
};

const progressBar = pct => `<div class="proj-progress"><div class="proj-progress-fill" style="width:${pct}%"></div></div>`;

/* ── Projektliste (Menü „Projekte“) ── */
function vProjects() {
  const cats = DB.getCategories();
  const catColor = name => cats.find(c => c.name === name)?.color || '#6b7280';
  const all = DB.getProjects();
  const active = all.filter(p => p.status !== 'done')
    .sort((a, b) => (PRI_ORDER[a.priority] ?? 2) - (PRI_ORDER[b.priority] ?? 2) || new Date(a.created_at) - new Date(b.created_at));
  const done = all.filter(p => p.status === 'done');
  const card = p => {
    const st = projStats(p);
    const over = p.planned_minutes && st.openMin + st.doneMin > p.planned_minutes;
    return `<div class="task-card task-card-v2 pri-card proj-card ${priClass(p)}" data-action="open-project" data-id="${p.id}">
      <div class="task-row-top">
        <span class="task-title-bold">📁 ${esc(p.name)}</span>
      </div>
      ${progressBar(st.pct)}
      <div class="task-row-bottom">
        ${priBadge(p)}
        <span class="badge badge-cat"><span class="cat-dot-sm" style="background:${catColor(p.category)}"></span>${esc(p.category || '')}</span>
        <span class="badge badge-rec">${st.doneCount}/${st.total} erledigt</span>
        ${p.planned_minutes ? `<span class="badge ${over ? 'badge-proc' : 'badge-rec'}">⏱ ${fmtMin(p.planned_minutes)} geplant</span>` : ''}
        ${st.todayCount ? `<span class="badge badge-today-sm">📅 ${st.todayCount} in Heute</span>` : ''}
      </div>
    </div>`;
  };
  return `<div class="view">${hdr('Projekte')}
    <div class="content">
      ${updateBanner()}
      <div class="inbox-actions">
        <p class="scroll-hint">Projekte mit Teilaufgaben – ganz oder einzeln in Heute übernehmen.</p>
        <button class="btn btn-sm btn-primary inbox-new-btn" data-action="new-project">➕ Neues Projekt</button>
      </div>
      ${active.length === 0
        ? `<div class="empty-state"><div class="empty-icon">📁</div><p>Noch keine Projekte.</p><p>Lege ein Projekt an und füge Teilaufgaben hinzu.</p></div>`
        : active.map(card).join('')}
      ${done.length ? `<details class="proj-done-list"><summary>✓ Abgeschlossene Projekte (${done.length})</summary>${done.map(card).join('')}</details>` : ''}
    </div>
  </div>`;
}

/* ── Projekt-Detail ── */
function vProject() {
  const p = DB.getProject(S.params.id);
  if (!p) { setTimeout(() => go('projects'), 0); return ''; }
  const st = projStats(p);
  const tasks = st.open.slice().sort((a, b) =>
    (a.status === 'today' ? 0 : 1) - (b.status === 'today' ? 0 : 1) ||
    (PRI_ORDER[a.priority] ?? 2) - (PRI_ORDER[b.priority] ?? 2) || new Date(a.created_at) - new Date(b.created_at));
  const waiting = tasks.filter(t => t.status !== 'today');
  const waitMin = waiting.reduce((s, t) => s + (t.estimated_minutes || 0), 0);
  const doneEntries = DB.getTimeLog().filter(e => e.project_id === p.id && DONE_OUTCOMES.includes(e.outcome))
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  const planned = p.planned_minutes || 0, sum = st.openMin + st.doneMin;
  return `<div class="view">${hdr('Projekt', true)}
    <div class="content">
      <div class="card proj-head ${priClass(p)}">
        <div class="proj-title-row">
          <h2 class="proj-title">📁 ${esc(p.name)}</h2>
          <button class="btn btn-sm btn-secondary" data-action="edit-project" data-id="${p.id}">✏️</button>
        </div>
        ${p.note ? `<p class="proj-note">${esc(p.note)}</p>` : ''}
        ${progressBar(st.pct)}
        <div class="proj-kpis">
          <div><strong>${st.doneCount}/${st.total}</strong><span>erledigt</span></div>
          <div><strong>${planned ? fmtMin(planned) : '–'}</strong><span>Planzeit</span></div>
          <div class="${planned && sum > planned ? 'kpi-over' : ''}"><strong>${fmtMin(sum)}</strong><span>Teilaufgaben</span></div>
          <div><strong>${fmtMin(st.openMin)}</strong><span>noch offen</span></div>
        </div>
        ${planned && sum > planned ? `<p class="form-hint kpi-over">⚠️ Die Teilaufgaben brauchen ${fmtMin(sum - planned)} mehr als geplant.</p>` : ''}
        <div class="proj-actions">
          <button class="btn btn-primary" data-action="new-subtask" data-id="${p.id}">➕ Teilaufgabe</button>
          ${waiting.length ? `<button class="btn btn-today" data-action="project-today" data-id="${p.id}">📅 Ganzes Projekt in Heute (${fmtMin(waitMin)})</button>` : ''}
        </div>
      </div>
      ${tasks.length === 0
        ? `<div class="empty-state"><div class="empty-icon">🧩</div><p>${st.doneCount ? 'Alle Teilaufgaben erledigt 🎉' : 'Noch keine Teilaufgaben.'}</p></div>`
        : tasks.map(t => `<div class="task-card task-card-v2 pri-card ${priClass(t)}${t.status === 'today' ? ' task-today' : ''}">
          <div class="task-row-top" data-action="edit-sub" data-id="${t.id}" data-pid="${p.id}">
            <span class="task-title-bold">${esc(t.title)}</span><span class="task-time-sep"> – ${t.estimated_minutes} min</span>
          </div>
          <div class="task-row-bottom">
            ${priBadge(t)}
            ${t.recurring ? '<span class="badge badge-rec">🔄</span>' : ''}
            ${t.status === 'today'
              ? `<span class="badge badge-today-sm">📅 in Heute</span><button class="btn btn-sm btn-back-inbox" data-action="rm-today" data-id="${t.id}">← Zurück</button>`
              : `<button class="btn btn-sm btn-today" data-action="add-today" data-id="${t.id}">📅 Heute</button>`}
            <button class="btn btn-sm btn-danger-sm" data-action="del-task" data-id="${t.id}">🗑️</button>
          </div>
        </div>`).join('')}
      ${doneEntries.length ? `<details class="proj-done-list"><summary>✓ Erledigt (${doneEntries.length})</summary>
        ${doneEntries.map(e => `<div class="proj-done-item">✓ ${esc(e.title)} <span class="text-muted">· ${new Date(e.date).toLocaleDateString('de-DE')}${e.actual_minutes ? ' · ' + e.actual_minutes + ' min' : ''}</span></div>`).join('')}
      </details>` : ''}
      <div class="proj-footer">
        ${p.status === 'done'
          ? `<button class="btn btn-secondary" data-action="project-reopen" data-id="${p.id}">↺ Wieder öffnen</button>`
          : `<button class="btn btn-secondary" data-action="project-finish" data-id="${p.id}">✓ Projekt abschließen</button>`}
        <button class="btn btn-sm btn-danger-sm" data-action="del-project" data-id="${p.id}">🗑️ Projekt löschen</button>
      </div>
    </div>
  </div>`;
}

/* ── Projekt anlegen / bearbeiten ── */
function vProjectForm() {
  const cats = DB.getCategories();
  const p = S.params.id ? DB.getProject(S.params.id) : null;
  const isEdit = !!p;
  const v = p || { name: '', category: cats[0]?.name || 'Privat', priority: 'medium', planned_minutes: 120, note: '' };
  return `<div class="view">${hdr(isEdit ? 'Projekt bearbeiten' : 'Neues Projekt', true)}
    <div class="content">
      <form class="form" id="project-form">
        <div class="form-group">
          <label class="form-label">Projektname *</label>
          <input type="text" id="p-name" class="form-input" placeholder="z. B. Umzug vorbereiten" value="${esc(v.name)}" required autofocus>
        </div>
        <div class="form-group">
          <label class="form-label">Kategorie</label>
          <select id="p-cat" class="form-select">
            ${cats.map(c => `<option value="${esc(c.name)}" ${v.category === c.name ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Priorität</label>
          <div class="btn-group">
            ${[...PRIOS].reverse().map(x => `<button type="button" class="btn btn-toggle pri-toggle pri-${x}${v.priority === x ? ' active' : ''}" data-action="set-ppri" data-val="${x}">${PRI_LABEL[x]}</button>`).join('')}
          </div>
          <input type="hidden" id="p-pri" value="${v.priority}">
        </div>
        <div class="form-group">
          <label class="form-label">Planzeit für das ganze Projekt</label>
          <div class="btn-group">
            ${PROJ_PLAN_PRESETS.map(m => `<button type="button" class="btn btn-toggle${v.planned_minutes === m ? ' active' : ''}" data-action="set-pplan" data-val="${m}">${fmtMin(m)}</button>`).join('')}
          </div>
          <input type="number" id="p-plan" class="form-input mt-sm" placeholder="Minuten" value="${v.planned_minutes || ''}" min="0" max="100000">
          <p class="form-hint">In Minuten. Die Summe der Teilaufgaben wird damit verglichen.</p>
        </div>
        <div class="form-group">
          <label class="form-label">Notiz</label>
          <textarea id="p-note" class="form-input" rows="3" placeholder="Ziel, Hinweise …">${esc(v.note || '')}</textarea>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" data-action="back">Abbrechen</button>
          <button type="button" class="btn btn-primary" data-action="save-project">${isEdit ? 'Speichern ✓' : 'Projekt anlegen ✓'}</button>
        </div>
      </form>
    </div>
  </div>`;
}

/* ── Aktionen ── */
function saveProject() {
  const name = document.getElementById('p-name')?.value?.trim();
  if (!name) { alert('Bitte einen Projektnamen eingeben.'); return; }
  const old = S.params.id ? DB.getProject(S.params.id) : null;
  const p = DB.saveProject({
    ...(old || {}),
    id: old?.id || uuid(), name,
    category: document.getElementById('p-cat')?.value || 'Privat',
    priority: document.getElementById('p-pri')?.value || 'medium',
    planned_minutes: Math.max(0, parseInt(document.getElementById('p-plan')?.value) || 0),
    note: document.getElementById('p-note')?.value?.trim() || '',
    status: old?.status || 'active',
    created_at: old?.created_at || new Date().toISOString(),
  });
  go('project', { id: p.id });
}

/* alle wartenden Teilaufgaben in die Heute-Liste (in Prioritäts-Reihenfolge) */
function projectToday(id) {
  const waiting = DB.getTasks().filter(t => t.project_id === id && t.status !== 'today')
    .sort((a, b) => (PRI_ORDER[a.priority] ?? 2) - (PRI_ORDER[b.priority] ?? 2) || new Date(a.created_at) - new Date(b.created_at));
  if (!waiting.length) return;
  const sum = waiting.reduce((s, t) => s + (t.estimated_minutes || 0), 0);
  if (!checkBlock(sum)) return;
  let order = DB.getTasks().filter(t => t.status === 'today').length;
  waiting.forEach(t => DB.saveTask({ ...t, status: 'today', today_order: order++ }));
  go('today');
}

function deleteProject(id) {
  const p = DB.getProject(id); if (!p) return;
  const subs = DB.getTasks().filter(t => t.project_id === id);
  const msg = subs.length
    ? `Projekt „${p.name}“ löschen?\n\nDie ${subs.length} offenen Teilaufgaben bleiben als normale Aufgaben in der Aufgabenliste erhalten.`
    : `Projekt „${p.name}“ löschen?`;
  if (!confirm(msg)) return;
  subs.forEach(t => DB.saveTask({ ...t, project_id: null }));
  DB.deleteProject(id);
  go('projects');
}

function setProjectStatus(id, status) {
  const p = DB.getProject(id); if (!p) return;
  if (status === 'done') {
    const open = DB.getTasks().filter(t => t.project_id === id).length;
    if (open && !confirm(`Es sind noch ${open} Teilaufgaben offen. Projekt trotzdem abschließen?\n\nDie offenen Teilaufgaben bleiben im Projekt.`)) return;
  }
  DB.saveProject({ ...p, status, done_at: status === 'done' ? new Date().toISOString() : null });
  go(status === 'done' ? 'projects' : 'project', { id });
}

/* Klicks der Projekt-Ansichten; true = erledigt */
function projectAction(action, el) {
  const id = el.dataset.id;
  switch (action) {
    case 'open-project':   go('project', { id }); return true;
    case 'new-project':    go('new-project', {}); return true;
    case 'edit-project':   go('edit-project', { id }); return true;
    case 'save-project':   saveProject(); return true;
    case 'del-project':    deleteProject(id); return true;
    case 'project-today':  projectToday(id); return true;
    case 'project-finish': setProjectStatus(id, 'done'); return true;
    case 'project-reopen': setProjectStatus(id, 'active'); return true;
    case 'new-subtask':    go('new', { projectId: id }); return true;
    case 'edit-sub':       go('edit-task', { id, projectId: el.dataset.pid }); return true;
    case 'set-ppri':       setToggle('set-ppri', 'p-pri', el.dataset.val); return true;
    case 'set-pplan':      setToggle('set-pplan', 'p-plan', el.dataset.val); return true;
  }
  return false;
}
