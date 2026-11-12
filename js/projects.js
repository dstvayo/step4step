'use strict';

/* ── Projekte ──
   Projekt-Datensatz (Sammlung „projects“, wird über den Heim-Sync auf dem Mac mini gespeichert):
     { id, name, category, priority, planned_minutes, note, status:'active'|'done',
       recurring, recur_interval:'daily'|'weekly'|'monthly', round, round_started_at,
       done_tasks:[{ id, title, priority, difficulty, category, estimated_minutes, actual_minutes, done_at, recurring }],
       removed_done:[task_id…], created_at, updatedAt }
   Offene Teilaufgaben sind normale Aufgaben mit project_id (+ project_order für die Reihenfolge):
   dieselbe Heute-Liste, derselbe Timer, dieselbe Auswertung/Belohnung wie bisher.
   Erledigte Teilaufgaben bleiben im Projekt (done_tasks) – übernommen aus dem Zeitprotokoll. */

const PROJ_PLAN_PRESETS = [30, 60, 120, 240, 480, 960];
const DONE_OUTCOMES = ['ontime', 'overtime', 'done_extern'];
const RECUR_LABEL = { daily: 'täglich', weekly: 'wöchentlich', monthly: 'monatlich' };

const fmtMin = m => {
  m = Math.round(m || 0);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
};

const projOpen = id => DB.getTasks()
  .filter(t => t.project_id === id && t.status !== 'done')
  .sort((a, b) => (a.project_order ?? 1e9) - (b.project_order ?? 1e9) || new Date(a.created_at) - new Date(b.created_at));

/* Erledigte Teilaufgaben aus dem Zeitprotokoll ins Projekt übernehmen (nur aktuelle Runde) */
function projSyncDone(p) {
  const have = new Set((p.done_tasks || []).map(d => d.id));
  const removed = new Set(p.removed_done || []);
  const since = p.round_started_at ? new Date(p.round_started_at).getTime() : 0;
  const add = DB.getTimeLog().filter(e => e.project_id === p.id && DONE_OUTCOMES.includes(e.outcome)
      && e.task_id && !have.has(e.task_id) && !removed.has(e.task_id) && new Date(e.date).getTime() >= since)
    .map(e => ({ id: e.task_id, title: e.title, priority: e.priority || 'medium', difficulty: e.difficulty || 'medium',
                 category: e.category || p.category, estimated_minutes: e.estimated_minutes || 5,
                 actual_minutes: e.actual_minutes || null, done_at: e.date, recurring: !!e.recurring }));
  if (!add.length) return p;
  return DB.saveProject({ ...p, done_tasks: [...(p.done_tasks || []), ...add] });
}

/* Wiederkehrendes Projekt: alles erledigt und Intervall vorbei → neue Runde */
function nextRoundDue(p) {
  if (!p.recurring || p.status === 'done') return false;
  const done = p.done_tasks || [];
  if (!done.length || projOpen(p.id).length) return false;
  const last = new Date(Math.max(...done.map(d => new Date(d.done_at).getTime() || 0)));
  const due = new Date(last); due.setHours(0, 0, 0, 0);
  if (p.recur_interval === 'weekly') due.setDate(due.getDate() + 7);
  else if (p.recur_interval === 'monthly') due.setMonth(due.getMonth() + 1);
  else due.setDate(due.getDate() + 1);
  return Date.now() >= due.getTime();
}

function projNewRound(p) {
  const tpl = (p.done_tasks || []).slice().sort((a, b) => new Date(a.done_at) - new Date(b.done_at));
  const order = projOpen(p.id).length;
  tpl.forEach((d, i) => DB.saveTask(newSubtaskFrom(d, p.id, order + i)));
  return DB.saveProject({ ...p, round: (p.round || 1) + 1, round_started_at: new Date().toISOString(),
                          last_round: tpl, done_tasks: [], removed_done: [] });
}

function newSubtaskFrom(d, projectId, order) {
  return { id: uuid(), title: d.title, category: d.category || 'Privat', priority: d.priority || 'medium',
           difficulty: d.difficulty || 'medium', estimated_minutes: d.estimated_minutes || 5, status: 'later',
           recurring: false, postpone_count: 0, today_order: 0, project_id: projectId, project_order: order,
           created_at: new Date().toISOString(), done_at: null, actual_minutes: null };
}

