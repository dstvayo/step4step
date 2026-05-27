'use strict';

/* ── Utils ── */
const uuid    = () => crypto.randomUUID();
const todayStr= () => new Date().toISOString().split('T')[0];
const fmt2    = n  => String(n).padStart(2,'0');
const fmtTime = s  => `${fmt2(Math.floor(Math.abs(s)/60))}:${fmt2(Math.abs(s)%60)}`;
const esc     = s  => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

/* ── State ── */
const S = { view:'welcome', tab:'inbox', params:{}, sessionResults:null };

/* ── Timer ── */
class TimerVM {
  constructor() { this.reset(); }
  reset() {
    this.queue=[]; this.done=[]; this.skipped=[];
    this.current=null; this.state='IDLE';
    this.timeLeft=0; this.intro=0; this._iv=null;
    this.startedAt=null; this.wakeLock=null; this.onTick=null;
    this.blockStartedAt=null; this.blockTotalMin=0;
    this.breakState='NONE'; this.breakLeft=0; this._breakIv=null;
  }
  get total() { return this.done.length+this.skipped.length+this.queue.length+(this.current?1:0); }
  load() {
    this.reset();
    this.queue = DB.getTasks().filter(t=>t.status==='today').sort((a,b)=>a.today_order-b.today_order);
  }
  begin() {
    if(!this.queue.length) return;
    this.blockStartedAt=Date.now();
    this.blockTotalMin=DB.getSetting('todayBlockMinutes',0);
    this._next();
  }
  get blockTimeLeft() {
    if(!this.blockStartedAt||!this.blockTotalMin) return null;
    return Math.max(0, this.blockTotalMin*60 - Math.floor((Date.now()-this.blockStartedAt)/1000));
  }
  _next() {
    this._stop();
    if(!this.queue.length) { this.current=null; this.state='ALL_DONE'; this._dropWL(); this._ping(); return; }
    this.current=this.queue.shift();
    this.timeLeft=this.current.estimated_minutes*60;
    this.intro=5; this.startedAt=Date.now(); this.state='INTRO';
    this._wakelock(); this._start();
  }
  _start() { this._iv=setInterval(()=>this._tick(),1000); }
  _stop()  { clearInterval(this._iv); this._iv=null; }
  _stopBreak() { clearInterval(this._breakIv); this._breakIv=null; }
  startBreak() {
    this.breakState='RUNNING'; this.breakLeft=300;
    this._breakIv=setInterval(()=>{
      this.breakLeft--;
      if(this.breakLeft<=0){ this.breakLeft=0; this.breakState='DONE'; this._stopBreak(); this._beep(); }
      this._ping();
    },1000);
  }
  _tick() {
    if(this.state==='INTRO') { this.intro--; if(this.intro<=0) this.state='RUNNING'; }
    else if(this.state==='RUNNING') {
      this.timeLeft--;
      if(this.timeLeft<=0) { this.timeLeft=0; this.state='FINISHED'; this._stop(); this._beep(); }
    }
    this._ping();
  }
  togglePause() {
    if(this.state==='RUNNING') { this.state='PAUSED'; this._stop(); }
    else if(this.state==='PAUSED') { this.state='RUNNING'; this._start(); }
    this._ping();
  }
  markDone() {
    const t=this.current;
    const earlyBonus=(this.state==='RUNNING'||this.state==='PAUSED')&&this.timeLeft>0?1:0;
    const actualMin=Math.max(1,Math.round((Date.now()-this.startedAt)/60000));
    t.status='done'; t.done_at=new Date().toISOString();
    t.actual_minutes=actualMin; t.score_bonus=earlyBonus;
    if(t.recurring) {
      DB.saveTask({...t, id:uuid(), status:'later', done_at:null, actual_minutes:null, score_bonus:0, today_order:0});
    }
    DB.saveTask(t); this.done.push(t); this._next();
  }
  skipTask() {
    const t=this.current; t.status='skipped'; DB.saveTask(t);
    this.skipped.push(t); this._next();
  }
  laterTask() { this.queue.push(this.current); this._next(); }
  advanceAfterFinish() { this.markDone(); }
  getResults() {
    const bonus=this.done.reduce((s,t)=>s+(t.score_bonus||0),0);
    const score=Math.max(0,this.done.length+bonus-this.skipped.length);
    return {
      id:uuid(), date:todayStr(),
      completed:this.done.length, skipped:this.skipped.length, planned:this.total,
      score, bonus_points:bonus, deduction_points:this.skipped.length,
      planned_minutes:[...this.done,...this.skipped].reduce((s,t)=>s+t.estimated_minutes,0),
      actual_minutes:this.done.reduce((s,t)=>s+(t.actual_minutes||0),0),
    };
  }
  _beep() {
    if(!DB.getSetting('sound',true)) return;
    try {
      const ac=new(window.AudioContext||window.webkitAudioContext)();
      [880,1100,1320].forEach((f,i)=>{ const o=ac.createOscillator(),g=ac.createGain();
        o.connect(g);g.connect(ac.destination);o.frequency.value=f;
        g.gain.setValueAtTime(.4,ac.currentTime+i*.2);
        g.gain.exponentialRampToValueAtTime(.01,ac.currentTime+i*.2+.25);
        o.start(ac.currentTime+i*.2);o.stop(ac.currentTime+i*.2+.25);
      });
    } catch(e){}
  }
  async _wakelock() { try{ if('wakeLock'in navigator)this.wakeLock=await navigator.wakeLock.request('screen'); }catch(e){} }
  _dropWL() { try{ this.wakeLock?.release();this.wakeLock=null; }catch(e){} }
  _ping() { this.onTick?.(); }
}
const Timer=new TimerVM();

