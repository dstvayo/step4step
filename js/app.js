'use strict';

/* ── Utils ── */
const uuid    = () => crypto.randomUUID();
const fmt2    = n  => String(n).padStart(2,'0');
const ymd     = d  => `${d.getFullYear()}-${fmt2(d.getMonth()+1)}-${fmt2(d.getDate())}`; // lokales Datum
const todayStr= () => ymd(new Date());
const fmtTime = s  => `${s<0?'-':''}${fmt2(Math.floor(Math.abs(s)/60))}:${fmt2(Math.abs(s)%60)}`;
const esc     = s  => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

/* ── Shared AudioContext (iOS Safari unlock) ── */
let _sharedAC = null;
function _getAC() {
  if (!_sharedAC) _sharedAC = new (window.AudioContext || window.webkitAudioContext)();
  return _sharedAC;
}
['touchstart','click'].forEach(ev => {
  document.addEventListener(ev, function _unlock() {
    try { const ac = _getAC(); if (ac.state === 'suspended') ac.resume(); } catch(e){}
    document.removeEventListener(ev, _unlock);
  }, {once:true, passive:true});
});

/* ── State ── */
const S = {
  view:'welcome', tab:'inbox', params:{}, sessionResults:null,
  aiLoading:false, aiError:null,
  focusResult:null,   // {recommendations:[{task,reason}], meta:{minutes,energy,conc}}
  dailyPlan:null,     // string
  decomposeResult:null, // {taskId, taskTitle, subtasks:[]}
};

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
    this.overtimeMax=0; this._pausedState='RUNNING';
    this._pausedSec=0; this._pauseStartedAt=null; // Hintergrund-Timer
    this._notified=false;
    this.blockBase=0; // Summe der Grundpunkte aller Aufgaben beim Blockstart
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
    this.blockBase=Points.blockMax(this.queue).base;
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
    this.intro=10; this._pausedSec=0; this._pauseStartedAt=null; this._notified=false;
    this.state='READY';
    this._saveTimerState();
    this._wakelock(); this._ping();
  }
  startTask() {
    if(this.state!=='READY') return;
    this.startedAt=Date.now(); this.state='INTRO'; this._start(); this._ping();
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
    if(!this.current||this.state==='PAUSED'||this.state==='READY') return;
    const elapsed=(Date.now()-this.startedAt)/1000 - this._pausedSec;
    if(elapsed<10) {
      this.intro=Math.max(0,Math.ceil(10-elapsed));
      this.state='INTRO'; this._ping(); return;
    }
    const taskElapsed=elapsed-10;
    const total=this.current.estimated_minutes*60;
    const newLeft=total-taskElapsed;
    if(newLeft>0) {
      this.timeLeft=Math.round(newLeft);
      if(this.state==='INTRO') this.state='RUNNING';
    } else {
      if(this.state==='RUNNING'||this.state==='INTRO') {
        this.state='OVERTIME';
        this.overtimeMax=this.blockTimeLeft??(total);
        if(!this.overtimeMax) this.overtimeMax=total;
        this._beep();
        if(!this._notified){ this._notified=true; _sendTimerNotification(this.current.title); }
      }
      this.timeLeft=Math.round(newLeft); // negativ in Overtime
      if(-this.timeLeft>=this.overtimeMax){ this.timeLeft=-this.overtimeMax; this._stop(); }
    }
    this._ping();
  }
  togglePause() {
    if(this.state==='RUNNING'||this.state==='OVERTIME') {
      this._pausedState=this.state; this.state='PAUSED'; this._stop();
      this._pauseStartedAt=Date.now();
    } else if(this.state==='PAUSED') {
      this._pausedSec+=(Date.now()-this._pauseStartedAt)/1000;
      this._pauseStartedAt=null;
      this.state=this._pausedState; this._start();
    }
    this._ping();
  }
  _saveTimerState() {
    if(!this.current) { localStorage.removeItem('timer_running'); return; }
    localStorage.setItem('timer_running', JSON.stringify({
      taskId:this.current.id, startedAt:this.startedAt,
      pausedSec:this._pausedSec, state:this.state,
      blockStartedAt:this.blockStartedAt, blockTotalMin:this.blockTotalMin,
      queueIds:this.queue.map(t=>t.id), doneIds:this.done.map(t=>t.id),
    }));
  }
  markDone() {
    const t=this.current, now=Date.now();
    const late=this.state==='OVERTIME'||(this.state==='PAUSED'&&this._pausedState==='OVERTIME');
    // Echte Arbeitszeit: ohne 10-s-Countdown und ohne Pausen (auch eine gerade laufende)
    const pausedSec=this._pausedSec+(this.state==='PAUSED'&&this._pauseStartedAt?(now-this._pauseStartedAt)/1000:0);
    const workSec=Math.max(0,(now-this.startedAt)/1000-pausedSec-10);
    const actualMin=Math.max(1,Math.round(workSec/60));
    t.status='done'; t.done_at=new Date(now).toISOString();
    t.actual_minutes=actualMin; t.on_time=!late; t.points=Points.earned(t,late);
    t.series_id=t.series_id||t.id;
    logDone(t);
    if(t.recurring) {
      DB.saveTask({...t, id:uuid(), status:'later', done_at:null, actual_minutes:null, on_time:null, points:null, today_order:0, postpone_count:0,
        estimated_minutes:Estimate.learnedMinutes(t.series_id,t.title)||t.estimated_minutes});
    }
    DB.saveTask(t); this.done.push(t); this._next();
  }
  skipTask() {
    const t=this.current; t.status='skipped'; DB.saveTask(t);
    logEvent(t,'skipped');
    this.skipped.push(t); this._next();
  }
  laterTask() { this.queue.push(this.current); this._next(); }
  advanceAfterFinish() { this.markDone(); }
  /* Punkte: erreicht / noch erreichbar / Bonus */
  get allDone() { return this.total>0&&this.done.length===this.total; }
  get pointsEarned() { return this.done.reduce((s,t)=>s+(t.points||0),0); }
  get bonusPossible() { return this.skipped.length===0?Points.bonusFor(this.blockBase):0; }
  get pointsMax() { return this.blockBase+Points.bonusFor(this.blockBase); }
  get pointsPossible() {
    const open=[...this.queue,...(this.current&&this.current.status!=='done'?[this.current]:[])];
    return this.pointsEarned+open.reduce((s,t)=>s+Points.base(t),0)+this.bonusPossible;
  }
  getResults() {
    const bonus=this.allDone?Points.bonusFor(this.blockBase):0;
    const score=this.pointsEarned+bonus;
    return {
      id:uuid(), date:todayStr(), version:2,
      completed:this.done.length, skipped:this.skipped.length, planned:this.total,
      on_time:this.done.filter(t=>t.on_time).length,
      score, max_points:this.pointsMax, bonus_points:bonus, deduction_points:0,
      planned_minutes:[...this.done,...this.skipped].reduce((s,t)=>s+t.estimated_minutes,0),
      actual_minutes:this.done.reduce((s,t)=>s+(t.actual_minutes||0),0),
    };
  }
  _beep() {
    if(!DB.getSetting('sound',true)) return;
    try {
      const ac=_getAC();
      const play=()=>{
        [880,1100,1320].forEach((f,i)=>{ const o=ac.createOscillator(),g=ac.createGain();
          o.connect(g);g.connect(ac.destination);o.frequency.value=f;
          g.gain.setValueAtTime(.4,ac.currentTime+i*.2);
          g.gain.exponentialRampToValueAtTime(.01,ac.currentTime+i*.2+.25);
          o.start(ac.currentTime+i*.2);o.stop(ac.currentTime+i*.2+.25);
        });
      };
      if(ac.state==='suspended') ac.resume().then(play).catch(()=>{});
      else play();
    } catch(e){}
  }
  async _wakelock() { try{ if('wakeLock'in navigator)this.wakeLock=await navigator.wakeLock.request('screen'); }catch(e){} }
  _dropWL() { try{ this.wakeLock?.release();this.wakeLock=null; }catch(e){} }
  _ping() { this.onTick?.(); }
}
const Timer=new TimerVM();

/* ── Zeit-Protokoll ── */
function logDone(t) {
  const onTime=t.on_time??(t.actual_minutes<=t.estimated_minutes);
  DB.addTimeLog({
    id:uuid(), task_id:t.id, series_id:t.series_id||t.id,
    title:t.title, category:t.category, priority:t.priority, difficulty:t.difficulty||'medium',
    estimated_minutes:t.estimated_minutes, actual_minutes:t.actual_minutes,
    outcome:onTime?'ontime':'overtime', points:t.points??Points.earned(t,!onTime),
    recurring:!!t.recurring, date:t.done_at||new Date().toISOString(),
  });
}
/* Übersprungen (Timer) oder aus der Heute-Liste zurückgelegt */
function logEvent(t,outcome) {
  DB.addTimeLog({
    id:uuid(), task_id:t.id, series_id:t.series_id||t.id,
    title:t.title, category:t.category, priority:t.priority,
    estimated_minutes:t.estimated_minutes, outcome, points:0, date:new Date().toISOString(),
  });
}

/* ── Router ── */
function go(view,params={}) {
  S.view=view; S.params=params;
  if(['inbox','new','today','timer','ki','history'].includes(view)) S.tab=view;
  if(view!=='timer') { Timer.onTick=null; }
  render();
}

/* ── Render ── */
function render() {
  if(_dragCleanup) _dragCleanup();
  if(S.view==='timer'&&Timer.breakState==='DONE') { endBlock(); return; }
  document.documentElement.setAttribute('data-theme',DB.getSetting('theme','light'));
  document.documentElement.setAttribute('data-font',DB.getSetting('fontSize','normal'));
  const map={welcome:vWelcome,'block-setup':vBlockSetup,inbox:vInbox,new:vNewTask,today:vToday,timer:vTimer,
             ki:vKI,history:vHistory,'edit-task':vEditTask,archive:vArchive,results:vResults,settings:vSettings,categories:vCategories};
  document.getElementById('app').innerHTML=(map[S.view]||vInbox)();
  afterRender();
}