/* vor jeder Projekt-Ansicht: Erledigtes übernehmen, fällige Runden starten */
function projRefreshAll() {
  DB.getProjects().forEach(p => { p = projSyncDone(p); if (nextRoundDue(p)) projNewRound(p); });
}

const projBadge = t => {
  if (!t.project_id) return '';
  const p = DB.getProject(t.project_id);
  return `<span class="badge badge-proj" title="Projekt">📁 ${esc(p ? p.name : 'Projekt')}</span>`;
};

/* ── Projekt-Übersicht: Bezeichnung, offene Aufgaben, Gesamtzeit ── */
function vProjects() {
  projRefreshAll();
  const all = DB.getProjects();
  const active = all.filter(p => p.status !== 'done')
    .sort((a, b) => (PRI_ORDER[a.priority] ?? 2) - (PRI_ORDER[b.priority] ?? 2) || new Date(a.created_at) - new Date(b.created_at));
  const done = all.filter(p => p.status === 'done');
  const row = p => {
    const open = projOpen(p.id), min = open.reduce((s, t) => s + (t.estimated_minutes || 0), 0);
    return `<button class="proj-row ${priClass(p)}${p.status === 'done' ? ' proj-row-done' : ''}" data-action="open-project" data-id="${p.id}">
      <span class="proj-row-name">📁 ${esc(p.name)}${p.recurring ? ' <span title="wiederkehrend">🔄</span>' : ''}</span>
      <span class="proj-row-meta"><strong>${open.length}</strong> offen · <strong>${fmtMin(min)}</strong></span>
      <span class="proj-row-arrow">›</span>
    </button>`;
  };
  return `<div class="view">${hdr('Projekte')}
    <div class="content">
      ${updateBanner()}
      <div class="inbox-actions">
        <p class="scroll-hint">Tippe auf ein Projekt, um seine Aufgaben zu sehen.</p>
        <button class="btn btn-sm btn-primary inbox-new-btn" data-action="new-project">➕ Neues Projekt</button>
      </div>
      ${active.length === 0
        ? `<div class="empty-state"><div class="empty-icon">📁</div><p>Noch keine Projekte.</p><p>Lege ein Projekt an und füge Aufgaben hinzu.</p></div>`
        : `<div class="proj-list">${active.map(row).join('')}</div>`}
      ${done.length ? `<details class="proj-done-list"><summary>✓ Abgeschlossene Projekte (${done.length})</summary><div class="proj-list">${done.map(row).join('')}</div></details>` : ''}
    </div>
  </div>`;
}