/* ── Router ── */
function go(view,params={}) {
  S.view=view; S.params=params;
  if(['inbox','new','today','timer','history'].includes(view)) S.tab=view;
  if(view!=='timer') { Timer.onTick=null; }
  render();
}

/* ── Render ── */
function render() {
  if(S.view==='timer'&&Timer.breakState==='DONE') {
    DB.saveResult(Timer.getResults()); DB.setSetting('todayBlockMinutes',0); Timer.reset(); go('inbox'); return;
  }
  document.documentElement.setAttribute('data-theme',DB.getSetting('theme','light'));
  document.documentElement.setAttribute('data-font',DB.getSetting('fontSize','normal'));
  const map={welcome:vWelcome,inbox:vInbox,new:vNewTask,today:vToday,timer:vTimer,
             history:vHistory,'edit-task':vEditTask,results:vResults,settings:vSettings,categories:vCategories};
  document.getElementById('app').innerHTML=(map[S.view]||vInbox)();
  afterRender();
}

function afterRender() {
  if(S.view==='today') initDnD();
  if(S.view==='timer') Timer.onTick=render;
  window.scrollTo(0,0);
}

/* ── Tab Bar ── */
const TABS=[
  {id:'inbox',  icon:'📋',label:'Aufgaben'},
  {id:'new',    icon:'➕',label:'Neu'},
  {id:'today',  icon:'📅',label:'Heute'},
  {id:'timer',  icon:'⏱️',label:'Timer'},
  {id:'history',icon:'📊',label:'Historie'},
];
const tabBar=()=>`<nav class="tabbar">${TABS.map(t=>`<button class="tab${S.tab===t.id?' active':''}" data-action="go" data-view="${t.id}"><span class="tab-icon">${t.icon}</span><span class="tab-label">${t.label}</span></button>`).join('')}</nav>`;
const hdr=(title,back=false)=>`<header class="header"><div class="header-left">${back?`<button class="btn-icon" data-action="back">‹</button>`:`<span class="logo">S4S</span>`}</div><h1 class="header-title">${title}</h1><div class="header-right"><button class="btn-icon" data-action="go" data-view="settings">⚙️</button></div></header>`;

/* ── Welcome ── */
function vWelcome() {
  return `<div class="view view-welcome"><div class="welcome-content">
    <div class="logo-big">S4S</div>
    <h2 class="welcome-title">Step4Step</h2>
    <p class="welcome-subtitle">Dein persönlicher Motivator</p>
    <div class="onboarding-steps">
      <div class="onboard-step"><span class="step-icon">📋</span><span>Sammeln</span><span class="step-arrow"> → </span></div>
      <div class="onboard-step"><span class="step-icon">📅</span><span>Heute planen</span><span class="step-arrow"> → </span></div>
      <div class="onboard-step"><span class="step-icon">⏱️</span><span>Erledigen</span><span class="step-arrow"> → </span></div>
      <div class="onboard-step"><span class="step-icon">🎉</span><span>Happy sein!</span></div>
    </div>
    <button class="btn btn-primary btn-lg" data-action="welcome-start">Willkommen ›</button>
    <label class="checkbox-label"><input type="checkbox" id="hideWelcome"> Beim nächsten Start nicht mehr anzeigen</label>
  </div></div>`;
}

/* ── Inbox ── */
function vInbox() {
  const cats=DB.getCategories();
  const fCat=S.params.fCat||'all', fPri=S.params.fPri||'all', q=S.params.q||'';
  let tasks=DB.getTasks().filter(t=>['later','today','skipped'].includes(t.status));
  if(fCat!=='all') tasks=tasks.filter(t=>t.category===fCat);
  if(fPri!=='all') tasks=tasks.filter(t=>t.priority===fPri);
  if(q) tasks=tasks.filter(t=>t.title.toLowerCase().includes(q.toLowerCase()));
  const pL={low:'Niedrig',medium:'Mittel',high:'Hoch'};
  const pC={low:'badge-low',medium:'badge-medium',high:'badge-high'};
  return `<div class="view">${tabBar()}
    <div class="sticky-header">
      ${hdr('Aufgaben')}
      <p class="sticky-hint">Wähle hier deine Aufgaben für Heute.</p>
      <div class="filters">
        <input type="search" class="search-input" placeholder="Aufgabe suchen…" value="${esc(q)}" data-action="search">
        <div class="filter-row">
          <select class="select-sm" data-action="fcat">
            <option value="all" ${fCat==='all'?'selected':''}>Alle Kategorien</option>
            ${cats.map(c=>`<option value="${esc(c.name)}" ${fCat===c.name?'selected':''}>${esc(c.name)}</option>`).join('')}
          </select>
          <select class="select-sm" data-action="fpri">
            <option value="all" ${fPri==='all'?'selected':''}>Alle Prioritäten</option>
            ${['low','medium','high'].map(p=>`<option value="${p}" ${fPri===p?'selected':''}>${pL[p]}</option>`).join('')}
          </select>
        </div>
      </div>
    </div>
    <div class="content">
      ${tasks.length===0
        ?`<div class="empty-state"><div class="empty-icon">📋</div><p>Keine Aufgaben gefunden.</p><button class="btn btn-primary" data-action="go" data-view="new">Neue Aufgabe ➕</button></div>`
        :tasks.map(t=>`<div class="task-card${t.status==='today'?' task-today':''}">
          <div class="task-main" data-action="edit" data-id="${t.id}">
            <div class="task-title">${esc(t.title)}</div>
            <div class="task-meta">
              <span class="badge ${pC[t.priority]}">${pL[t.priority]}</span>
              <span class="badge badge-cat">${esc(t.category)}</span>
              <span class="task-time">⏱ ${t.estimated_minutes} min</span>
              ${t.recurring?'<span class="badge badge-rec">🔄</span>':''}
            </div>
          </div>
          <div class="task-actions">
            ${t.status!=='today'
              ?`<button class="btn btn-sm btn-today" data-action="add-today" data-id="${t.id}">📅 Heute</button>`
              :`<span class="badge badge-today">✓ Heute</span>`}
            <button class="btn btn-sm btn-danger-sm" data-action="del-task" data-id="${t.id}">🗑️</button>
          </div>
        </div>`).join('')}
    </div>
  </div>`;
}