function afterRender() {
  if(S.view==='today') initDnD();
  if(S.view==='timer') Timer.onTick=render;
  if(S.view==='ki') {
    const chatEl=document.getElementById('chat-messages');
    if(chatEl) chatEl.scrollTop=chatEl.scrollHeight;
    const inp=document.getElementById('chat-input');
    if(inp) inp.addEventListener('keydown',e=>{
      if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendChat();}
    });
  }
  if(['inbox','archive'].includes(S.view)&&S._refocusSearch) {
    S._refocusSearch=false;
    const inp=document.querySelector('.search-input');
    if(inp) { inp.focus(); return; }
  }
  window.scrollTo(0,0);
}

/* ── Tab Bar ── */
const TABS=[
  {id:'inbox',  icon:'📋',label:'Aufgaben'},
  {id:'today',  icon:'📅',label:'Heute'},
  {id:'timer',  icon:'⏱️',label:'Timer'},
  {id:'ki',     icon:'🤖',label:'KI-Coach'},
  {id:'history',icon:'📊',label:'Historie'},
];
const tabBar=()=>`<nav class="tabbar">${TABS.map(t=>`<button class="tab${S.tab===t.id?' active':''}" data-action="go" data-view="${t.id}"><span class="tab-icon">${t.icon}</span><span class="tab-label">${t.label}</span></button>`).join('')}</nav>`;
const LOGO_SM=`<span class="logo"><img class="logo-img" src="icons/icon.svg" alt="">S4S</span>`;
const hdr=(title,back=false)=>`<header class="header"><div class="header-left">${back?`<button class="btn-icon" data-action="back">‹</button>`:LOGO_SM}</div><h1 class="header-title">${title}</h1><div class="header-right">${Sync.isConnected()?'<span class="sync-dot" title="Synchronisiert">☁️</span>':''}<button class="btn-icon" data-action="go" data-view="settings">⚙️</button></div></header>`;

/* ── Backup-Erinnerung (Startbildschirm) ── */
function backupReminder() {
  if(S._backupSnoozed||!Backup.isDue()) return '';
  const d=Backup.daysSinceLast();
  const txt=d===null?'Du hast noch kein Backup deiner Daten erstellt.':`Dein letztes Backup ist ${d} Tage her.`;
  return `<div class="backup-reminder">
    <div class="backup-reminder-text"><strong>💾 Zeit für ein Backup</strong><span>${txt}</span></div>
    <div class="backup-reminder-actions">
      <button class="btn btn-sm btn-primary" data-action="backup-now">Jetzt sichern</button>
      <button class="btn-link" data-action="backup-snooze">Später</button>
    </div>
  </div>`;
}