/* ── Projekt-Detail: Aufgaben + Bearbeiten ── */
function vProject() {
  let p = DB.getProject(S.params.id);
  if (!p) { setTimeout(() => go('projects'), 0); return ''; }
  p = projSyncDone(p);
  if (nextRoundDue(p)) p = projNewRound(p);
  const open = projOpen(p.id);
  const waiting = open.filter(t => t.status !== 'today');
  const openMin = open.reduce((s, t) => s + (t.estimated_minutes || 0), 0);
  const waitMin = waiting.reduce((s, t) => s + (t.estimated_minutes || 0), 0);
  const doneList = (p.done_tasks || []).slice().sort((a, b) => new Date(b.done_at) - new Date(a.done_at));
  const doneMin = doneList.reduce((s, d) => s + (d.actual_minutes || d.estimated_minutes || 0), 0);
  const planned = p.planned_minutes || 0;
  const total = open.length + doneList.length;
  return `<div class="view">${hdr('Projekt', true)}
    <div class="content">
      <div class="card proj-head ${priClass(p)}">
        <div class="proj-title-row">
          <h2 class="proj-title">📁 ${esc(p.name)}</h2>
          <button class="btn btn-sm btn-secondary" data-action="edit-project" data-id="${p.id}" aria-label="Projekt bearbeiten">✏️</button>
        </div>
        ${p.note ? `<p class="proj-note">${esc(p.note)}</p>` : ''}
        <div class="proj-chips">
          <span class="badge badge-rec">${open.length} offen</span>
          <span class="badge badge-rec">✓ ${doneList.length} erledigt</span>
          <span class="badge badge-rec">⏱ ${fmtMin(openMin)} offen</span>
          ${planned ? `<span class="badge ${openMin + doneMin > planned ? 'badge-proc' : 'badge-rec'}">Plan ${fmtMin(planned)}</span>` : ''}
          ${p.recurring ? `<span class="badge badge-rec">🔄 ${RECUR_LABEL[p.recur_interval] || 'wiederkehrend'}${p.round > 1 ? ' · Runde ' + p.round : ''}</span>` : ''}
          ${p.status === 'done' ? '<span class="badge badge-today-sm">✓ abgeschlossen</span>' : ''}
        </div>
        ${total ? `<div class="proj-progress"><div class="proj-progress-fill" style="width:${Math.round(doneList.length / total * 100)}%"></div></div>` : ''}
        <div class="proj-actions">
          <button class="btn btn-secondary" data-action="new-subtask" data-id="${p.id}">➕ Neue Aufgabe</button>
          ${waiting.length ? `<button class="btn btn-today" data-action="project-today" data-id="${p.id}">📅 Alle in Heute (${fmtMin(waitMin)})</button>` : ''}
          ${open.length ? `<button class="btn btn-primary btn-full" data-action="project-start" data-id="${p.id}">▶ Alle in Heute &amp; starten</button>` : ''}
        </div>
      </div>

      <h3 class="proj-section">Offene Aufgaben</h3>
      ${open.length === 0
        ? `<div class="empty-state small"><p>${doneList.length ? 'Alle Aufgaben erledigt 🎉' : 'Noch keine Aufgaben – lege die erste an.'}</p></div>`
        : open.map((t, i) => `<div class="task-card task-card-v2 pri-card ${priClass(t)}${t.status === 'today' ? ' task-today' : ''}">
          <div class="task-row-top" data-action="edit-sub" data-id="${t.id}" data-pid="${p.id}">
            <span class="task-title-bold">${esc(t.title)}</span><span class="task-time-sep"> – ${t.estimated_minutes} min</span>
          </div>
          <div class="task-row-bottom">
            ${priBadge(t)}
            ${t.recurring ? '<span class="badge badge-rec" title="wiederkehrend">🔄</span>' : ''}
            ${t.status === 'today'
              ? `<button class="btn btn-sm btn-back-inbox" data-action="rm-today" data-id="${t.id}" title="aus Heute zurück">← Heute</button>`
              : `<button class="btn btn-sm btn-today" data-action="add-today" data-id="${t.id}">📅 Heute</button>`}
            <span class="proj-tools">
              <button class="btn btn-sm btn-secondary" data-action="sub-up" data-id="${t.id}" ${i === 0 ? 'disabled' : ''} aria-label="nach oben">↑</button>
              <button class="btn btn-sm btn-secondary" data-action="sub-down" data-id="${t.id}" ${i === open.length - 1 ? 'disabled' : ''} aria-label="nach unten">↓</button>
              <button class="btn btn-sm btn-secondary" data-action="edit-sub" data-id="${t.id}" data-pid="${p.id}" aria-label="bearbeiten">✏️</button>
              <button class="btn btn-sm btn-danger-sm" data-action="del-task" data-id="${t.id}" aria-label="löschen">🗑️</button>
            </span>
          </div>
        </div>`).join('')}

      ${doneList.length ? `<h3 class="proj-section">Erledigt</h3>
        ${doneList.map(d => `<div class="task-card task-card-v2 proj-done-card">
          <div class="task-row-top">
            <span class="task-title-bold">✓ ${esc(d.title)}</span>
          </div>
          <div class="task-row-bottom">
            <span class="text-muted proj-done-meta">${d.done_at ? new Date(d.done_at).toLocaleDateString('de-DE') : ''}${d.actual_minutes ? ' · ' + d.actual_minutes + ' min' : ''}</span>
            <span class="proj-tools">
              <button class="btn btn-sm btn-today" data-action="sub-repeat" data-id="${d.id}" data-pid="${p.id}">↺ Wiederholen</button>
              <button class="btn btn-sm btn-danger-sm" data-action="done-remove" data-id="${d.id}" data-pid="${p.id}" aria-label="aus der Liste entfernen">🗑️</button>
            </span>
          </div>
        </div>`).join('')}
        <button class="btn btn-sm btn-secondary" data-action="project-round" data-id="${p.id}">↺ Alle erledigten erneut anlegen${p.recurring ? ' (neue Runde)' : ''}</button>` : ''}

      <div class="proj-footer">
        <button class="btn btn-sm btn-secondary" data-action="edit-project" data-id="${p.id}">✏️ Projekt ändern</button>
        <button class="btn btn-sm btn-secondary" data-action="project-copy" data-id="${p.id}">📄 Als Vorlage kopieren</button>
        ${p.status === 'done'
          ? `<button class="btn btn-sm btn-secondary" data-action="project-reopen" data-id="${p.id}">↺ Wieder öffnen</button>`
          : `<button class="btn btn-sm btn-secondary" data-action="project-finish" data-id="${p.id}">✓ Abschließen</button>`}
        <button class="btn btn-sm btn-danger-sm" data-action="del-project" data-id="${p.id}">🗑️ Löschen</button>
      </div>
    </div>
  </div>`;
}