/* ── New / Edit Task ── */
function vNewTask(task=null) {
  const cats=DB.getCategories();
  const isEdit=!!task;
  const t=task||{title:'',category:cats[0]?.name||'Privat',priority:'medium',estimated_minutes:5,status:'later',recurring:false};
  const times=[5,10,15,30,45,60];
  const pL={low:'Niedrig',medium:'Mittel',high:'Hoch'};
  return `<div class="view">${tabBar()}
    ${hdr(isEdit?'Bearbeiten':'Neue Aufgabe',isEdit)}
    <div class="content">
      <form class="form" id="task-form">
        <input type="hidden" id="f-id" value="${t.id||''}">
        <div class="form-group">
          <label class="form-label">Titel *</label>
          <input type="text" id="f-title" class="form-input" placeholder="Was möchtest du erledigen?" value="${esc(t.title)}" required autofocus>
        </div>
        <div class="form-group">
          <label class="form-label">Kategorie</label>
          <div class="form-row">
            <select id="f-cat" class="form-select">
              ${cats.map(c=>`<option value="${esc(c.name)}" ${t.category===c.name?'selected':''}>${esc(c.name)}</option>`).join('')}
            </select>
            <button type="button" class="btn btn-sm btn-secondary" data-action="go" data-view="categories">+</button>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Priorität</label>
          <div class="btn-group">
            ${['low','medium','high'].map(p=>`<button type="button" class="btn btn-toggle${t.priority===p?' active':''}" data-action="set-pri" data-val="${p}">${pL[p]}</button>`).join('')}
          </div>
          <input type="hidden" id="f-pri" value="${t.priority}">
        </div>
        <div class="form-group">
          <label class="form-label">Geschätzte Zeit</label>
          <div class="btn-group" id="time-btns">
            ${times.map(m=>`<button type="button" class="btn btn-toggle${t.estimated_minutes===m?' active':''}" data-action="set-time" data-val="${m}">${m} min</button>`).join('')}
          </div>
          <input type="number" id="f-time" class="form-input mt-sm" placeholder="Benutzerdefiniert (min)" value="${t.estimated_minutes}" min="1" max="480">
        </div>
        <div class="form-group">
          <label class="form-label">Wann?</label>
          <div class="btn-group">
            <button type="button" class="btn btn-toggle${t.status==='later'?' active':''}" data-action="set-status" data-val="later">Später</button>
            <button type="button" class="btn btn-toggle${t.status==='today'?' active':''}" data-action="set-status" data-val="today">Heute</button>
          </div>
          <input type="hidden" id="f-status" value="${t.status}">
        </div>
        <div class="form-group">
          <label class="checkbox-label">
            <input type="checkbox" id="f-rec" ${t.recurring?'checked':''}> Wiederkehrende Aufgabe 🔄
          </label>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" data-action="back">Abbrechen</button>
          <button type="button" class="btn btn-primary" data-action="save-task">${isEdit?'Speichern ✓':'Aufgabe anlegen ✓'}</button>
        </div>
      </form>
    </div>
  </div>`;
}

function vEditTask() {
  const t=DB.getTasks().find(t=>t.id===S.params.id);
  if(!t){go('inbox');return'';}
  return vNewTask(t);
}