/* ── Welcome ── */
function vWelcome() {
  return `<div class="view view-welcome"><div class="welcome-content">
    ${backupReminder()}
    <img class="logo-big" src="icons/icon.svg" alt="Step4Step Logo">
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

/* ── Block Setup (Startup) ── */
function vBlockSetup() {
  const saved=DB.getSetting('todayBlockMinutes',120);
  const presets=[30,60,90,120,180,240];
  return `<div class="view view-block-setup">
    <div class="block-setup-hero">
      <img class="block-setup-logo" src="icons/icon.svg" alt="Step4Step Logo">
      <div class="block-setup-name">Step4Step</div>
    </div>
    <div class="content">
      ${backupReminder()}
      <div class="card block-start-card">
        <div class="block-icon">⏰</div>
        <h2 class="block-start-title">Wie viel Zeit hast du heute?</h2>
        <p class="block-start-sub">Lege deinen Fokus-Zeitblock für den Tag fest.</p>
        <div class="preset-grid">
          ${presets.map(m=>`<button class="btn btn-toggle${saved===m?' active':''}" data-action="set-block-preset" data-val="${m}">${m<60?m+' min':m===60?'1 Std':m===90?'1½ Std':m===120?'2 Std':m===180?'3 Std':'4 Std'}</button>`).join('')}
        </div>
        <div class="block-custom-row">
          <input type="number" id="block-min" class="form-input" placeholder="Minuten" min="5" max="600" value="${saved}">
          <span class="text-muted">Minuten</span>
        </div>
        <button class="btn btn-primary btn-lg btn-full" data-action="set-block-start">Aufgaben anzeigen →</button>
        <button class="btn-link block-skip-link" data-action="skip-block">Überspringen</button>
      </div>
    </div>
  </div>`;
}

/* ── Inbox ── */
function vInbox() {
  const cats=DB.getCategories();
  const fCat=S.params.fCat||'all', fPri=S.params.fPri||'all', q=S.params.q||'';
  let tasks=DB.getTasks().filter(t=>['later','skipped'].includes(t.status));
  if(fCat!=='all') tasks=tasks.filter(t=>t.category===fCat);
  if(fPri!=='all') tasks=tasks.filter(t=>t.priority===fPri);
  if(q) tasks=tasks.filter(t=>t.title.toLowerCase().includes(q.toLowerCase()));
  const pL={low:'Niedrig',medium:'Mittel',high:'Hoch'};
  const pC={low:'badge-low',medium:'badge-medium',high:'badge-high'};
  const priOrder={high:0,medium:1,low:2};
  tasks.sort((a,b)=>{ const pd=priOrder[a.priority]-priOrder[b.priority]; return pd||(new Date(a.created_at)-new Date(b.created_at)); });
  const getCatColor=name=>cats.find(c=>c.name===name)?.color||'#6b7280';
  const blockMin=DB.getSetting('todayBlockMinutes',0);
  const todayTasks=DB.getTasks().filter(t=>t.status==='today');
  const todayMin=todayTasks.reduce((s,t)=>s+t.estimated_minutes,0);
  return `<div class="view">${tabBar()}
    <div class="sticky-header">
      <header class="header">
        <div class="header-left">${LOGO_SM}</div>
        <h1 class="header-title">Aufgaben</h1>
        <div class="header-right">
          <button class="btn btn-sm btn-primary inbox-new-btn" data-action="go" data-view="new">➕ Neu</button>
          ${Sync.isConnected()?'<span class="sync-dot" title="Synchronisiert">☁️</span>':''}
          <button class="btn-icon" data-action="go" data-view="settings">⚙️</button>
        </div>
      </header>
    </div>
    <div class="content">
      ${backupReminder()}
      ${blockMin>0?`<div class="today-stats">
        <span class="stat-item">📅 ${todayTasks.length} Aufgaben</span>
        <span class="stat-item">⏱ ${todayMin} / ${blockMin} min</span>
        <span class="stat-item ${todayMin>blockMin?'stat-over':'stat-ok'}">${blockMin-todayMin>=0?blockMin-todayMin+' min frei':Math.abs(blockMin-todayMin)+' min über'}</span>
        <button class="btn-link" data-action="reset-block">ändern</button>
      </div>`:''}
      <p class="scroll-hint">Wähle hier deine Aufgaben für Heute.</p>
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
      ${DB.getDoneLog().length?`<button class="btn-link archive-link" data-action="go" data-view="archive">🗂 Archiv – erledigte Aufgaben wieder verwenden ›</button>`:''}
      ${tasks.length===0
        ?`<div class="empty-state"><div class="empty-icon">📋</div><p>Keine Aufgaben gefunden.</p></div>`
        :tasks.map(t=>`<div class="task-card task-card-v2" style="border-top:4px solid ${getCatColor(t.category)}">
          <div class="task-row-top" data-action="edit" data-id="${t.id}">
            <span class="task-title-bold">${esc(t.title)}</span><span class="task-time-sep"> – ${t.estimated_minutes} min</span>
          </div>
          <div class="task-row-bottom">
            <span class="badge badge-cat">${esc(t.category)}</span>
            <span class="badge ${pC[t.priority]}">${pL[t.priority]}</span>
            ${t.recurring?'<span class="badge badge-rec">🔄</span>':''}
            ${(t.postpone_count||0)>=3?`<span class="badge badge-proc" title="${t.postpone_count}x verschoben">⚠️</span>`:''}
            <button class="btn btn-sm btn-today" data-action="add-today" data-id="${t.id}">📅 Heute</button>
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
  const t=task||{title:'',category:cats[0]?.name||'Privat',priority:'medium',difficulty:'medium',estimated_minutes:5,status:'later',recurring:false};
  const diff=t.difficulty||'medium';
  const dL={easy:'Leicht',medium:'Mittel',hard:'Schwer'};
  const times=[5,10,15,30,45,60];
  const pL={low:'Niedrig',medium:'Mittel',high:'Hoch'};
  S._estApplied=null;
  return `<div class="view">${tabBar()}
    ${hdr(isEdit?'Bearbeiten':'Neue Aufgabe',isEdit)}
    <div class="content">
      ${!isEdit&&DB.getDoneLog().length?`<button class="btn-link archive-link" data-action="go" data-view="archive">🗂 Aus dem Archiv wählen ›</button>`:''}
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
          <label class="form-label">Aufwand</label>
          <div class="btn-group">
            ${['easy','medium','hard'].map(d=>`<button type="button" class="btn btn-toggle${diff===d?' active':''}" data-action="set-diff" data-val="${d}">${dL[d]}</button>`).join('')}
          </div>
          <input type="hidden" id="f-diff" value="${diff}">
        </div>
        <div class="form-group">
          <label class="form-label">Geschätzte Zeit</label>
          <div class="btn-group" id="time-btns">
            ${times.map(m=>`<button type="button" class="btn btn-toggle${t.estimated_minutes===m?' active':''}" data-action="set-time" data-val="${m}">${m} min</button>`).join('')}
          </div>
          <input type="number" id="f-time" class="form-input mt-sm" placeholder="Benutzerdefiniert (min)" value="${t.estimated_minutes}" min="1" max="480">
          <div id="est-hint">${estHint(t.title,t.category,t.estimated_minutes)}</div>
        </div>
        <div class="points-preview" id="pts-preview">${ptsPreview(t)}</div>
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

/* ── Zeitvorschlag aus eigener Erfahrung (A: ähnliche Aufgaben, B: persönlicher Faktor) ── */
function estHint(title,category,est) {
  if(!Estimate.tokens(title).length) return '';
  const sg=Estimate.suggest(title,category,est);
  if(!sg) return '';
  const btn=`<button type="button" class="btn btn-sm btn-primary" data-action="apply-est" data-val="${sg.minutes}">Übernehmen</button>`;
  if(sg.source==='similar') {
    const m=sg.match;
    const ref=`ähnlich wie „${esc(m.title)}“ – geplant ${m.estimated_minutes}, gebraucht ${m.actual_minutes} min${sg.count>1?` (+${sg.count-1} weitere)`:''}`;
    if(sg.minutes===est) return `<div class="est-hint est-ok">✓ Passt zu deiner Erfahrung<span class="est-ref">${ref}</span></div>`;
    return `<div class="est-hint"><div class="est-text"><strong>💡 Vorschlag: ${sg.minutes} min</strong><span class="est-ref">${ref}</span></div>${btn}</div>`;
  }
  if(S._estApplied===est) return `<div class="est-hint est-ok">✓ Vorschlag übernommen</div>`;
  const f=sg.factor.toFixed(1).replace('.',',');
  const who=sg.scope==='category'?`In „${esc(sg.category)}“ brauchst du`:'Du brauchst';
  return `<div class="est-hint"><div class="est-text"><strong>💡 Vorschlag: ${sg.minutes} min</strong><span class="est-ref">${who} meist ~${f}× so lange wie geplant</span></div>${btn}</div>`;
}

function ptsPreview(t) {
  const b=Points.breakdown(t), p=Points.base(t);
  return `⭐ <strong>${p} Punkte</strong> bei pünktlicher Erledigung <span class="text-muted">(Priorität ${b.pri} + Aufwand ${b.diff} + Dauer ${b.dur})</span>`;
}
function updatePtsPreview() {
  const el=document.getElementById('pts-preview'); if(!el) return;
  el.innerHTML=ptsPreview({priority:document.getElementById('f-pri')?.value,difficulty:document.getElementById('f-diff')?.value,estimated_minutes:parseInt(document.getElementById('f-time')?.value)||0});
}

function updateEstHint() {
  updatePtsPreview();
  const el=document.getElementById('est-hint'); if(!el) return;
  el.innerHTML=estHint(document.getElementById('f-title')?.value||'',document.getElementById('f-cat')?.value||'',parseInt(document.getElementById('f-time')?.value)||0);
}

function applyEst(val) {
  const inp=document.getElementById('f-time'); if(!inp) return;
  inp.value=val; S._estApplied=parseInt(val);
  document.querySelectorAll('[data-action="set-time"]').forEach(b=>b.classList.toggle('active',b.dataset.val===String(val)));
  updateEstHint();
}

function vEditTask() {
  const t=DB.getTasks().find(t=>t.id===S.params.id);
  if(!t){go('inbox');return'';}
  return vNewTask(t);
}

/* ── Archiv (D): erledigte Aufgaben mit gelernter Zeit wieder anlegen ── */
function vArchive() {
  const q=(S.params.aq||'').toLowerCase();
  const items=Estimate.archive().filter(a=>!q||a.title.toLowerCase().includes(q));
  const cats=DB.getCategories();
  const catColor=name=>cats.find(c=>c.name===name)?.color||'#6b7280';
  const openKeys=new Set(DB.getTasks().filter(t=>['today','later','skipped'].includes(t.status)).map(t=>Estimate.key(t.title)));
  const fmtD=iso=>new Date(iso).toLocaleDateString('de',{day:'2-digit',month:'2-digit',year:'2-digit'});
  return `<div class="view">${tabBar()}<div class="sticky-header">${hdr('Archiv',true)}</div>
    <div class="content">
      <p class="scroll-hint">Erledigte Aufgaben mit deiner tatsächlich gebrauchten Zeit. Tippe auf <strong>↺</strong>, um eine Aufgabe erneut anzulegen.</p>
      <div class="filters"><input type="search" class="search-input" placeholder="Im Archiv suchen…" value="${esc(S.params.aq||'')}" data-action="arch-search"></div>
      ${items.length===0
        ?`<div class="empty-state"><div class="empty-icon">🗂</div><p>${q?'Nichts gefunden.':'Noch keine erledigten Aufgaben.'}</p></div>`
        :items.map(a=>`<div class="task-card task-card-v2" style="border-top:4px solid ${catColor(a.category)}">
          <div class="task-row-top"><span class="task-title-bold">${esc(a.title)}</span><span class="task-time-sep"> – ${a.learned} min</span></div>
          <div class="archive-meta">zuletzt ${a.lastActual} min · ${a.count}× erledigt · ${fmtD(a.lastDate)}${openKeys.has(a.key)?' · <strong>bereits offen</strong>':''}</div>
          <div class="task-row-bottom">
            <span class="badge badge-cat">${esc(a.category)}</span>
            <button class="btn btn-sm btn-today" data-action="arch-reuse" data-key="${esc(a.key)}">↺ Neu anlegen</button>
            <button class="btn btn-sm btn-danger-sm" data-action="arch-del" data-key="${esc(a.key)}" title="Aus dem Archiv entfernen">🗑️</button>
          </div>
        </div>`).join('')}
    </div>
  </div>`;
}

function archReuse(key) {
  const a=Estimate.archive().find(x=>x.key===key); if(!a) return;
  const open=DB.getTasks().some(t=>['today','later','skipped'].includes(t.status)&&Estimate.key(t.title)===key);
  if(open&&!confirm(`„${a.title}“ ist bereits offen. Trotzdem neu anlegen?`)) return;
  const cats=DB.getCategories();
  DB.saveTask({
    id:uuid(), title:a.title,
    category:cats.some(c=>c.name===a.category)?a.category:(cats[0]?.name||'Privat'),
    priority:a.priority||'medium', difficulty:a.difficulty||'medium', estimated_minutes:a.learned,
    status:'later', recurring:false, series_id:a.series_id, today_order:0,
    created_at:new Date().toISOString(), done_at:null, actual_minutes:null,
  });
  go('inbox');
}

function archDel(key) {
  if(!confirm('Aus dem Archiv entfernen? Die gemessenen Zeiten werden dann nicht mehr für Vorschläge genutzt.')) return;
  Estimate.removeFromArchive(key); render();
}

/* ── Today ── */
function vToday() {
  const tasks=DB.getTasks().filter(t=>t.status==='today').sort((a,b)=>a.today_order-b.today_order);
  const totalMin=tasks.reduce((s,t)=>s+t.estimated_minutes,0);
  const blockMin=DB.getSetting('todayBlockMinutes',0);
  const noBlock=blockMin===0;
  const pC={low:'badge-low',medium:'badge-medium',high:'badge-high'};
  const pm=Points.blockMax(tasks);
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
      ${tasks.length?`<div class="points-banner">🏆 Bis zu <strong>${pm.total} Punkte</strong> möglich <span class="text-muted">(${pm.base} + ${pm.bonus} Bonus, wenn du alle schaffst)</span></div>`:''}
      <p class="sticky-hint">Halte ⠿ gedrückt und ziehe, um zu sortieren.</p>
    </div>
    <div class="content" id="today-list">
      ${tasks.length===0
        ?`<div class="empty-state"><div class="empty-icon">📅</div><p>Noch keine Aufgaben für heute.</p><p>Gehe zu <strong>Aufgaben</strong> und füge Aufgaben hinzu.</p></div>`
        :tasks.map((t,i)=>`<div class="task-card draggable" data-id="${t.id}" data-i="${i}">
            <div class="drag-handle" aria-label="Verschieben">⠿</div>
            <div class="task-main">
              <div class="task-title">${esc(t.title)}</div>
              <div class="task-meta">
                <span class="badge ${pC[t.priority]}">${t.estimated_minutes} min</span>
                <span class="badge badge-cat">${esc(t.category)}</span>
                <span class="badge badge-pts">⭐ ${Points.base(t)}</span>
                ${t.recurring?'<span class="badge badge-rec">🔄</span>':''}
              </div>
            </div>
            <div class="task-actions">
              <button class="btn btn-sm btn-back-inbox" data-action="rm-today" data-id="${t.id}">← Zurück</button>
            </div>
          </div>`).join('')}
    </div>
    ${tasks.length>0?`<div class="footer-fixed">
      <p class="footer-hint">Wenn du deine Aufgaben sortiert hast, lege los!</p>
      <button class="btn btn-primary btn-lg btn-full" data-action="start-timer">▶ Jetzt starten</button>
    </div>`:''}
  </div>`;
}

/* ── Timer-Buttons: einheitlich (Symbol über Text, gleiche Breite, kein Umbruch) ── */
const tBtn=(action,icon,label,cls='btn-secondary')=>`<button class="btn tbtn ${cls}" data-action="${action}"><span class="tbtn-ico">${icon}</span><span class="tbtn-lbl">${label}</span></button>`;
const tMain=(action,label,cls='btn-primary')=>`<button class="btn btn-lg btn-full tmain ${cls}" data-action="${action}">${label}</button>`;
const tRow=(...btns)=>`<div class="tbtn-row">${btns.join('')}</div>`;
function pointsStat() {
  return `<span class="timer-points">🏆 ${Timer.pointsEarned} P · noch bis ${Timer.pointsPossible} von ${Timer.pointsMax} möglich</span>`;
}

/* ── Timer Clock SVG ── */
function clockSVG(timeLeft, totalSec, phase) {
  const r=82, circ=2*Math.PI*r;
  const pct=totalSec>0?Math.max(0,timeLeft/totalSec):0;
  const offset=(circ*(1-pct)).toFixed(2);
  const cols={green:'#2E7D4F',red:'#B83A3A',blue:'#3D5E87',overtime:'#B83A3A'};
  const col=cols[phase]||cols.green;
  const absLeft=Math.abs(Math.round(timeLeft));
  const mins=Math.floor(absLeft/60), secs=absLeft%60;
  const label=(timeLeft<0?'-':'')+fmt2(mins)+':'+fmt2(secs);
  return `<svg class="timer-clock-svg" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
    <circle cx="100" cy="100" r="${r}" fill="none" stroke="var(--bg3)" stroke-width="16"/>
    <circle cx="100" cy="100" r="${r}" fill="none" stroke="${col}" stroke-width="16"
      stroke-dasharray="${circ.toFixed(2)}" stroke-dashoffset="${offset}"
      stroke-linecap="round" transform="rotate(-90 100 100)" style="transition:stroke-dashoffset 1s linear,stroke .5s"/>
    <text x="100" y="115" text-anchor="middle"
      font-size="40" font-weight="900" fill="${col}"
      font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">${label}</text>
  </svg>`;
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
          <h2 class="alldone-title">${Timer.allDone?'Alle Aufgaben erledigt!':'Block geschafft!'}</h2>
          <p class="alldone-sub">Hervorragende Arbeit! Dein Block ist abgeschlossen.</p>
        </div>
        <div class="card points-summary">
          <div class="points-big">${Timer.getResults().score}<span> / ${Timer.pointsMax} Punkte</span></div>
          ${Timer.allDone
            ?`<p class="points-bonus">🎁 Extra-Belohnung: alle Aufgaben geschafft, +${Points.bonusFor(Timer.blockBase)} Bonuspunkte!</p>`
            :`<p class="text-muted">Bonus (+${Points.bonusFor(Timer.blockBase)}) gibt es, wenn du alle Aufgaben der Heute-Liste erledigst.</p>`}
        </div>
        ${Timer.done.length>0?`<div class="card">
          <h3 class="card-title">✓ Erledigte Aufgaben (${Timer.done.length})</h3>
          ${Timer.done.map(d=>`<div class="done-task-row">
            <span class="done-check">✓</span>
            <span class="done-title">${esc(d.title)}</span>
            <span class="done-time">${d.actual_minutes} min${d.on_time?'':' ⏰'}</span>
            <span class="badge badge-pts">+${d.points||0}</span>
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
        ${tRow(tBtn('t-break','☕','5 Min Pause'),tBtn('t-end-block','✓','Block beenden','btn-primary'))}
      </div>
    </div>`;
  }

  /* READY — Aufgabe vorzeigen, User bestätigt Start */
  if(Timer.state==='READY') {
    const cats=DB.getCategories();
    const catColor=cats.find(c=>c.name===t?.category)?.color||'#6b7280';
    return `<div class="view">${tabBar()}${hdr('Timer')}
      <div class="content center-content">
        <div class="ready-card card" style="border-top:4px solid ${catColor};width:100%">
          <div class="ready-icon">🎯</div>
          <h2 class="ready-title">${esc(t?.title||'')}</h2>
          <div class="task-meta" style="justify-content:center;margin-bottom:16px">
            <span class="badge badge-cat">${esc(t?.category||'')}</span>
            <span class="badge">${t?.estimated_minutes||0} min geplant</span>
            ${t?.recurring?'<span class="badge badge-rec">🔄</span>':''}
          </div>
          <p class="ready-hint">Mache dich bereit für diese Aufgabe und klicke auf <strong>Start</strong> wenn du bereit bist.</p>
          <p class="ready-sub">Du kannst jetzt zum Ort der Aufgabe gehen, Materialien holen oder dich vorbereiten.</p>
        </div>
        <div class="timer-stats">
          <span>✓ ${Timer.done.length} erledigt</span>
          <span>◎ ${Timer.queue.length+1} verbleibend</span>
          <span>⊘ ${Timer.skipped.length} übersprungen</span>
          ${pointsStat()}
        </div>
      </div>
      <div class="footer-fixed">
        ${tMain('t-start-ready',`▶ Start <span class="tmain-sub">⭐ ${Points.base(t)} P</span>`)}
        ${tRow(tBtn('t-later','↓','Später'),tBtn('t-skip','⏭','Überspringen','btn-warning'))}
      </div>
    </div>`;
  }

  /* ACTIVE (INTRO / RUNNING / PAUSED / OVERTIME / FINISHED) */
  const isIntro=Timer.state==='INTRO';
  const isPaused=Timer.state==='PAUSED';
  const isFinished=Timer.state==='FINISHED';
  const isOvertime=Timer.state==='OVERTIME';

  /* Determine color phase */
  let timerPhase='green';
  if(t&&!isIntro&&!isFinished) {
    if(isOvertime) {
      timerPhase='overtime';
    } else {
      const total=t.estimated_minutes*60;
      const pct=total>0?Timer.timeLeft/total:1;
      if(pct<=0.1) timerPhase='blue';
      else if(pct<=0.5) timerPhase='red';
      else timerPhase='green';
    }
  }

  const pct=t?Math.max(0,(Timer.timeLeft/(t.estimated_minutes*60))*100):0;
  const bLeft=Timer.blockTimeLeft;
  const bPct=bLeft!==null&&Timer.blockTotalMin>0?Math.max(0,(bLeft/(Timer.blockTotalMin*60))*100):null;

  return `<div class="view timer-view-${timerPhase}">${tabBar()}
    <div class="sticky-header">${hdr('Timer')}</div>
    <div class="content timer-content">

      ${isIntro?`<div class="intro-countdown">
        <p class="intro-text">Mach dich bereit…</p>
        <div class="countdown-big">${Timer.intro}</div>
      </div>`:''}

      ${t&&!isIntro?`
        ${!isOvertime?`<p class="timer-motivation">Fokussiere dich jetzt auf deine Aufgabe. Bist du schneller, bestätige mit dem Button <strong>„Fertig"</strong>.</p>`:''}

        <div class="timer-task card">
          <div class="task-title-lg">${esc(t.title)}</div>
          <div class="task-meta" style="justify-content:center;margin-top:6px">
            <span class="badge badge-cat">${esc(t.category)}</span>
            <span class="badge">${t.estimated_minutes} min geplant</span>
            ${t.recurring?'<span class="badge badge-rec">🔄</span>':''}
          </div>
        </div>

        <div class="timer-display${isFinished?' timer-done':''}">
          ${clockSVG(Timer.timeLeft, t.estimated_minutes*60, isFinished?'green':timerPhase)}
        </div>

        ${isOvertime?`<div class="overtime-dialog card">
          <div class="overtime-icon">⏰</div>
          <h3 class="overtime-title">Zeit abgelaufen!</h3>
          <p class="overtime-sub">Hast du die Aufgabe erledigt? Jetzt gibt es noch ${Points.earned(t,true)} statt ${Points.base(t)} Punkte.</p>
        </div>`:''}

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
          ${pointsStat()}
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
        ?tMain('t-advance','Zur nächsten Aufgabe ›')
        :isOvertime
        ?`${tMain('t-done','✓ Erledigt','btn-success')}
          ${tRow(tBtn('t-skip','✗','Nicht erledigt','btn-warning'))}`
        :`${tMain('t-done','✓ Fertig','btn-success')}
          ${tRow(tBtn('t-pause',isPaused?'▶':'⏸',isPaused?'Weiter':'Pause',isPaused?'btn-primary':'btn-secondary'),tBtn('t-later','↓','Später'),tBtn('t-skip','⏭','Überspringen','btn-warning'))}`}
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
/* Alle Sessions eines Tages zusammenfassen (vorher zählte nur eine davon) */
function dayAgg(results) {
  const m={};
  results.forEach(r=>{
    const a=m[r.date]||(m[r.date]={score:0,max:0,legacy:false,completed:0,min:0});
    a.score+=r.score||0; a.completed+=r.completed||0; a.min+=r.actual_minutes||0;
    if(r.max_points) a.max+=r.max_points; else a.legacy=true;
  });
  return m;
}
/* Farbe: Anteil der möglichen Punkte; alte Sessions (ohne Maximum) nach alter Skala */
function dayClass(a) {
  if(a.max&&!a.legacy){ const q=a.score/a.max; return q>=.8?'score-green':q>=.5?'score-yellow':'score-red'; }
  return a.score>=8?'score-green':a.score>=5?'score-yellow':'score-red';
}

/* Letzte 4 Wochen, je Aufgabe genau einmal gezählt */
function fourWeekStats() {
  const since=Date.now()-28*86400000;
  const byTask=new Map();
  DB.getTimeLog().filter(e=>new Date(e.date).getTime()>=since).forEach(e=>{
    const k=e.task_id||e.id;
    const g=byTask.get(k)||{done:null,deferred:false};
    if(e.outcome==='skipped'||e.outcome==='postponed') g.deferred=true;
    else if(e.actual_minutes>0) g.done=e.outcome||(e.actual_minutes<=e.estimated_minutes?'ontime':'overtime');
    byTask.set(k,g);
  });
  let ontime=0,overtime=0,deferred=0;
  byTask.forEach(g=>{ if(g.deferred) deferred++; else if(g.done==='ontime') ontime++; else if(g.done) overtime++; });
  return {total:ontime+overtime+deferred,ontime,overtime,deferred};
}

function vHistory() {
  const results=DB.getResults();
  const byDate=dayAgg(results);
  const now=new Date();
  const [yr,mo]=S.params.calDate?S.params.calDate.split('-').map((x,i)=>+x-(i===1?1:0)):[now.getFullYear(),now.getMonth()];
  const first=new Date(yr,mo,1),last=new Date(yr,mo+1,0);
  const startDow=(first.getDay()+6)%7;
  const mNames=['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
  const dNames=['Mo','Di','Mi','Do','Fr','Sa','So'];
  const cells=[];
  for(let i=0;i<startDow;i++)cells.push(null);
  for(let d=1;d<=last.getDate();d++){
    const ds=`${yr}-${fmt2(mo+1)}-${fmt2(d)}`;
    cells.push({d,ds,a:byDate[ds]});
  }
  const moStr=`${yr}-${fmt2(mo+1)}`;
  const moRes=results.filter(r=>r.date.startsWith(moStr));
  const moTasks=moRes.reduce((s,r)=>s+r.completed,0);
  const moMin=moRes.reduce((s,r)=>s+(r.actual_minutes||0),0);
  const totalScore=results.reduce((s,r)=>s+(r.score||0),0);
  const lv=Points.level(totalScore);
  const monthParam=d=>`${d.getFullYear()}-${fmt2(d.getMonth()+1)}`;
  const prevM=monthParam(new Date(yr,mo-1,1)), nextM=monthParam(new Date(yr,mo+1,1));
  const week=getWeek(byDate);
  const st=fourWeekStats();
  const pct=n=>st.total?(n/st.total*100).toFixed(1):0;
  return `<div class="view">${tabBar()}<div class="sticky-header">${hdr('Historie')}</div>
    <div class="content">
      <div class="card level-card">
        <div class="level-info"><span class="level-badge">Level ${lv.level}</span><span class="level-score">${totalScore} Gesamtpunkte</span></div>
        <div class="progress-bar"><div class="progress-fill" style="width:${lv.into/lv.step*100}%"></div></div>
        <p class="level-message">Noch ${lv.step-lv.into} Punkte bis Level ${lv.level+1}. Weiter so!</p>
        <div class="month-stats"><span>✓ ${moTasks} Aufgaben diesen Monat</span><span>⏱ ${moMin} Fokus-Minuten</span></div>

        <div class="stats4w">
          <p class="stats4w-title"><strong>${st.total} Aufgaben</strong> in den letzten 4 Wochen, davon:</p>
          ${st.total?`<div class="stats4w-bar">
            <span class="s4w-ontime" style="width:${pct(st.ontime)}%"></span><span class="s4w-over" style="width:${pct(st.overtime)}%"></span><span class="s4w-def" style="width:${pct(st.deferred)}%"></span>
          </div>`:''}
          <div class="stats4w-row"><span class="dot s4w-ontime"></span><span class="stats4w-num">${st.ontime}</span> in der Zeit abgeschlossen</div>
          <div class="stats4w-row"><span class="dot s4w-over"></span><span class="stats4w-num">${st.overtime}</span> über der Zeit abgeschlossen</div>
          <div class="stats4w-row"><span class="dot s4w-def"></span><span class="stats4w-num">${st.deferred}</span> übersprungen oder später erledigt</div>
        </div>

        <details class="points-info">
          <summary>ℹ️ So bekommst du Punkte</summary>
          <p>Jede Aufgabe bringt <strong>Priorität + Aufwand + Dauer</strong>:</p>
          <ul>
            <li>Priorität: niedrig 1 · mittel 2 · hoch 3</li>
            <li>Aufwand: leicht 0 · mittel 1 · schwer 2</li>
            <li>Dauer: 1 Punkt je angefangene 15 min (max. 4)</li>
          </ul>
          <ul>
            <li>✓ In der Zeit erledigt: volle Punkte</li>
            <li>⏰ Über der Zeit erledigt: halbe Punkte</li>
            <li>↷ Übersprungen oder verschoben: 0 Punkte (kein Abzug)</li>
            <li>🎁 Ganze Heute-Liste geschafft: +${Math.round(Points.BONUS_RATE*100)} % Bonus</li>
          </ul>
          <p>Alle ${Points.LEVEL_STEP} Punkte steigst du ein Level auf.</p>
        </details>
      </div>
      <div class="card calendar-card">
        <div class="cal-header">
          <button class="btn-icon" data-action="cal-nav" data-date="${prevM}">‹</button>
          <h3 class="cal-title">${mNames[mo]} ${yr}</h3>
          <button class="btn-icon" data-action="cal-nav" data-date="${nextM}">›</button>
        </div>
        <div class="cal-grid">
          ${dNames.map(d=>`<div class="cal-day-header">${d}</div>`).join('')}
          ${cells.map(c=>c===null?'<div class="cal-cell empty"></div>'
            :`<div class="cal-cell${c.a?' '+dayClass(c.a):''}" title="${c.a?`${c.a.score}${c.a.max?' von '+c.a.max:''} Punkte | ${c.a.completed} Aufgaben`:''}">
              <span class="cal-day-num">${c.d}</span>
              ${c.a?`<span class="cal-dot"></span>`:''}
            </div>`).join('')}
        </div>
        <div class="cal-legend">
          <span class="legend-item"><span class="dot dot-green"></span> ≥80 % der Punkte</span>
          <span class="legend-item"><span class="dot dot-yellow"></span> 50–79 %</span>
          <span class="legend-item"><span class="dot dot-red"></span> &lt;50 %</span>
        </div>
      </div>
      ${week.some(d=>d.tasks||d.score)?`<div class="card"><h3 class="card-title">Letzte 7 Tage</h3>
        <table class="week-table">
          <thead><tr><th>Tag</th><th>Aufgaben</th><th>Min</th><th>Punkte</th></tr></thead>
          <tbody>${week.map(d=>`<tr><td>${d.label}</td><td>${d.tasks}</td><td>${d.min}</td><td class="${d.a?dayClass(d.a):''}">${d.score}</td></tr>`).join('')}</tbody>
        </table></div>`:''}
    </div>
  </div>`;
}

function getWeek(byDate) {
  const dl=['So','Mo','Di','Mi','Do','Fr','Sa'];
  return Array.from({length:7},(_,i)=>{
    const d=new Date(); d.setDate(d.getDate()-(6-i));
    const a=byDate[ymd(d)];
    return{label:dl[d.getDay()],a,tasks:a?a.completed:0,min:a?a.min:0,score:a?a.score:0};
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
      <div class="card settings-card">
        <h3 class="card-title">☁️ Geräte-Synchronisation (Firebase)</h3>
        ${Sync.isConnected()
          ?`<div class="setting-row"><span class="setting-label">Angemeldet als</span><span class="sync-email">${Sync.getUserEmail()||'Google'}</span></div>
            <div class="setting-row"><span class="setting-label">Status</span><span class="badge badge-rec">✓ Synchron</span></div>
            <button class="btn btn-sm btn-secondary mt-sm" data-action="sync-signout">Abmelden</button>`
          :Sync.hasConfig()
            ?`<p class="form-hint">Firebase konfiguriert – bitte anmelden:</p>
              <button class="btn btn-primary btn-full" data-action="sync-signin">Mit Google anmelden 🔑</button>`
            :`<p class="form-hint">Firebase-Projekt einrichten (console.firebase.google.com), dann Konfiguration hier einfügen:</p>
              <textarea id="fb-config-input" class="form-input" rows="4" placeholder='{"apiKey":"...","authDomain":"...","projectId":"..."}'></textarea>
              <button class="btn btn-primary btn-full mt-sm" data-action="save-fb-config">Konfiguration speichern</button>`}
      </div>
      <div class="card settings-card">
        <h3 class="card-title">🤖 KI-Coach (Google Gemini)</h3>
        ${AI.hasKey()
          ?`<div class="setting-row"><span class="setting-label">Google AI API-Schlüssel</span><span class="badge badge-rec">✓ Verbunden</span></div>
            <button class="btn btn-sm btn-secondary mt-sm" data-action="remove-ai-key">Verbindung trennen</button>`
          :`<div class="form-group mt-sm">
              <input type="password" id="ai-key-input" class="form-input" placeholder="AIza…">
            </div>
            <button class="btn btn-primary btn-full" data-action="save-ai-key">API-Schlüssel speichern</button>
            <p class="form-hint">Kostenlos unter aistudio.google.com → „Get API key"</p>`}
      </div>
      ${backupCard()}
      <div class="card settings-card danger-zone">
        <h3 class="card-title">Daten</h3>
        <button class="btn btn-danger btn-full" data-action="clear-all">Alle Daten löschen ⚠️</button>
      </div>
    </div>
  </div>`;
}

function backupCard() {
  const last=DB.getSetting('lastBackupAt','');
  const info=DB.getSetting('lastBackupInfo',null);
  const folder=DB.getSetting('backupFolderName','');
  const lastTxt=last?new Date(last).toLocaleString('de',{dateStyle:'medium',timeStyle:'short'})+(info?.mode==='folder'?` · Ordner „${esc(info.folder)}“`:info?.mode?' · als Datei gespeichert':''):'noch keins';
  return `<div class="card settings-card">
    <h3 class="card-title">💾 Backup (nur lokal)</h3>
    <div class="setting-row"><span class="setting-label">Letztes Backup</span><span class="setting-value${Backup.isDue()?' stat-over':''}">${lastTxt}</span></div>
    ${Backup.canChooseFolder()
      ?`<div class="setting-row"><span class="setting-label">Speicherort</span><span class="setting-value">${folder?`📁 ${esc(folder)}`:'noch nicht gewählt'}</span></div>
        <button class="btn btn-sm btn-secondary mt-sm" data-action="backup-folder">${folder?'Speicherort ändern':'Speicherort wählen'}</button>`
      :`<p class="form-hint">Dieser Browser kann keinen festen Ordner wählen. Das Backup wird als Datei gespeichert bzw. über „Teilen“ angeboten – dort z. B. „In Dateien sichern“ → „Auf meinem iPhone“ wählen.</p>`}
    <button class="btn btn-primary btn-full mt-sm" data-action="backup-now" ${S.backupBusy?'disabled':''}>${S.backupBusy?'Sichere …':'Backup jetzt erstellen'}</button>
    <label class="btn btn-secondary btn-full mt-sm backup-restore">Backup wiederherstellen …<input type="file" accept=".json,application/json" data-action="backup-restore" hidden></label>
    <p class="form-hint">Enthält alle Aufgaben, Historie, Zeit-Protokoll, Kategorien, Einstellungen inkl. API-Schlüssel und alle App-Dateien. Im gewählten Ordner bleiben die letzten ${Backup.KEEP} Backups. Nichts wird ins Internet übertragen. Erinnerung nach ${Backup.REMIND_DAYS/7} Wochen ohne Backup.</p>
  </div>`;
}

async function backupNow() {
  if(S.backupBusy) return;
  S.backupBusy=true; render();
  try {
    const r=await Backup.create();
    S._backupSnoozed=false;
    alert(r.mode==='folder'
      ?`✓ Backup gespeichert\n\n${r.name}\nOrdner: ${r.folder}\n(${r.kept} Backups vorhanden, maximal ${Backup.KEEP})`
      :`✓ Backup-Datei erstellt\n\n${r.name}`);
  } catch(e) {
    if(e.name!=='AbortError') alert('Backup fehlgeschlagen: '+e.message);
  }
  S.backupBusy=false; render();
}

async function backupChooseFolder() {
  try { await Backup.chooseFolder(); render(); }
  catch(e) { if(e.name!=='AbortError') alert('Ordner konnte nicht gewählt werden: '+e.message); }
}

async function backupRestore(input) {
  const file=input.files?.[0]; if(!file) return;
  if(!confirm(`Backup „${file.name}“ wiederherstellen?\n\nAlle aktuellen Daten auf diesem Gerät werden dadurch ersetzt. Tipp: vorher ein aktuelles Backup erstellen.`)) { input.value=''; return; }
  try {
    const b=await Backup.restore(file);
    alert(`✓ Backup vom ${new Date(b.created_at).toLocaleString('de')} wiederhergestellt.\nDie App wird neu geladen.`);
    location.reload();
  } catch(e) { alert('Wiederherstellen fehlgeschlagen: '+e.message); input.value=''; }
}

/* ── Categories ── */
const CAT_COLORS=['#1E3A54','#3D5E87','#4E7F6E','#8A6D3B','#8E4B4B','#7B5A7E','#6F93BD','#6B7784'];
const OLD_CAT_COLORS=['#4f46e5','#0ea5e9','#10b981','#f59e0b','#ef4444','#ec4899','#8b5cf6','#6b7280'];
function vCategories() {
  const cats=DB.getCategories();
  const colors=CAT_COLORS;
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
      go('block-setup'); break;
    }
    case 'edit':       go('edit-task',{id}); break;
    case 'add-today':  addToday(id); break;
    case 'rm-today':   rmToday(id); break;
    case 'del-task':   delTask(id); break;
    case 'save-task':  saveTask(); break;
    case 'set-block':       setBlock(); break;
    case 'reset-block':     DB.setSetting('todayBlockMinutes',0);DB.setSetting('blockSetDate',''); render(); break;
    case 'set-block-start': setBlockAndStart(); break;
    case 'set-block-preset':setBlockPreset(val); break;
    case 'skip-block':      go('inbox'); break;
    case 'start-timer':startTimer(); break;
    case 't-start-ready': Timer.startTask(); break;
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
    case 'set-pri':    setToggle('set-pri','f-pri',val); updatePtsPreview(); break;
    case 'set-diff':   setToggle('set-diff','f-diff',val); updatePtsPreview(); break;
    case 'set-time':   setToggle('set-time','f-time',val); updateEstHint(); break;
    case 'apply-est':  applyEst(val); break;
    case 'backup-now':    backupNow(); break;
    case 'backup-folder': backupChooseFolder(); break;
    case 'backup-snooze': S._backupSnoozed=true; render(); break;
    case 'arch-reuse': archReuse(el.dataset.key); break;
    case 'arch-del':   archDel(el.dataset.key); break;
    case 'set-status': setToggle('set-status','f-status',val); break;
    /* ── KI-Aktionen ── */
    case 'save-fb-config':   saveFbConfig(); break;
    case 'sync-signin':      Sync.signIn().then(()=>render()).catch(e=>alert('Fehler: '+e.message)); break;
    case 'sync-signout':     Sync.signOut(); break;
    case 'save-ai-key':      saveAiKey(); break;
    case 'remove-ai-key':    DB.setSetting('geminiKey',''); render(); break;
    case 'send-chat':        sendChat(); break;
    case 'clear-chat':       AI.clearChatHistory(); render(); break;
    case 'gen-plan':         genPlan(); break;
    case 'ai-split':         aiSplit(id); break;
    case 'focus-go':         focusGo(); break;
    case 'focus-reset':      S.focusResult=null; render(); break;
    case 'add-subtask':      addSubtask(parseInt(el.dataset.idx)); break;
    case 'accept-all-subtasks': acceptAllSubtasks(); break;
    case 'dismiss-decompose': S.decomposeResult=null; render(); break;
    case 'add-focus-task':   addToday(id); break;
    case 'add-all-suggestions': addAllSuggestions(); break;
  }
});

document.addEventListener('change', e=>{
  const {action}=e.target.dataset;
  if(action==='toggle-snd') DB.setSetting('sound',e.target.checked);
  if(action==='search'){S.params.q=e.target.value;render();}
  if(action==='fcat'){S.params.fCat=e.target.value;render();}
  if(action==='fpri'){S.params.fPri=e.target.value;render();}
  if(e.target.id==='f-cat') updateEstHint();
  if(action==='backup-restore') backupRestore(e.target);
});

document.addEventListener('input', e=>{
  const {action}=e.target.dataset;
  if(action==='search'){S.params.q=e.target.value;S._refocusSearch=true;render();}
  if(action==='arch-search'){S.params.aq=e.target.value;S._refocusSearch=true;render();}
  if(e.target.id==='f-title') updateEstHint();
  if(e.target.id==='f-time'){
    document.querySelectorAll('[data-action="set-time"]').forEach(b=>b.classList.toggle('active',b.dataset.val===e.target.value));
    updateEstHint();
  }
  if(e.target.id==='focus-energy'){const el=document.getElementById('focus-energy-val');if(el)el.textContent=e.target.value;}
  if(e.target.id==='focus-conc'){const el=document.getElementById('focus-conc-val');if(el)el.textContent=e.target.value;}
});

/* ── Actions ── */
function goBack() {
  const m={'edit-task':'inbox',settings:'inbox',categories:'settings',results:'inbox',archive:'inbox'};
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
    difficulty: document.getElementById('f-diff')?.value||'medium',
    estimated_minutes: estMin, status, recurring: document.getElementById('f-rec')?.checked||false,
    series_id: existing?.series_id, postpone_count: existing?.postpone_count||0,
    today_order: existing?.today_order??(status==='today'?todayTasks.length:0),
    created_at: existing?.created_at||new Date().toISOString(),
    done_at: existing?.done_at||null, actual_minutes: existing?.actual_minutes||null,
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
  t.status='later'; t.today_order=0;
  t.postpone_count=(t.postpone_count||0)+1;
  DB.saveTask(t); logEvent(t,'postponed'); render();
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
  DB.setSetting('todayBlockMinutes',v);
  DB.setSetting('blockSetDate',todayStr());
  render();
}

function setBlockAndStart() {
  const v=parseInt(document.getElementById('block-min')?.value)||120;
  DB.setSetting('todayBlockMinutes',v);
  DB.setSetting('blockSetDate',todayStr());
  go('inbox');
}

function setBlockPreset(val) {
  const n=parseInt(val);
  const inp=document.getElementById('block-min');
  if(inp) inp.value=n;
  document.querySelectorAll('[data-action="set-block-preset"]').forEach(b=>b.classList.toggle('active',b.dataset.val===val));
}

function startTimer() {
  Timer.load();
  if(!Timer.queue.length){alert('Keine Aufgaben in der Heute-Liste!');return;}
  _requestNotifPerm();
  try { const ac=_getAC(); if(ac.state==='suspended') ac.resume().catch(()=>{}); } catch(e){}
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
  const color=document.getElementById('cat-color')?.value||CAT_COLORS[0];
  DB.saveCategory({id:uuid(),name,color}); render();
}

function pickColor(color) {
  document.querySelectorAll('.color-swatch').forEach(b=>b.classList.remove('selected'));
  document.querySelector(`[data-color="${color}"]`)?.classList.add('selected');
  const el=document.getElementById('cat-color'); if(el) el.value=color;
}

/* ── Drag & Drop (Today) ──
   Zeiger-basiert (Touch + Maus) statt HTML5-Drag: HTML5-Drag scrollt auf dem iPhone nicht mit,
   dadurch ließen sich Aufgaben nicht in den verdeckten Bereich ziehen. Hier scrollt die Seite
   automatisch, sobald der Finger in die Nähe von Kopfbereich oder Fußleiste kommt. */
function initDnD() {
  const list=document.getElementById('today-list'); if(!list) return;
  list.querySelectorAll('.drag-handle').forEach(h=>h.addEventListener('pointerdown',e=>startDrag(e,h.closest('.draggable'),list)));
}

let _dragCleanup=null;
function startDrag(e,item,list) {
  if(!item||(e.pointerType==='mouse'&&e.button!==0)) return;
  e.preventDefault();
  const pid=e.pointerId;
  const rect=item.getBoundingClientRect();
  const offsetY=e.clientY-rect.top;
  const ghost=item.cloneNode(true);
  ghost.classList.add('drag-ghost');
  Object.assign(ghost.style,{left:rect.left+'px',top:rect.top+'px',width:rect.width+'px'});
  document.body.appendChild(ghost);
  item.classList.add('drag-placeholder');
  document.body.classList.add('is-dragging');

  let y=e.clientY, raf=null;
  const EDGE=70, MAX_SPEED=18;
  const bounds=()=>{
    const top=document.querySelector('.sticky-header')?.getBoundingClientRect().bottom||0;
    const bottom=document.querySelector('.footer-fixed')?.getBoundingClientRect().top||window.innerHeight;
    return {top,bottom};
  };
  const place=()=>{
    ghost.style.top=(y-offsetY)+'px';
    const others=[...list.querySelectorAll('.draggable:not(.drag-placeholder)')];
    const before=others.find(el=>{ const r=el.getBoundingClientRect(); return y<r.top+r.height/2; });
    if(before){ if(item.nextElementSibling!==before) list.insertBefore(item,before); }
    else if(others.length&&item!==list.lastElementChild) others[others.length-1].after(item);
  };
  const tick=()=>{
    const {top,bottom}=bounds();
    let v=0;
    if(y<top+EDGE) v=-MAX_SPEED*Math.min(1,(top+EDGE-y)/EDGE);
    else if(y>bottom-EDGE) v=MAX_SPEED*Math.min(1,(y-(bottom-EDGE))/EDGE);
    if(v) { window.scrollBy(0,v); place(); }
    raf=requestAnimationFrame(tick);
  };
  // Auf dem ganzen Fenster lauschen: beim Umsortieren wandert die Karte im DOM,
  // dabei ginge eine Zeiger-Bindung an den Griff verloren (Loslassen käme nicht an).
  const move=ev=>{ if(ev.pointerId!==pid) return; ev.preventDefault(); y=ev.clientY; place(); };
  const end=ev=>{
    if(ev&&ev.pointerId!==pid) return;
    cancelAnimationFrame(raf);
    window.removeEventListener('pointermove',move);
    window.removeEventListener('pointerup',end);
    window.removeEventListener('pointercancel',end);
    _dragCleanup=null;
    ghost.remove(); item.classList.remove('drag-placeholder'); document.body.classList.remove('is-dragging');
    const tasks=DB.getTasks();
    [...list.querySelectorAll('.draggable')].forEach((c,i)=>{
      const t=tasks.find(t=>t.id===c.dataset.id);
      if(t&&t.today_order!==i){ t.today_order=i; DB.saveTask(t); }
    });
  };
  window.addEventListener('pointermove',move,{passive:false});
  window.addEventListener('pointerup',end);
  window.addEventListener('pointercancel',end);
  _dragCleanup=()=>end();
  place(); raf=requestAnimationFrame(tick);
}

/* ── KI-Coach View ── */
function vKI() {
  const hasKey = AI.hasKey();
  const procs  = AI.getProcrastinationWarnings();
  const suggs  = AI.getSmartSuggestions();
  const stats  = AI.getMotivationStats();
  const chat   = AI.getChatHistory();

  const loadingSpinner = `<div class="ai-loading"><span class="ai-spinner"></span> KI denkt nach…</div>`;

  /* Setup-Screen wenn kein API-Key */
  const setupCard = !hasKey ? `<div class="card ai-setup-card">
    <div class="ai-setup-icon">🤖</div>
    <h3 class="card-title">KI-Coach verbinden</h3>
    <p class="ai-setup-text">Verbinde Step4Step mit Google Gemini AI – kostenlos und ohne Kreditkarte.</p>
    <div class="form-group">
      <input type="password" id="ai-key-input" class="form-input" placeholder="AIza…">
      <p class="form-hint">Kostenloser Schlüssel unter aistudio.google.com → „Get API key"</p>
    </div>
    <button class="btn btn-primary btn-full" data-action="save-ai-key">Verbinden ›</button>
  </div>` : '';

  /* Motivations-Stats */
  const statsCard = stats.thisCount > 0 ? `<div class="card ai-stats-card">
    <div class="ai-stats-row">
      <span class="ai-stats-num">${stats.thisCount}</span>
      <span class="ai-stats-label">Aufgaben diese Woche</span>
    </div>
    ${stats.diff !== null ? `<p class="ai-stats-compare ${stats.diff>=0?'ai-stats-up':'ai-stats-down'}">${stats.diff>=0?'↑':'↓'} ${Math.abs(stats.diff)}% vs. letzte Woche</p>` : ''}
  </div>` : '';

  /* Smarte lokale Empfehlungen (immer sichtbar) */
  const suggsCard = `<div class="card">
    <h3 class="card-title">⚡ Nächste sinnvolle Aufgaben</h3>
    ${suggs.length === 0
      ? `<p class="text-muted">Keine Aufgaben in der Liste. Super – oder neue anlegen?</p>`
      : suggs.map((t,i)=>`<div class="ai-sugg-item ${i===0?'ai-sugg-primary':''}">
          <div class="ai-sugg-content">
            <span class="ai-sugg-title">${esc(t.title)}</span>
            <span class="ai-sugg-meta">${t.estimated_minutes} min · ${t.priority==='high'?'Wichtig':t.priority==='medium'?'Mittel':'Niedrig'}${(t.postpone_count||0)>0?` · ${t.postpone_count}× verschoben`:''}</span>
          </div>
          <button class="btn btn-sm ${i===0?'btn-primary':'btn-secondary'}" data-action="add-focus-task" data-id="${t.id}">📅</button>
        </div>`).join('')}
    <p class="ai-rule-hint">Maximal 3 Vorschläge · danach Pause machen ☕</p>
    ${suggs.length>0?`<button class="btn btn-secondary btn-full mt-sm" data-action="add-all-suggestions">📅 Alle Vorschläge in Heute-Liste übernehmen</button>`:''}
  </div>`;

  /* Prokrastinations-Warnungen */
  const procsCard = procs.length > 0 ? `<div class="card ai-procs-card">
    <h3 class="card-title">⚠️ Mehrfach verschoben (${procs.length})</h3>
    ${procs.map(t=>`<div class="proc-item">
      <div class="proc-content">
        <span class="proc-title">${esc(t.title)}</span>
        <span class="proc-count">${t.postpone_count}× verschoben</span>
      </div>
      ${hasKey?`<button class="btn btn-sm btn-secondary" data-action="ai-split" data-id="${t.id}">${S.aiLoading?'…':'✂️ Aufteilen'}</button>`:''}
    </div>`).join('')}
  </div>` : '';

  /* Decompose-Ergebnis */
  const decomposeCard = S.decomposeResult ? `<div class="card ai-decompose-card">
    <h3 class="card-title">✂️ Aufgabe aufgeteilt: "${esc(S.decomposeResult.taskTitle)}"</h3>
    <p class="ai-decompose-hint">Wähle Teilschritte aus, die du übernehmen möchtest:</p>
    ${S.decomposeResult.subtasks.map((st,i)=>`<div class="decompose-item">
      <div class="decompose-content">
        <span class="decompose-title">${esc(st.title)}</span>
        <span class="decompose-meta">${st.estimated_minutes} min · ${st.difficulty==='easy'?'Einfach':st.difficulty==='medium'?'Mittel':'Schwer'} · Energie: ${st.energy==='low'?'Niedrig':st.energy==='medium'?'Mittel':'Hoch'}</span>
      </div>
      <button class="btn btn-sm btn-primary" data-action="add-subtask" data-idx="${i}">+ Hinzufügen</button>
    </div>`).join('')}
    <div class="decompose-actions">
      <button class="btn btn-secondary" data-action="dismiss-decompose">Schließen</button>
      <button class="btn btn-primary" data-action="accept-all-subtasks">Alle übernehmen</button>
    </div>
  </div>` : '';

  /* Fokusmodus */
  const focusCard = hasKey ? `<div class="card">
    <h3 class="card-title">🎯 Fokusmodus</h3>
    ${S.focusResult
      ? `<p class="focus-meta">Zeit: ${S.focusResult.meta.minutes} Min · Energie: ${S.focusResult.meta.energy}/10 · Konzentration: ${S.focusResult.meta.conc}/10</p>
         ${S.focusResult.recommendations.length === 0
           ? `<p class="text-muted">Keine passenden Aufgaben gefunden. Vielleicht eine Pause?</p>`
           : S.focusResult.recommendations.map((r,i)=>
               `<div class="ai-sugg-item ${i===0?'ai-sugg-primary':''}">
                  <div class="ai-sugg-content">
                    <span class="ai-sugg-title">${esc(r.task.title)}</span>
                    <span class="ai-sugg-meta">${r.task.estimated_minutes} min · ${esc(r.reason)}</span>
                  </div>
                  <button class="btn btn-sm ${i===0?'btn-primary':'btn-secondary'}" data-action="add-focus-task" data-id="${r.task.id}">📅</button>
                </div>`
             ).join('')}
         <button class="btn btn-sm btn-secondary mt-sm" data-action="focus-reset">Neu eingeben</button>`
      : `<div class="focus-form">
           <div class="focus-row">
             <label class="focus-label">⏱ Zeit (Min)</label>
             <input type="number" id="focus-min" class="form-input input-sm" value="30" min="5" max="480">
           </div>
           <div class="focus-row">
             <label class="focus-label">⚡ Energie <span id="focus-energy-val">5</span>/10</label>
             <input type="range" id="focus-energy" class="focus-range" min="1" max="10" value="5">
           </div>
           <div class="focus-row">
             <label class="focus-label">🧠 Konzentration <span id="focus-conc-val">5</span>/10</label>
             <input type="range" id="focus-conc" class="focus-range" min="1" max="10" value="5">
           </div>
           ${S.aiLoading
             ? loadingSpinner
             : `<button class="btn btn-primary btn-full" data-action="focus-go">KI fragen ›</button>`}
         </div>`}
  </div>` : '';

  /* Tagesplan */
  const planCard = hasKey ? `<div class="card">
    <h3 class="card-title">📋 Tagesplan</h3>
    ${S.dailyPlan
      ? `<div class="ai-plan">${esc(S.dailyPlan).replace(/\n/g,'<br>')}</div>
         <button class="btn btn-sm btn-secondary mt-sm" data-action="gen-plan">Neu erstellen</button>`
      : `${S.aiLoading ? loadingSpinner : `<button class="btn btn-primary btn-full" data-action="gen-plan">Tagesplan erstellen</button>`}
         <p class="form-hint">Die KI analysiert deine Aufgaben und erstellt einen persönlichen Plan.</p>`}
  </div>` : '';

  /* Chat */
  const chatCard = hasKey ? `<div class="card ai-chat-card">
    <h3 class="card-title">💬 Dein Coach</h3>
    <div class="chat-messages" id="chat-messages">
      ${chat.length === 0
        ? `<div class="chat-welcome">
             <p>Hallo! Ich bin dein Arbeitscoach.</p>
             <p>Schreib mir zum Beispiel:<br><em>"Ich weiß nicht, wo ich anfangen soll."</em></p>
           </div>`
        : chat.map(m=>`<div class="chat-msg chat-msg-${m.role}">
             <span class="chat-bubble">${esc(m.content).replace(/\n/g,'<br>')}</span>
           </div>`).join('')}
      ${S.aiLoading ? `<div class="chat-msg chat-msg-assistant"><span class="chat-bubble chat-typing">●●●</span></div>` : ''}
    </div>
    <div class="chat-input-row">
      <input type="text" id="chat-input" class="form-input chat-input" placeholder="Schreib etwas…" ${S.aiLoading?'disabled':''}>
      <button class="btn btn-primary chat-send-btn" data-action="send-chat" ${S.aiLoading?'disabled':''}>↑</button>
    </div>
    ${chat.length > 0 ? `<button class="btn-link mt-sm" data-action="clear-chat">Chat löschen</button>` : ''}
  </div>` : '';

  return `<div class="view">${tabBar()}
    <div class="sticky-header">${hdr('KI-Coach')}</div>
    <div class="content">
      ${setupCard}
      ${statsCard}
      ${decomposeCard}
      ${suggsCard}
      ${procsCard}
      ${focusCard}
      ${planCard}
      ${chatCard}
    </div>
  </div>`;
}

/* ── KI Action Functions ── */
function saveFbConfig() {
  let raw=(document.getElementById('fb-config-input')?.value||'').trim();
  if(!raw){alert('Bitte die Firebase-Konfiguration eingeben.');return;}
  try {
    // Bereinigung: entfernt "const firebaseConfig = " und abschließendes Semikolon
    raw=raw.replace(/^(?:const|var|let)\s+\w+\s*=\s*/,'').replace(/;?\s*$/,'');
    // Akzeptiert JavaScript-Objekt-Notation UND gültiges JSON
    // eslint-disable-next-line no-new-func
    const obj=Function('return ('+raw+')')();
    if(!obj||!obj.apiKey||!obj.projectId){
      alert('Konfiguration unvollständig.\nBitte den gesamten { ... } Block aus Firebase kopieren – er muss apiKey und projectId enthalten.');
      return;
    }
    DB.setSetting('firebaseConfig',JSON.stringify(obj));
    Sync.init().then(ok=>{
      if(ok) render();
      else { render(); setTimeout(()=>Sync.signIn().then(()=>render()).catch(e=>alert('Anmeldung fehlgeschlagen: '+e.message)),300); }
    });
  } catch(e) {
    alert('Format nicht erkannt.\nBitte den { ... } Block direkt aus dem Firebase-Code kopieren (ohne "const firebaseConfig =").');
  }
}

function saveAiKey() {
  const key=(document.getElementById('ai-key-input')?.value||'').trim();
  if(!key){alert('Bitte einen API-Schlüssel eingeben.');return;}
  DB.setSetting('geminiKey',key); render();
}

async function sendChat() {
  const input=document.getElementById('chat-input');
  const msg=(input?.value||'').trim();
  if(!msg||S.aiLoading) return;

  const history=AI.getChatHistory();
  history.push({role:'user',content:msg});
  AI.saveChatHistory(history);
  S.aiLoading=true; render();

  try {
    const apiHistory=history.slice(0,-1).map(m=>({role:m.role,content:m.content}));
    const reply=await AI.chat(apiHistory,msg);
    history.push({role:'assistant',content:reply});
  } catch(e) {
    const errMsg=e.message==='NO_KEY'?'Kein API-Schlüssel konfiguriert.':e.message;
    history.push({role:'assistant',content:`Fehler: ${errMsg}`});
  }
  AI.saveChatHistory(history);
  S.aiLoading=false; render();
}

async function genPlan() {
  if(S.aiLoading) return;
  S.aiLoading=true; S.dailyPlan=null; render();
  try { S.dailyPlan=await AI.getDailyPlan(); }
  catch(e) { alert('KI-Fehler: '+e.message); }
  S.aiLoading=false; render();
}

async function aiSplit(id) {
  const task=DB.getTasks().find(t=>t.id===id);
  if(!task||S.aiLoading) return;
  S.aiLoading=true; S.decomposeResult=null; render();
  try {
    const subtasks=await AI.decomposeTasks(task.title,task.estimated_minutes);
    S.decomposeResult={taskId:task.id,taskTitle:task.title,subtasks};
    go('ki'); // KI-Tab öffnen um Ergebnis zu zeigen
  } catch(e) { alert('KI-Fehler: '+e.message); }
  S.aiLoading=false; render();
}

async function focusGo() {
  if(S.aiLoading) return;
  const minutes=parseInt(document.getElementById('focus-min')?.value)||30;
  const energy=parseInt(document.getElementById('focus-energy')?.value)||5;
  const conc=parseInt(document.getElementById('focus-conc')?.value)||5;
  S.aiLoading=true; render();
  try {
    const recs=await AI.getFocusRecommendations(minutes,energy,conc);
    S.focusResult={recommendations:recs,meta:{minutes,energy,conc}};
  } catch(e) { alert('KI-Fehler: '+e.message); }
  S.aiLoading=false; render();
}

function addSubtask(idx) {
  if(!S.decomposeResult) return;
  const st=S.decomposeResult.subtasks[idx]; if(!st) return;
  DB.saveTask({
    id:uuid(), title:st.title,
    category:'Privat', priority:'medium', difficulty:['easy','medium','hard'].includes(st.difficulty)?st.difficulty:'medium',
    estimated_minutes:st.estimated_minutes||10,
    status:'later', recurring:false, today_order:0,
    created_at:new Date().toISOString(),
    done_at:null, actual_minutes:null,
  });
  S.decomposeResult.subtasks.splice(idx,1);
  if(!S.decomposeResult.subtasks.length) S.decomposeResult=null;
  render();
}

function acceptAllSubtasks() {
  if(!S.decomposeResult) return;
  S.decomposeResult.subtasks.forEach(st=>{
    DB.saveTask({
      id:uuid(), title:st.title,
      category:'Privat', priority:'medium', difficulty:['easy','medium','hard'].includes(st.difficulty)?st.difficulty:'medium',
      estimated_minutes:st.estimated_minutes||10,
      status:'later', recurring:false, today_order:0,
      created_at:new Date().toISOString(),
      done_at:null, actual_minutes:null,
    });
  });
  S.decomposeResult=null; render();
}

function addAllSuggestions() {
  const suggs=AI.getSmartSuggestions();
  const bMin=DB.getSetting('todayBlockMinutes',0);
  let added=0;
  suggs.forEach(t=>{
    if(t.status==='today') return;
    if(bMin){
      const used=DB.getTasks().filter(x=>x.status==='today').reduce((s,x)=>s+x.estimated_minutes,0);
      if(used+t.estimated_minutes>bMin) return;
    }
    t.status='today'; t.today_order=DB.getTasks().filter(x=>x.status==='today').length;
    DB.saveTask(t); added++;
  });
  if(added>0) render();
  else alert('Alle Vorschläge sind bereits in der Heute-Liste oder der Zeitblock ist voll.');
}

/* ── Benachrichtigungen (Feature ③) ── */
async function _requestNotifPerm() {
  if(!('Notification' in window)) return false;
  if(Notification.permission==='granted') return true;
  if(Notification.permission==='denied') return false;
  return (await Notification.requestPermission())==='granted';
}

function _sendTimerNotification(title) {
  if(!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.ready.then(reg=>{
    reg.showNotification('⏰ Zeit abgelaufen!',{
      body:`"${title}" – Erledigt oder weiter?`,
      icon:'icons/icon-192.png', badge:'icons/icon-192.png',
      tag:'s4s-timer', requireInteraction:true,
      vibrate:[200,100,200],
    });
  }).catch(()=>{
    if(Notification.permission==='granted')
      new Notification('⏰ Zeit abgelaufen!',{body:`"${title}"`});
  });
}

/* ── Hintergrund-Timer: Seite wieder sichtbar ── */
document.addEventListener('visibilitychange',()=>{
  if(!document.hidden&&['RUNNING','OVERTIME','INTRO'].includes(Timer.state)) {
    Timer._tick(); render(); // sofort neu berechnen
  }
});

/* ── Sync-Debounce (Feature ①) ── */
let _syncTimer=null;
function scheduleSync() {
  clearTimeout(_syncTimer);
  _syncTimer=setTimeout(()=>{
    if(typeof Sync!=='undefined'&&Sync.isConnected()) Sync.pushAll();
  },2000);
}
// localStorage-Patch: jede Daten-Schreiboperation triggert Sync
const _origSetItem=localStorage.setItem.bind(localStorage);
localStorage.setItem=function(k,v){
  _origSetItem(k,v);
  if(['tasks','results','categories','time_log'].includes(k)) scheduleSync();
};

/* ── startTimer: Berechtigung anfragen ── */
const _origStartTimer=startTimer;

/* ── Init ── */
function init() {
  // Einmalig: Kategorie-Farben der alten Palette auf die Corporate-Design-Palette umstellen
  if(!DB.getSetting('cdColorsMigrated',false)) {
    DB.getCategories().forEach(c=>{
      const i=OLD_CAT_COLORS.indexOf((c.color||'').toLowerCase());
      if(i>=0) DB.saveCategory({...c,color:CAT_COLORS[i]});
    });
    DB.setSetting('cdColorsMigrated',true);
  }
  // Einmalig: bereits erledigte, noch gespeicherte Aufgaben ins Zeit-Protokoll übernehmen
  if(!DB.getSetting('timeLogSeeded',false)) {
    DB.getTasks().filter(t=>t.status==='done'&&t.actual_minutes).forEach(logDone);
    DB.setSetting('timeLogSeeded',true);
  }
  if(DB.getSetting('hideWelcome',false)) {
    const blockMin=DB.getSetting('todayBlockMinutes',0);
    const blockDate=DB.getSetting('blockSetDate','');
    const blockOk=blockMin>0&&blockDate===todayStr();
    S.view=blockOk?'inbox':'block-setup';
    S.tab='inbox';
  }
  if(typeof Sync!=='undefined'&&Sync.hasConfig()) Sync.init().then(()=>render());
  render();
}
init();