/* ── Projekt anlegen / bearbeiten ── */
function vProjectForm() {
  const cats = DB.getCategories();
  const p = S.params.id ? DB.getProject(S.params.id) : null;
  const isEdit = !!p;
  const v = p || { name: '', category: cats[0]?.name || 'Privat', priority: 'medium', planned_minutes: 120, note: '', recurring: false, recur_interval: 'weekly' };
  return `<div class="view">${hdr(isEdit ? 'Projekt ändern' : 'Neues Projekt', true)}
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
        </div>
        <div class="form-group">
          <label class="checkbox-label"><input type="checkbox" id="p-rec" ${v.recurring ? 'checked' : ''}> Wiederkehrendes Projekt 🔄</label>
          <select id="p-interval" class="form-select mt-sm">
            ${Object.entries(RECUR_LABEL).map(([k, l]) => `<option value="${k}" ${(v.recur_interval || 'weekly') === k ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
          <p class="form-hint">Sind alle Aufgaben erledigt, legt die App sie nach diesem Abstand automatisch neu an.</p>
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
  const now = new Date().toISOString();
  const p = DB.saveProject({
    round: 1, round_started_at: now, done_tasks: [], removed_done: [],
    ...(old || {}),
    id: old?.id || uuid(), name,
    category: document.getElementById('p-cat')?.value || 'Privat',
    priority: document.getElementById('p-pri')?.value || 'medium',
    planned_minutes: Math.max(0, parseInt(document.getElementById('p-plan')?.value) || 0),
    recurring: !!document.getElementById('p-rec')?.checked,
    recur_interval: document.getElementById('p-interval')?.value || 'weekly',
    note: document.getElementById('p-note')?.value?.trim() || '',
    status: old?.status || 'active',
    created_at: old?.created_at || now,
  });
  go('project', { id: p.id });
}

/* alle wartenden Aufgaben des Projekts in die Heute-Liste (Projekt-Reihenfolge) */
function projectToday(id, start = false) {
  const open = projOpen(id), waiting = open.filter(t => t.status !== 'today');
  if (!open.length) return;
  const sum = waiting.reduce((s, t) => s + (t.estimated_minutes || 0), 0);
  if (waiting.length) {
    if (start && !DB.getSetting('todayBlockMinutes', 0)) {   // noch kein Zeitblock → passend festlegen
      DB.setSetting('todayBlockMinutes', sum + DB.getTasks().filter(t => t.status === 'today').reduce((s, t) => s + t.estimated_minutes, 0));
      DB.setSetting('blockSetDate', todayStr());
    }
    if (!checkBlock(sum)) return;
    let order = DB.getTasks().filter(t => t.status === 'today').length;
    waiting.forEach(t => DB.saveTask({ ...t, status: 'today', today_order: order++ }));
  }
  if (start && typeof Timer !== 'undefined' && !['IDLE', 'ALL_DONE'].includes(Timer.state)) {
    alert('Es läuft bereits ein Block. Die Aufgaben stehen jetzt in der Heute-Liste.'); go('today'); return;
  }
  if (start) startTimer(); else go('today');
}

function moveSub(id, dir) {
  const t = DB.getTasks().find(x => x.id === id); if (!t) return;
  const list = projOpen(t.project_id);
  const i = list.findIndex(x => x.id === id), j = i + dir;
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  list.forEach((x, k) => { if (x.project_order !== k) DB.saveTask({ ...x, project_order: k }); });
  render();
}

function repeatDone(pid, did) {
  const p = DB.getProject(pid); const d = (p?.done_tasks || []).find(x => x.id === did); if (!d) return;
  DB.saveTask(newSubtaskFrom(d, pid, projOpen(pid).length));
  render();
}

function removeDone(pid, did) {
  const p = DB.getProject(pid); if (!p) return;
  if (!confirm('Erledigte Aufgabe aus der Projektliste entfernen?\n(Die Auswertung bleibt unverändert.)')) return;
  DB.saveProject({ ...p, done_tasks: (p.done_tasks || []).filter(x => x.id !== did), removed_done: [...(p.removed_done || []), did] });
  render();
}

function projectRound(id) {
  const p = DB.getProject(id); if (!p) return;
  if (!confirm(`Alle ${(p.done_tasks || []).length} erledigten Aufgaben erneut als offene Aufgaben anlegen?`)) return;
  projNewRound(p); render();
}

function copyProject(id) {
  const p = DB.getProject(id); if (!p) return;
  const now = new Date().toISOString();
  const np = DB.saveProject({ ...p, id: uuid(), name: p.name + ' (Kopie)', status: 'active', created_at: now,
    round: 1, round_started_at: now, done_tasks: [], removed_done: [], last_round: [], done_at: null });
  const src = [...(p.done_tasks || []).slice().sort((a, b) => new Date(a.done_at) - new Date(b.done_at)), ...projOpen(id)];
  src.forEach((d, i) => DB.saveTask({ ...newSubtaskFrom(d, np.id, i), recurring: !!d.recurring }));
  go('project', { id: np.id });
}

function deleteProject(id) {
  const p = DB.getProject(id); if (!p) return;
  const subs = DB.getTasks().filter(t => t.project_id === id && t.status !== 'done');
  const msg = subs.length
    ? `Projekt „${p.name}“ löschen?\n\nDie ${subs.length} offenen Aufgaben bleiben als normale Aufgaben in der Aufgabenliste erhalten.`
    : `Projekt „${p.name}“ löschen?`;
  if (!confirm(msg)) return;
  subs.forEach(t => DB.saveTask({ ...t, project_id: null }));
  DB.deleteProject(id);
  go('projects');
}

function setProjectStatus(id, status) {
  const p = DB.getProject(id); if (!p) return;
  if (status === 'done') {
    const open = projOpen(id).length;
    if (open && !confirm(`Es sind noch ${open} Aufgaben offen. Projekt trotzdem abschließen?\n\nDie offenen Aufgaben bleiben im Projekt.`)) return;
  }
  DB.saveProject({ ...p, status, done_at: status === 'done' ? new Date().toISOString() : null });
  go(status === 'done' ? 'projects' : 'project', { id });
}

/* Klicks der Projekt-Ansichten; true = erledigt */
function projectAction(action, el) {
  const id = el.dataset.id, pid = el.dataset.pid;
  switch (action) {
    case 'open-project':   go('project', { id }); return true;
    case 'new-project':    go('new-project', {}); return true;
    case 'edit-project':   go('edit-project', { id }); return true;
    case 'save-project':   saveProject(); return true;
    case 'del-project':    deleteProject(id); return true;
    case 'project-today':  projectToday(id); return true;
    case 'project-start':  projectToday(id, true); return true;
    case 'project-finish': setProjectStatus(id, 'done'); return true;
    case 'project-reopen': setProjectStatus(id, 'active'); return true;
    case 'project-round':  projectRound(id); return true;
    case 'project-copy':   copyProject(id); return true;
    case 'new-subtask':    go('new', { projectId: id }); return true;
    case 'edit-sub':       go('edit-task', { id, projectId: pid }); return true;
    case 'sub-up':         moveSub(id, -1); return true;
    case 'sub-down':       moveSub(id, 1); return true;
    case 'sub-repeat':     repeatDone(pid, id); return true;
    case 'done-remove':    removeDone(pid, id); return true;
    case 'set-ppri':       setToggle('set-ppri', 'p-pri', el.dataset.val); return true;
    case 'set-pplan':      setToggle('set-pplan', 'p-plan', el.dataset.val); return true;
  }
  return false;
}