/* ── Today ── */
function vToday() {
  const tasks=DB.getTasks().filter(t=>t.status==='today').sort((a,b)=>a.today_order-b.today_order);
  const totalMin=tasks.reduce((s,t)=>s+t.estimated_minutes,0);
  const blockMin=DB.getSetting('todayBlockMinutes',0);
  const noBlock=blockMin===0;
  const pC={low:'badge-low',medium:'badge-medium',high:'badge-high'};
  return `<div class="view">${tabBar()}
    <div class="sticky-header">
      ${hdr('Heute')}
      ${noBlock
        ?`<div class="block-setup card">
            <p class="block-setup-text">⏰ Lege zuerst deinen Zeitblock fest:</p>
            <div class="block-setup-row">
              <input type="number" id="block-min" class="form-input input-sm" placeholder="Min" min="5" max="600" value="120">
              <button class="btn btn-primary" data-action="set-block">Block festlegen</button>
            </div>
          </div>`
        :`<div class="today-stats">
            <span class="stat-item">📋 ${tasks.length} Aufgaben</span>
            <span class="stat-item">⏱ ${totalMin} / ${blockMin} min</span>
            <span class="stat-item ${totalMin>blockMin?'stat-over':'stat-ok'}">${blockMin-totalMin>=0?blockMin-totalMin+' min frei':Math.abs(blockMin-totalMin)+' min über'}</span>
            <button class="btn-link" data-action="reset-block">ändern</button>
          </div>`}
      <p class="sticky-hint">Sortiere deine Aufgaben und leg los.</p>
    </div>
    <div class="content" id="today-list">
      ${tasks.length===0
        ?`<div class="empty-state"><div class="empty-icon">📅</div><p>Noch keine Aufgaben für heute.</p><p>Gehe zu <strong>Aufgaben</strong> und füge Aufgaben hinzu.</p></div>`
        :tasks.map((t,i)=>`<div class="task-card draggable" draggable="true" data-id="${t.id}" data-i="${i}">
            <div class="drag-handle">⠿</div>
            <div class="task-main">
              <div class="task-title">${esc(t.title)}</div>
              <div class="task-meta">
                <span class="badge ${pC[t.priority]}">${t.estimated_minutes} min</span>
                <span class="badge badge-cat">${esc(t.category)}</span>
                ${t.recurring?'<span class="badge badge-rec">🔄</span>':''}
              </div>
            </div>
            <div class="task-actions">
              <button class="btn btn-sm btn-danger-sm" data-action="rm-today" data-id="${t.id}">✕</button>
            </div>
          </div>`).join('')}
    </div>
    ${tasks.length>0?`<div class="footer-fixed">
      <p class="footer-hint">Wenn du deine Aufgaben sortiert hast, lege los!</p>
      <button class="btn btn-primary btn-lg btn-full" data-action="start-timer">▶ Jetzt starten</button>
    </div>`:''}
  </div>`;
}

/* ── Timer ── */
function vTimer() {
  const t=Timer.current;

  /* IDLE */
  if(Timer.state==='IDLE') {
    const todayN=DB.getTasks().filter(t=>t.status==='today').length;
    return `<div class="view">${tabBar()}${hdr('Timer')}
      <div class="content center-content">
        <div class="empty-icon">⏱️</div>
        ${todayN>0
          ?`<p>Du hast ${todayN} Aufgabe(n) in der Heute-Liste.</p><button class="btn btn-primary" data-action="go" data-view="today">Zur Heute-Liste →</button>`
          :`<p>Erstelle erst deine Heute-Liste und starte den Timer.</p><button class="btn btn-primary" data-action="go" data-view="inbox">Zu den Aufgaben →</button>`}
      </div></div>`;
  }

  /* PAUSE / BREAK */
  if(Timer.breakState==='RUNNING') {
    return `<div class="view">${tabBar()}${hdr('Pause')}
      <div class="content center-content">
        <div class="break-cup">☕</div>
        <p class="break-title">Gönn dir eine kurze Pause!</p>
        <div class="countdown-time break-countdown">${fmtTime(Timer.breakLeft)}</div>
        <p class="break-hint">Der Timer schließt sich automatisch nach Ablauf.</p>
      </div></div>`;
  }

  /* ALL DONE */
  if(Timer.state==='ALL_DONE') {
    return `<div class="view">${tabBar()}
      <div class="sticky-header">${hdr('Timer')}</div>
      <div class="content">
        <div class="alldone-header">
          <div class="alldone-icon">🎉</div>
          <h2 class="alldone-title">Alle Aufgaben erledigt!</h2>
          <p class="alldone-sub">Hervorragende Arbeit! Dein Block ist abgeschlossen.</p>
        </div>
        ${Timer.done.length>0?`<div class="card">
          <h3 class="card-title">✓ Erledigte Aufgaben (${Timer.done.length})</h3>
          ${Timer.done.map(d=>`<div class="done-task-row">
            <span class="done-check">✓</span>
            <span class="done-title">${esc(d.title)}</span>
            <span class="done-time">${d.actual_minutes} min</span>
            ${d.score_bonus?'<span class="badge badge-rec">⚡</span>':''}
          </div>`).join('')}
        </div>`:''}
        ${Timer.skipped.length>0?`<div class="card">
          <h3 class="card-title">⊘ Übersprungen (${Timer.skipped.length})</h3>
          ${Timer.skipped.map(d=>`<div class="done-task-row skipped-row">
            <span class="done-check skipped-x">✗</span>
            <span class="done-title">${esc(d.title)}</span>
          </div>`).join('')}
        </div>`:''}
      </div>
      <div class="footer-fixed">
        <div class="alldone-buttons">
          <button class="btn btn-secondary btn-lg" data-action="t-break">☕ 5 Min Pause</button>
          <button class="btn btn-primary btn-lg" data-action="t-end-block">✓ Block beenden</button>
        </div>
      </div>
    </div>`;
  }

  /* ACTIVE (INTRO / RUNNING / PAUSED / FINISHED) */
  const isIntro=Timer.state==='INTRO',isPaused=Timer.state==='PAUSED',isFinished=Timer.state==='FINISHED';
  const pct=t?Math.max(0,(Timer.timeLeft/(t.estimated_minutes*60))*100):0;
  const bLeft=Timer.blockTimeLeft;
  const bPct=bLeft!==null&&Timer.blockTotalMin>0?Math.max(0,(bLeft/(Timer.blockTotalMin*60))*100):null;

  return `<div class="view">${tabBar()}
    <div class="sticky-header">${hdr('Timer')}</div>
    <div class="content timer-content">

      ${isIntro?`<div class="intro-countdown">
        <p class="intro-text">Mach dich bereit…</p>
        <div class="countdown-big">${Timer.intro}</div>
      </div>`:''}

      ${t&&!isIntro?`
        <p class="timer-motivation">Fokussiere dich jetzt auf deine Aufgabe. Bist du schneller, bestätige mit dem Button <strong>„Fertig"</strong>.</p>

        <div class="timer-task card">
          <div class="task-title-lg">${esc(t.title)}</div>
          <div class="task-meta" style="justify-content:center;margin-top:6px">
            <span class="badge badge-cat">${esc(t.category)}</span>
            <span class="badge">${t.estimated_minutes} min geplant</span>
            ${t.recurring?'<span class="badge badge-rec">🔄</span>':''}
          </div>
        </div>

        <div class="timer-display${isFinished?' timer-done':''}">
          <div class="countdown-time">${fmtTime(Timer.timeLeft)}</div>
          <div class="timer-progress-bar"><div class="timer-progress-fill" style="width:${pct}%"></div></div>
        </div>

        ${bLeft!==null?`<div class="block-timer">
          <div class="block-timer-row">
            <span class="block-timer-label">⏰ Block verbleibend</span>
            <span class="block-timer-time${bLeft<300?' block-warn':''}">${fmtTime(bLeft)}</span>
            <span class="block-timer-total">von ${Timer.blockTotalMin} min</span>
          </div>
          ${bPct!==null?`<div class="block-progress-bar"><div class="block-progress-fill${bLeft<300?' block-fill-warn':''}" style="width:${bPct}%"></div></div>`:''}
        </div>`:''}

        <div class="timer-stats">
          <span>✓ ${Timer.done.length} erledigt</span>
          <span>◎ ${Timer.queue.length+1} verbleibend</span>
          <span>⊘ ${Timer.skipped.length} übersprungen</span>
        </div>

        ${isFinished?`<div class="alert alert-success">🎉 Geschafft! Super gemacht!</div>`:''}

        ${Timer.done.length>0?`<div class="done-list-mini card">
          <p class="done-list-title">✓ Bereits erledigt</p>
          ${Timer.done.map(d=>`<div class="done-task-row">
            <span class="done-check">✓</span>
            <span class="done-title">${esc(d.title)}</span>
            <span class="done-time">${d.actual_minutes} min</span>
          </div>`).join('')}
        </div>`:''}
      `:''}
    </div>

    <div class="footer-fixed">
      ${isFinished
        ?`<button class="btn btn-primary btn-full btn-lg" data-action="t-advance">Zur nächsten Aufgabe ›</button>`
        :`<div class="timer-buttons">
          <button class="btn ${isPaused?'btn-primary':'btn-secondary'}" data-action="t-pause">${isPaused?'▶ Weiter':'⏸ Pause'}</button>
          <button class="btn btn-success" data-action="t-done">✓ Fertig</button>
          <button class="btn btn-secondary" data-action="t-later">↓ Später</button>
          <button class="btn btn-warning" data-action="t-skip">⏭ Überspringen</button>
        </div>`}
    </div>
  </div>`;
}

/* ── Results ── */
function vResults() {
  const r=S.sessionResults;
  if(!r){go('inbox');return'';}
  const cls=r.score>=8?'score-green':r.score>=5?'score-yellow':'score-red';
  const msg=r.score>=8?'Hervorragend! Du bist ein Champion! 🏆':r.score>=5?'Gut gemacht! Weiter so! 👍':'Da geht noch mehr! Du schaffst das! 💪';
  return `<div class="view"><div class="sticky-header">${hdr('Ergebnisse',false)}</div>
    <div class="content center-content">
      <div class="results-card card">
        <div class="results-score ${cls}">${r.score}</div>
        <div class="results-score-label">Punkte</div>
        <p class="results-message">${msg}</p>
        <div class="results-stats">
          <div class="result-stat"><div class="result-stat-value">${r.completed}/${r.planned}</div><div class="result-stat-label">Aufgaben erledigt</div></div>
          <div class="result-stat"><div class="result-stat-value">${r.actual_minutes}/${r.planned_minutes}</div><div class="result-stat-label">Minuten (ist/plan)</div></div>
          ${r.skipped>0?`<div class="result-stat"><div class="result-stat-value">${r.skipped}</div><div class="result-stat-label">Übersprungen</div></div>`:''}
        </div>
        <div class="results-breakdown">
          <p class="breakdown-title">Punkte-Aufschlüsselung</p>
          <p>✓ ${r.completed} Aufgaben × 1 = ${r.completed} Pkt</p>
          ${r.bonus_points>0?`<p>⚡ Bonus (vorzeitig fertig): +${r.bonus_points} Pkt</p>`:''}
          ${r.deduction_points>0?`<p>✗ ${r.deduction_points} übersprungen × -1 = -${r.deduction_points} Pkt</p>`:''}
          <p><strong>Gesamt: ${r.score} Punkte</strong></p>
        </div>
      </div>
      <button class="btn btn-primary btn-lg btn-full" data-action="save-results">✓ Arbeit abschließen</button>
    </div>
  </div>`;
}

/* ── History ── */
function vHistory() {
  const results=DB.getResults();
  const byDate=Object.fromEntries(results.map(r=>[r.date,r]));
  const ref=S.params.calDate?new Date(S.params.calDate):new Date();
  const yr=ref.getFullYear(),mo=ref.getMonth();
  const first=new Date(yr,mo,1),last=new Date(yr,mo+1,0);
  const startDow=(first.getDay()+6)%7;
  const mNames=['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
  const dNames=['Mo','Di','Mi','Do','Fr','Sa','So'];
  const cells=[];
  for(let i=0;i<startDow;i++)cells.push(null);
  for(let d=1;d<=last.getDate();d++){
    const ds=`${yr}-${fmt2(mo+1)}-${fmt2(d)}`;
    cells.push({d,ds,r:byDate[ds]});
  }
  const moStr=`${yr}-${fmt2(mo+1)}`;
  const moRes=results.filter(r=>r.date.startsWith(moStr));
  const moTasks=moRes.reduce((s,r)=>s+r.completed,0);
  const moMin=moRes.reduce((s,r)=>s+r.actual_minutes,0);
  const totalScore=results.reduce((s,r)=>s+r.score,0);
  const level=Math.floor(totalScore/10)+1;
  const lpct=(totalScore%10)*10;
  const prevDt=new Date(yr,mo-1,1).toISOString().split('T')[0];
  const nextDt=new Date(yr,mo+1,1).toISOString().split('T')[0];
  const week=getWeek(results);
  const sc=s=>s>=8?'score-green':s>=5?'score-yellow':'score-red';
  return `<div class="view">${tabBar()}<div class="sticky-header">${hdr('Historie')}</div>
    <div class="content">
      <div class="card level-card">
        <div class="level-info"><span class="level-badge">Level ${level}</span><span class="level-score">${totalScore} Gesamtpunkte</span></div>
        <div class="progress-bar"><div class="progress-fill" style="width:${lpct}%"></div></div>
        <p class="level-message">Da hast schon viel erreicht. Weiter so!</p>
        <div class="month-stats"><span>✓ ${moTasks} Aufgaben diesen Monat</span><span>⏱ ${moMin} Fokus-Minuten</span></div>
      </div>
      <div class="card calendar-card">
        <div class="cal-header">
          <button class="btn-icon" data-action="cal-nav" data-date="${prevDt}">‹</button>
          <h3 class="cal-title">${mNames[mo]} ${yr}</h3>
          <button class="btn-icon" data-action="cal-nav" data-date="${nextDt}">›</button>
        </div>
        <div class="cal-grid">
          ${dNames.map(d=>`<div class="cal-day-header">${d}</div>`).join('')}
          ${cells.map(c=>c===null?'<div class="cal-cell empty"></div>'
            :`<div class="cal-cell${c.r?' '+sc(c.r.score):''}" title="${c.r?`Score: ${c.r.score} | ${c.r.completed} Aufgaben`:''}">
              <span class="cal-day-num">${c.d}</span>
              ${c.r?`<span class="cal-dot"></span>`:''}
            </div>`).join('')}
        </div>
        <div class="cal-legend">
          <span class="legend-item"><span class="dot dot-green"></span> ≥8 Sehr gut</span>
          <span class="legend-item"><span class="dot dot-yellow"></span> 5–7 Gut gemacht</span>
          <span class="legend-item"><span class="dot dot-red"></span> &lt;5 Da geht mehr!</span>
        </div>
      </div>
      ${week.length?`<div class="card"><h3 class="card-title">Letzte 7 Tage</h3>
        <table class="week-table">
          <thead><tr><th>Tag</th><th>Aufgaben</th><th>Min</th><th>Score</th></tr></thead>
          <tbody>${week.map(d=>`<tr><td>${d.label}</td><td>${d.tasks}</td><td>${d.min}</td><td class="${sc(d.score)}">${d.score}</td></tr>`).join('')}</tbody>
        </table></div>`:''}
    </div>
  </div>`;
}

function getWeek(results) {
  const dl=['So','Mo','Di','Mi','Do','Fr','Sa'];
  return Array.from({length:7},(_,i)=>{
    const d=new Date(); d.setDate(d.getDate()-(6-i));
    const ds=d.toISOString().split('T')[0];
    const r=results.find(r=>r.date===ds);
    return{label:dl[d.getDay()],tasks:r?r.completed:0,min:r?r.actual_minutes:0,score:r?r.score:0};
  });
}

/* ── Settings ── */
function vSettings() {
  const theme=DB.getSetting('theme','light'),fs=DB.getSetting('fontSize','normal'),snd=DB.getSetting('sound',true);
  return `<div class="view">${tabBar()}<div class="sticky-header">${hdr('Einstellungen',true)}</div>
    <div class="content">
      <div class="card settings-card">
        <h3 class="card-title">Erscheinungsbild</h3>
        <div class="setting-row">
          <label class="setting-label">Theme</label>
          <div class="btn-group">
            <button class="btn btn-toggle btn-sm${theme==='light'?' active':''}" data-action="set-theme" data-val="light">☀️ Hell</button>
            <button class="btn btn-toggle btn-sm${theme==='dark'?' active':''}" data-action="set-theme" data-val="dark">🌙 Dunkel</button>
          </div>
        </div>
        <div class="setting-row">
          <label class="setting-label">Schriftgröße</label>
          <div class="btn-group">
            <button class="btn btn-toggle btn-sm${fs==='normal'?' active':''}" data-action="set-font" data-val="normal">A</button>
            <button class="btn btn-toggle btn-sm${fs==='large'?' active':''}" data-action="set-font" data-val="large">A+</button>
            <button class="btn btn-toggle btn-sm${fs==='xlarge'?' active':''}" data-action="set-font" data-val="xlarge">A++</button>
          </div>
        </div>
      </div>
      <div class="card settings-card">
        <h3 class="card-title">Timer & Töne</h3>
        <div class="setting-row">
          <label class="setting-label">Ton bei Aufgaben-Ende</label>
          <label class="switch"><input type="checkbox" data-action="toggle-snd" ${snd?'checked':''}><span class="switch-slider"></span></label>
        </div>
      </div>
      <div class="card settings-card">
        <h3 class="card-title">Kategorien</h3>
        <button class="btn btn-secondary btn-full" data-action="go" data-view="categories">Kategorien verwalten →</button>
      </div>
      <div class="card settings-card">
        <h3 class="card-title">Zeitblock</h3>
        <div class="setting-row">
          <span class="setting-label">Heutigen Block zurücksetzen</span>
          <button class="btn btn-sm btn-secondary" data-action="reset-block">Reset</button>
        </div>
      </div>
      <div class="card settings-card danger-zone">
        <h3 class="card-title">Daten</h3>
        <button class="btn btn-danger btn-full" data-action="clear-all">Alle Daten löschen ⚠️</button>
      </div>
    </div>
  </div>`;
}

/* ── Categories ── */
function vCategories() {
  const cats=DB.getCategories();
  const colors=['#4f46e5','#0ea5e9','#10b981','#f59e0b','#ef4444','#ec4899','#8b5cf6','#6b7280'];
  return `<div class="view">${tabBar()}<div class="sticky-header">${hdr('Kategorien',true)}</div>
    <div class="content">
      ${cats.map(c=>`<div class="task-card">
        <span class="cat-dot" style="background:${c.color}"></span>
        <span class="cat-name">${esc(c.name)}</span>
        <div class="task-actions">
          <button class="btn btn-sm btn-danger-sm" data-action="del-cat" data-id="${c.id}">🗑️</button>
        </div>
      </div>`).join('')}
      <div class="card">
        <h3 class="card-title">Neue Kategorie</h3>
        <div class="form">
          <div class="form-group">
            <input type="text" id="cat-name" class="form-input" placeholder="Name der Kategorie">
          </div>
          <div class="form-group">
            <label class="form-label">Farbe</label>
            <div class="color-grid">
              ${colors.map((col,i)=>`<button type="button" class="color-swatch${i===0?' selected':''}" data-action="pick-color" data-color="${col}" style="background:${col}"></button>`).join('')}
            </div>
            <input type="hidden" id="cat-color" value="${colors[0]}">
          </div>
          <button type="button" class="btn btn-primary" data-action="add-cat">Kategorie hinzufügen ➕</button>
        </div>
      </div>
    </div>
  </div>`;
}

/* ── Event Delegation ── */
document.addEventListener('click', e=>{
  const el=e.target.closest('[data-action]'); if(!el) return;
  const {action,view,id,val,date,color}=el.dataset;
  switch(action) {
    case 'go':         go(view); break;
    case 'back':       goBack(); break;
    case 'welcome-start': {
      if(document.getElementById('hideWelcome')?.checked) DB.setSetting('hideWelcome',true);
      go('inbox'); break;
    }
    case 'edit':       go('edit-task',{id}); break;
    case 'add-today':  addToday(id); break;
    case 'rm-today':   rmToday(id); break;
    case 'del-task':   delTask(id); break;
    case 'save-task':  saveTask(); break;
    case 'set-block':  setBlock(); break;
    case 'reset-block':DB.setSetting('todayBlockMinutes',0); render(); break;
    case 'start-timer':startTimer(); break;
    case 't-pause':    Timer.togglePause(); break;
    case 't-done':     Timer.markDone(); break;
    case 't-skip':     Timer.skipTask(); break;
    case 't-later':    Timer.laterTask(); break;
    case 't-advance':  Timer.advanceAfterFinish(); break;
    case 't-end-block':endBlock(); break;
    case 't-break':    Timer.startBreak(); break;
    case 'save-results':saveResults(); break;
    case 'cal-nav':    go('history',{calDate:date}); break;
    case 'set-theme':  DB.setSetting('theme',val); render(); break;
    case 'set-font':   DB.setSetting('fontSize',val); render(); break;
    case 'clear-all':  if(confirm('Alle Daten wirklich löschen?')){localStorage.clear();location.reload();} break;
    case 'del-cat':    if(confirm('Kategorie löschen?')){DB.deleteCategory(id);render();} break;
    case 'add-cat':    addCat(); break;
    case 'pick-color': pickColor(color); break;
    case 'set-pri':    setToggle('set-pri','f-pri',val); break;
    case 'set-time':   setToggle('set-time','f-time',val); break;
    case 'set-status': setToggle('set-status','f-status',val); break;
  }
});

document.addEventListener('change', e=>{
  const {action}=e.target.dataset;
  if(action==='toggle-snd') DB.setSetting('sound',e.target.checked);
  if(action==='search'){S.params.q=e.target.value;render();}
  if(action==='fcat'){S.params.fCat=e.target.value;render();}
  if(action==='fpri'){S.params.fPri=e.target.value;render();}
});

document.addEventListener('input', e=>{
  const {action}=e.target.dataset;
  if(action==='search'){S.params.q=e.target.value;render();}
  // Sync custom time input with button group
  if(e.target.id==='f-time'){
    document.querySelectorAll('[data-action="set-time"]').forEach(b=>b.classList.toggle('active',b.dataset.val===e.target.value));
  }
});

/* ── Actions ── */
function goBack() {
  const m={'edit-task':'inbox',settings:'inbox',categories:'settings',results:'inbox'};
  go(m[S.view]||S.tab||'inbox');
}

function setToggle(actionName, inputId, val) {
  document.querySelectorAll(`[data-action="${actionName}"]`).forEach(b=>b.classList.toggle('active',b.dataset.val===val));
  const el=document.getElementById(inputId); if(el) el.value=val;
}

function saveTask() {
  const title=document.getElementById('f-title')?.value?.trim();
  if(!title){alert('Bitte einen Titel eingeben.');return;}
  const id=document.getElementById('f-id')?.value||uuid();
  const existing=DB.getTasks().find(t=>t.id===id);
  const status=document.getElementById('f-status')?.value||'later';
  const estMin=parseInt(document.getElementById('f-time')?.value)||5;
  if(status==='today'&&(!existing||existing.status!=='today')) {
    if(!checkBlock(estMin)) return;
  }
  const todayTasks=DB.getTasks().filter(t=>t.status==='today');
  DB.saveTask({
    id, title,
    category: document.getElementById('f-cat')?.value||'Privat',
    priority: document.getElementById('f-pri')?.value||'medium',
    estimated_minutes: estMin, status, recurring: document.getElementById('f-rec')?.checked||false,
    today_order: existing?.today_order??(status==='today'?todayTasks.length:0),
    created_at: existing?.created_at||new Date().toISOString(),
    done_at: existing?.done_at||null, actual_minutes: existing?.actual_minutes||null, score_bonus: existing?.score_bonus||0,
  });
  go('inbox');
}

function addToday(id) {
  const t=DB.getTasks().find(t=>t.id===id);
  if(!t||t.status==='today') return;
  if(!checkBlock(t.estimated_minutes)) return;
  t.status='today'; t.today_order=DB.getTasks().filter(x=>x.status==='today').length;
  DB.saveTask(t); render();
}

function rmToday(id) {
  const t=DB.getTasks().find(t=>t.id===id); if(!t) return;
  t.status='later'; t.today_order=0; DB.saveTask(t); render();
}

function delTask(id) { if(confirm('Aufgabe wirklich löschen?')){DB.deleteTask(id);render();} }

function checkBlock(addMin) {
  const bMin=DB.getSetting('todayBlockMinutes',0); if(!bMin) return true;
  const used=DB.getTasks().filter(t=>t.status==='today').reduce((s,t)=>s+t.estimated_minutes,0);
  if(used+addMin>bMin){alert(`⚠️ Zeitblock überschritten!\n\nGeplant: ${used+addMin} min\nBlock: ${bMin} min\n\nErweitere deinen Block oder belasse die Aufgabe in der Liste.`);return false;}
  return true;
}

function setBlock() {
  const v=parseInt(document.getElementById('block-min')?.value)||120;
  DB.setSetting('todayBlockMinutes',v); render();
}

function startTimer() {
  Timer.load();
  if(!Timer.queue.length){alert('Keine Aufgaben in der Heute-Liste!');return;}
  Timer.begin(); go('timer');
}

function endBlock() {
  DB.saveResult(Timer.getResults());
  Timer.done.forEach(t=>DB.deleteTask(t.id));
  DB.setSetting('todayBlockMinutes',0);
  Timer.reset(); go('inbox');
}

function saveResults() {
  if(!S.sessionResults) return;
  DB.saveResult(S.sessionResults);
  DB.setSetting('todayBlockMinutes',0);
  S.sessionResults=null; Timer.reset(); go('inbox');
}

function addCat() {
  const name=document.getElementById('cat-name')?.value?.trim();
  if(!name){alert('Bitte einen Namen eingeben.');return;}
  const color=document.getElementById('cat-color')?.value||'#4f46e5';
  DB.saveCategory({id:uuid(),name,color}); render();
}

function pickColor(color) {
  document.querySelectorAll('.color-swatch').forEach(b=>b.classList.remove('selected'));
  document.querySelector(`[data-color="${color}"]`)?.classList.add('selected');
  const el=document.getElementById('cat-color'); if(el) el.value=color;
}

/* ── Drag & Drop (Today) ── */
function initDnD() {
  const list=document.getElementById('today-list'); if(!list) return;
  let src=null;

  list.querySelectorAll('.draggable').forEach(el=>{
    el.addEventListener('dragstart',e=>{
      src=el;
      e.dataTransfer.effectAllowed='move';
      e.dataTransfer.setData('text/plain',el.dataset.id); // Safari + Firefox erforderlich
      setTimeout(()=>el.classList.add('dragging'),0);
    });
    el.addEventListener('dragend',()=>{
      el.classList.remove('dragging');
      list.querySelectorAll('.drag-over').forEach(x=>x.classList.remove('drag-over'));
      src=null;
    });
    el.addEventListener('dragover',e=>{
      e.preventDefault();
      e.dataTransfer.dropEffect='move';
      if(el!==src) el.classList.add('drag-over');
    });
    el.addEventListener('dragleave',e=>{
      if(!el.contains(e.relatedTarget)) el.classList.remove('drag-over');
    });
    el.addEventListener('drop',e=>{
      e.preventDefault(); e.stopPropagation();
      el.classList.remove('drag-over');
      if(!src||src===el) return;
      const all=[...list.querySelectorAll('.draggable')];
      all.indexOf(src)<all.indexOf(el)?el.after(src):el.before(src);
      [...list.querySelectorAll('.draggable')].forEach((c,i)=>{
        const t=DB.getTasks().find(t=>t.id===c.dataset.id);
        if(t){t.today_order=i; DB.saveTask(t);}
      });
    });
  });

  list.addEventListener('dragover',e=>e.preventDefault());
  list.addEventListener('drop',e=>e.preventDefault());
}

/* ── Init ── */
function init() {
  if(DB.getSetting('hideWelcome',false)){S.view='inbox';S.tab='inbox';}
  render();
}
init();
