/* ── Particle canvas (optional background) ── */
(function(){
  const c=document.getElementById('bgc');
  if(!c||!c.getContext) return;
  const ctx=c.getContext('2d');
  let W,H,pts=[];
  function resize(){W=c.width=window.innerWidth;H=c.height=window.innerHeight}
  function mkPt(){return{x:Math.random()*W,y:Math.random()*H,vx:(Math.random()-.5)*.28,vy:(Math.random()-.5)*.28,r:Math.random()*1.5+.4}}
  resize();
  for(let i=0;i<90;i++)pts.push(mkPt());
  window.addEventListener('resize',resize);
  const C1=[0,229,255],C2=[123,97,255];
  function lerp(a,b,t){return a.map((v,i)=>v+(b[i]-v)*t)}
  function draw(){
    ctx.clearRect(0,0,W,H);
    const g=ctx.createRadialGradient(W*.15,H*.1,0,W*.15,H*.1,W*.6);
    g.addColorStop(0,'rgba(0,60,80,.06)');g.addColorStop(1,'transparent');
    ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
    const g2=ctx.createRadialGradient(W*.85,H*.85,0,W*.85,H*.85,W*.5);
    g2.addColorStop(0,'rgba(60,30,120,.06)');g2.addColorStop(1,'transparent');
    ctx.fillStyle=g2;ctx.fillRect(0,0,W,H);
    for(let i=0;i<pts.length;i++){
      for(let j=i+1;j<pts.length;j++){
        const dx=pts[i].x-pts[j].x,dy=pts[i].y-pts[j].y,d=Math.sqrt(dx*dx+dy*dy);
        if(d<130){
          const alpha=(1-d/130)*0.18,t=(pts[i].x+pts[j].x)/(2*W);
          const[r,g3,b]=lerp(C1,C2,t);
          ctx.strokeStyle=`rgba(${r},${g3},${b},${alpha})`;ctx.lineWidth=.6;
          ctx.beginPath();ctx.moveTo(pts[i].x,pts[i].y);ctx.lineTo(pts[j].x,pts[j].y);ctx.stroke();
        }
      }
    }
    pts.forEach(p=>{
      const t=p.x/W,[r,g3,b]=lerp(C1,C2,t);
      ctx.fillStyle=`rgba(${r},${g3},${b},.55)`;
      ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);ctx.fill();
      p.x+=p.vx;p.y+=p.vy;
      if(p.x<-10)p.x=W+10;if(p.x>W+10)p.x=-10;
      if(p.y<-10)p.y=H+10;if(p.y>H+10)p.y=-10;
    });
    requestAnimationFrame(draw);
  }
  draw();
})();

/* ── Theme ── */
function toggleTheme(){
  const html=document.documentElement;
  const isLight=html.dataset.theme==='light';
  html.dataset.theme=isLight?'dark':'light';
  localStorage.setItem('nxTheme',html.dataset.theme);
  _setThemeIcon(html.dataset.theme);
}
function _setThemeIcon(theme){
  const icon=document.getElementById('themeIcon');
  if(!icon) return;
  icon.setAttribute('data-lucide',theme==='light'?'moon':'sun');
  lucide.createIcons({el:document.getElementById('themeToggle')});
}
// Apply saved theme immediately (before paint) to avoid flash
(function(){
  const t=localStorage.getItem('nxTheme')||'dark';
  document.documentElement.dataset.theme=t;
})();

/* ── State ── */
// allGroups: [{ id, name, testCases: [{name, file, turns, isEdge, hasUpload}] }]
let allGroups    = [];
/** 'agent' (default) | 'all' — agent hides script markdown duplicates in sidebar */
let flowViewMode = 'agent';
/** Run panel: journeys only (no per-spec checklist). Specs still rotate in the runner. */
const journeyOnlyUI = true;
let selected     = new Set(); // Set of test case names
let selectedJourneys = new Set(); // groupId — journey-level multi-run
let starred      = new Set(JSON.parse(localStorage.getItem('starredFlows')||'[]')); // persisted stars
let running      = false;
let chromeReady  = false;
let currentRunId = null;
let runEventSource = null;
let runStreamReconnectAttempts = 0;
const RUN_SSE_MAX_RECONNECT = 12;
let runStreamCounters = { passed: 0, partial: 0, failed: 0, skipped: 0, automation: 0 };
let advancedSub = 'tune';
let dbGatePending = null;
let journeyBriefs = {};
let briefModalGroupId = null;
let manualSpecsGroupId = null;
let generateSpecsGroupId = null;
let lastRunReport = { jsonFile: null, htmlFile: null, fullHtmlFile: null, failedCount: 0, failedSpecs: [] };
let genAgentSpec = null;
/** Filled by GET /api/config — matches server report directory (same as runner output). */
let UI_CONFIG = null;

document.addEventListener('DOMContentLoaded', async ()=>{
  lucide.createIcons();
  // Set correct theme icon after icons are initialised
  _setThemeIcon(document.documentElement.dataset.theme||'dark');
  // Restore saved User ID
  const savedUserId = localStorage.getItem('genUserId');
  if (savedUserId) document.getElementById('genUserId').value = savedUserId;
  await loadUiConfig();
  refreshChromeStatus(); await loadJourneyBriefs(); await loadFlows(); loadHistory();
  const ggs=document.getElementById('genGroup');
  if(ggs) ggs.addEventListener('change', onGenGroupChange);
  const cpi=document.getElementById('chromeProfileInp');
  if(cpi){
    cpi.addEventListener('input',()=>{
      cpi.dataset.touched='1';
      const v=cpi.value.trim();
      if(v) localStorage.setItem('chromeProfile',v);
    });
  }
  setInterval(refreshChromeStatus, 10000);
});

async function loadUiConfig(){
  try{
    const r=await fetch('/api/config');
    if(!r.ok)return;
    UI_CONFIG=await r.json();
    applyReportUiFromConfig();
  }catch{}
}
function applyReportUiFromConfig(){
  if(!UI_CONFIG)return;
  const name=UI_CONFIG.reportFolderName||'';
  const dir=UI_CONFIG.reportDir||'';
  const fn=document.getElementById('lblReportFolder');
  const bn=document.getElementById('reportFolderBanner');
  if(fn)fn.textContent=name||'(unknown)';
  if(bn){bn.style.display='flex'; bn.title='Full path: '+dir;}

  const hfn=document.getElementById('lblHistReportFolder');
  const hb=document.getElementById('histReportBanner');
  if(hfn)hfn.textContent=name||'—';
  if(hb){hb.style.display='flex'; hb.title=dir;}

  const ci=document.getElementById('chromeProfileInp');
  if(ci&&UI_CONFIG){
    const defProf=UI_CONFIG.chromeProfileDefault||'Profile 3';
    ci.placeholder='e.g. '+defProf;
    if(!ci.dataset.touched){ ci.value=localStorage.getItem('chromeProfile')||defProf; }
  }
  const pc=document.getElementById('chromeParallelChk');
  if(pc&&localStorage.getItem('chromeParallel')==='0') pc.checked=false;
  const yb=document.getElementById('yellowClearCtxBtn');
  if(yb&&UI_CONFIG){
    const uid=(UI_CONFIG.yellowBotId||'x1775730043011')+':'+(UI_CONFIG.yellowSender||'');
    yb.title='DELETE Yellow Forge user context for '+uid+' (API only — no $$_clearContext$_$ in chat unless HR_BETWEEN_SPEC_USE_CHAT_TOKEN=1)';
  }
  lucide.createIcons({el:document.body});
}

async function clearYellowContextFromUi(){
  const btn=document.getElementById('yellowClearCtxBtn');
  if(btn) btn.disabled=true;
  toast('Clearing Yellow user context…','ok');
  try{
    const r=await fetch('/api/yellow/clear-context',{method:'POST'});
    const d=await r.json();
    if(!d.ok) throw new Error(d.message||d.error||'Clear context failed');
    toast(d.message||'Context cleared','ok');
    log('🔄 '+((d.message)||'Yellow user context cleared')+(d.userId?' ('+d.userId+')':''),'head');
  }catch(err){
    toast(err.message||String(err),'er');
    log('❌ Yellow context clear failed: '+(err.message||String(err)),'fail');
  }finally{
    if(btn) btn.disabled=false;
  }
}

/* ── Chrome CDP (real check via server → 127.0.0.1:9222/json/version) ── */
async function refreshChromeStatus(){
  const b=document.getElementById('sbadge'),d=document.getElementById('pdot'),l=document.getElementById('slbl');
  if(!b||!d||!l)return false;
  try{
    const r=await fetch('/api/chrome/status');
    const j=await r.json();
    chromeReady=!!j.ok;
    const hb=document.getElementById('chromeHelpBox');
    if(hb) hb.style.display=j.ok?'none':'block';
    if(j.ok){
      d.className='pdot'; b.className='sbadge ok';
      const ver=(j.Browser||'Chrome').replace(/^Mozilla\/.*?\s+/,'').slice(0,32);
      l.textContent=`CDP · ${j.host}:${j.port} · ${ver||'OK'}`;
      l.title=j.Browser||'CDP reachable';
      return true;
    }
    d.className='pdot'; b.className='sbadge er';
    l.textContent=`CDP offline (${j.host}:${j.port})`;
    l.title=j.error||'Start Chrome from header';
    return false;
  }catch(e){
    chromeReady=false;
    d.className='pdot'; b.className='sbadge er';
    l.textContent='CDP check failed';
    l.title=e.message||'';
    return false;
  }
}

async function launchChromeFromUi(){
  if(chromeReady){
    toast('CDP connected — run tests against the automation Chrome window.','ok');
    return;
  }
  const inp=document.getElementById('chromeProfileInp');
  const parChk=document.getElementById('chromeParallelChk');
  const def=(UI_CONFIG&&UI_CONFIG.chromeProfileDefault)||'Profile 3';
  const profile=(inp&&inp.value.trim())||localStorage.getItem('chromeProfile')||def;
  const parallel=parChk?!!parChk.checked:(localStorage.getItem('chromeParallel')!=='0');
  if(inp){ inp.value=profile; inp.dataset.touched='1'; }
  if(parChk) localStorage.setItem('chromeParallel',parallel?'1':'0');
  localStorage.setItem('chromeProfile',profile);
  const btn=document.getElementById('chromeLaunchBtn');
  if(btn) btn.disabled=true;
  toast(parallel?'Opening automation Chrome (your other Chrome can stay open)…':'Live mode: quit Chrome (Cmd+Q) first…','ok');
  try{
    const r=await fetch('/api/chrome/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({profile,useCopy:false,useLive:!parallel})});
    const d=await r.json();
    if(!d.ok){
      const msg=(d.details&&d.details.trim())?d.details.trim():(d.error||'Prepare failed');
      throw new Error(msg);
    }
    if(d.details) console.log('[start-chrome]',d.details);
    toast(parallel?'Automation Chrome ready — open HR Chat in that window':'Chrome ready — use this window for Chat','ok');
    if(parallel) log('ℹ️  Parallel: work in your normal Chrome; tests use the other window. Put HR bot Chat in the automation Chrome.','head');
  }catch(err){
    const m=err.message||String(err);
    toast(m.length>120?m.slice(0,117)+'…':m,'er');
    if(m.includes('Live mode')||m.includes('quit')) log('ℹ️  Turn on Parallel in the header, or quit Chrome (Cmd+Q) for live mode.','head');
  }finally{
    if(btn) btn.disabled=false;
    await refreshChromeStatus();
  }
}

/* ── Tabs ── */
const PANEL_BY_TAB={run:'pr',history:'ph',reports:'preports',advanced:'padvanced',manage:'pm'};

function switchAdvancedSub(sub){
  advancedSub = sub === 'generator' ? 'generator' : 'tune';
  document.querySelectorAll('.adv-btn').forEach(b=>{
    b.classList.toggle('active', b.dataset.adv === advancedSub);
  });
  const pt = document.getElementById('pt');
  const pg = document.getElementById('pg');
  if(pt) pt.classList.toggle('active', advancedSub === 'tune');
  if(pg) pg.classList.toggle('active', advancedSub === 'generator');
  if(advancedSub === 'tune') loadTuneData();
  if(typeof lucide!=='undefined') lucide.createIcons({el:document.getElementById('padvanced')});
}

function switchTab(tab){
  document.querySelectorAll('.tb').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
  const pid=PANEL_BY_TAB[tab]||('p'+tab[0]);
  const advRoot=document.getElementById('advancedRoot');
  document.querySelectorAll('.panel').forEach(p=>{
    if(p.id==='padvanced'){
      p.classList.toggle('active',tab==='advanced');
      return;
    }
    p.classList.toggle('active',p.id===pid&&tab!=='advanced');
  });
  if(advRoot) advRoot.classList.toggle('active',tab==='advanced');
  document.querySelectorAll('.adv-pane').forEach(p=>p.classList.remove('active'));
  if(tab==='advanced'){
    switchAdvancedSub(advancedSub);
  }
  if(tab==='history') loadHistory();
  if(tab==='reports') loadReportsList();
  if(tab==='manage')  loadManage();
}

let reportsState={list:[],selected:null};

async function loadReportsList(){
  const el=document.getElementById('repList');
  if(!el) return;
  try{
    const r=await fetch('/api/reports');
    const list=await r.json();
    reportsState.list=list;
    if(!list.length){
      el.innerHTML='<div class="hempty" style="padding:24px"><div class="hempty-txt">No saved runs yet</div></div>';
      return;
    }
    el.innerHTML=list.map((item,i)=>{
      const d=new Date(item.date).toLocaleString();
      const stats=`${item.passed|0} passed · ${item.partial|0} partial · ${item.failed|0} failed`;
      return `<div class="rep-item${reportsState.selected&&reportsState.selected.file===item.file?' on':''}" onclick="selectReportRun(${i})">
        <div style="font-weight:700;font-size:13px">${esc(d)}</div>
        <div class="rep-d">${item.total|0} scenarios · ${stats}</div>
        <div class="rep-s">${item.excelFile?'Excel ✓':''} ${item.fullHtmlFile?'Full HTML ✓':'(rebuild for full HTML)'}</div>
      </div>`;
    }).join('');
    highlightReportListSelection();
    lucide.createIcons({el});
  }catch(e){
    el.innerHTML='<div class="hempty"><div class="hempty-txt">Failed to load</div></div>';
  }
}

function highlightReportListSelection(){
  const el=document.getElementById('repList');
  if(!el||!reportsState.list.length) return;
  el.querySelectorAll('.rep-item').forEach((node,i)=>{
    const item=reportsState.list[i];
    node.classList.toggle('on', !!(item&&reportsState.selected&&item.file===reportsState.selected.file));
  });
}

function reportHtmlDownloadHref(item,mode){
  if(!item||!item.file) return '#';
  const m=mode||'full';
  if(m==='full'&&item.fullHtmlFile) return '/api/reports/'+encodeURIComponent(item.fullHtmlFile);
  return '/api/report-export/'+encodeURIComponent(item.file)+'?mode='+encodeURIComponent(m);
}

function updateReportDownloadLinks(){
  const item=reportsState.selected;
  const bh=document.getElementById('repDlHtml');
  const bx=document.getElementById('repDlXlsx');
  const bp=document.getElementById('repDlPdf');
  if(!item||!bh) return;
  const mode=document.getElementById('repViewMode')?.value||'full';
  bh.href=reportHtmlDownloadHref(item,mode);
  bh.style.display='inline-flex';
  bh.title=mode==='passed'?'Download passed scenarios only (from JSON)':'Download full suite HTML';
  if(item.excelFile){bx.href='/api/reports/'+encodeURIComponent(item.excelFile);bx.style.display='inline-flex';}else if(bx) bx.style.display='none';
  if(item.pdfFile&&mode==='full'){bp.href='/api/reports/'+encodeURIComponent(item.pdfFile);bp.style.display='inline-flex';}
  else if(bp){bp.style.display='none';}
}

function selectReportRun(idx){
  const item=reportsState.list[idx];
  if(!item) return;
  reportsState.selected=item;
  highlightReportListSelection();
  const vm=document.getElementById('repViewMode');
  if(vm&&!vm.dataset.userPicked) vm.value='full';
  document.getElementById('repToolbar').style.display='block';
  document.getElementById('repMeta').textContent=
    `${item.total} scenarios · ${item.passed} passed · ${item.partial} partial · ${item.failed} failed${item.automation?` · ${item.automation} not scored`:''}`;
  updateReportDownloadLinks();
  reportsPreviewCurrent();
}

function reportsPreviewCurrent(){
  const item=reportsState.selected;
  const frame=document.getElementById('repPreviewFrame');
  const empty=document.getElementById('repPreviewEmpty');
  if(!item||!frame){return;}
  const mode=document.getElementById('repViewMode')?.value||'full';
  const fmt=document.getElementById('repFormat')?.value||'html';
  updateReportDownloadLinks();
  if(fmt==='pdf'){
    if(mode==='full'&&item.pdfFile){
      frame.src='/api/reports/'+encodeURIComponent(item.pdfFile);
      frame.classList.add('on');
      empty.classList.add('hide');
    }else{
      frame.classList.remove('on');
      empty.classList.remove('hide');
      empty.textContent=mode==='passed'?'PDF is full-suite only. Switch export view to full suite or use HTML.':'No PDF for this run. Rebuild + PDF or use HTML preview.';
    }
    return;
  }
  let src='';
  if(mode==='passed'){
    src='/api/report-render/'+encodeURIComponent(item.file)+'?mode=passed&t='+Date.now();
  }else if(item.fullHtmlFile){
    src='/api/report-view/'+encodeURIComponent(item.fullHtmlFile)+'?t='+Date.now();
  }else{
    src='/api/report-render/'+encodeURIComponent(item.file)+'?mode=full&t='+Date.now();
  }
  frame.src=src;
  frame.classList.add('on');
  empty.classList.add('hide');
}

async function rebuildSelectedReport(withPdf){
  const item=reportsState.selected;
  if(!item){toast('Select a run first','er');return;}
  try{
    const r=await fetch('/api/reports/rebuild',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({file:item.file,pdf:!!withPdf})});
    const d=await r.json();
    if(!r.ok) throw new Error(d.error||'Rebuild failed');
    toast(withPdf?'Reports rebuilt + PDF':'Reports rebuilt (full HTML + Excel)','ok');
    await loadReportsList();
    const fresh=reportsState.list.find(x=>x.file===item.file);
    if(fresh) selectReportRun(reportsState.list.indexOf(fresh));
  }catch(e){toast('Rebuild failed: '+e.message,'er');}
}

/* ── Load flows ── */
function visibleCases(group){
  if(flowViewMode==='all') return group.testCases;
  return group.testCases.filter(tc=>tc.specType==='agent');
}

function getAgentEffortPct(){
  const el=document.getElementById('agentEffortSel');
  const v=el?parseInt(el.value,10):75;
  return [25,50,75,100].includes(v)?v:75;
}

async function toggleFlowView(){
  flowViewMode=flowViewMode==='agent'?'all':'agent';
  const btn=document.getElementById('viewToggle');
  if(btn) btn.textContent=flowViewMode==='agent'?'Show script flows':'Agent specs only';
  await loadFlows();
}

function agentJourneyCount(){
  return allGroups.filter(g=>g.testCases.some(tc=>tc.specType==='agent')).length;
}

function applyJourneyOnlyToolbar(){
  const tb=document.getElementById('flowToolbar');
  const sa=document.getElementById('btnSelectAll');
  const cl=document.getElementById('btnClearAll');
  if(tb) tb.style.display='flex';
  if(sa) sa.style.display='';
  if(cl) cl.style.display='';
  if(sa) sa.textContent=journeyOnlyUI?'All journeys':'All';
  if(cl) cl.textContent=journeyOnlyUI?'Clear':'Clear';
}

async function loadFlows(){
  try{
    const r=await fetch('/api/flows?view='+encodeURIComponent(flowViewMode==='all'?'all':'agent'));
    allGroups=await r.json();
    const total=allGroups.reduce((s,g)=>s+visibleCases(g).length,0);
    const jCount=agentJourneyCount();
    const displayCount=journeyOnlyUI?jCount:total;
    document.getElementById('tcRun').textContent=displayCount;
    document.getElementById('hFlows').textContent=displayCount;
    applyJourneyOnlyToolbar();
    renderGroups();
  }catch{
    document.getElementById('flist').innerHTML='<div style="padding:28px;text-align:center;color:var(--rd);font-size:12.5px">Could not load flows.<br>Is the server running?</div>';
  }
  await refreshAgentCheckpointUI();
}

/* ── Render grouped list ── */
function renderGroups(){
  const el=document.getElementById('flist');
  if(!allGroups.length){el.innerHTML='<div style="padding:28px;text-align:center;color:var(--t3);font-size:12.5px">No flows found.</div>';return;}

  el.innerHTML=allGroups.map(group=>{
    const cases  = visibleCases(group);
    const total  = cases.length;
    const selCnt = cases.filter(tc=>selected.has(tc.name)).length;
    const agentCnt = group.testCases.filter(tc => tc.specType === 'agent').length;
    const jOnly = journeyOnlyUI;
    const jSel = selectedJourneys.has(group.id);
    const chkCls = jOnly
      ? (jSel ? 'full' : '')
      : (selCnt===0?'':selCnt===total?'full':'part');
    const chkIcon = (jOnly ? jSel : selCnt===total)
      ? `<svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="1.5,5 4,7.5 8.5,2"/></svg>`
      : `<svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="2" y1="5" x2="8" y2="5"/></svg>`;
    const badgeTxt = jOnly ? `${agentCnt}` : `${selCnt} / ${total}`;
    const subTxt = jOnly
      ? `full journey${group.requiresDbDelete?' · DB clear each':''}`
      : `${agentCnt} agent spec${agentCnt!==1?'s':''}${group.requiresDbDelete?' · DB clear before each':''}`;

    const casesHtml = jOnly ? '' : total===0
      ? `<div class="no-cases">${agentCnt ? 'No agent specs listed' : 'No test cases'}</div>`
      : cases.map(tc=>{
          const isSel=selected.has(tc.name);
          const isStarred=starred.has(tc.name);
          return `<div class="tc-row${isSel?' sel':''}" data-tc="${esc(tc.name)}" data-group="${esc(group.id)}" data-file="${esc(tc.file)}">
            <div class="tc-chk">
              <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="1.5,5 4,7.5 8.5,2"/></svg>
            </div>
            <div class="tc-info">
              <div class="tc-name">${tc.name}</div>
              <div class="tc-tags">
                <span class="tag ${tc.isEdge?'tedge':'thappy'}">${tc.isEdge?'edge':'happy'}</span>
                ${tc.hasUpload?'<span class="tag tupload">upload</span>':''}
              </div>
            </div>
            <button class="tc-star${isStarred?' starred':''}" data-starname="${esc(tc.name)}" title="${isStarred?'Unstar':'Star'} this flow">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="${isStarred?'currentColor':'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
            </button>
            <button class="tc-eye" data-eyegroup="${esc(group.id)}" data-eyefile="${esc(tc.file)}" data-eyename="${esc(tc.name)}" title="Preview test case">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            </button>
          </div>`;
        }).join('');

    return `<div class="fgroup${jOnly?' journey-only':''}${jSel?' journey-selected':''}" id="grp-${group.id}">
      <div class="fgroup-hd" data-group="${esc(group.id)}">
        <svg class="grp-chev" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="5 3 11 8 5 13"/></svg>
        <div class="grp-chk ${chkCls}" data-grpchk="${esc(group.id)}">${chkIcon}</div>
        <div class="grp-info">
          <div class="grp-name">${group.name}${group.hasBrief?'<span class="grp-brief-dot" title="Journey brief saved"></span>':''}${group.requiresDbDelete?'<span class="grp-db-badge" title="Delete DB record before each spec">DB</span>':''}</div>
          <div class="grp-sub">${subTxt}</div>
        </div>
        <span class="grp-badge${jOnly||selCnt===0?' zero':''}">${badgeTxt}</span>
        <div class="grp-actions">
          <div class="grp-manual-wrap" id="manual-wrap-${esc(group.id)}">
            <button type="button" class="grp-run-manual" data-grp-run-manual="${esc(group.id)}" ${agentCnt===0?'disabled':''} title="Run all saved test cases (spec testdata, no LLM phrasing)">Manual</button>
            <button type="button" class="grp-manual-caret" data-grp-manual-menu="${esc(group.id)}" title="Generate test cases, brief, edit JSON" aria-label="Manual options">▾</button>
            <div class="grp-manual-pop" id="manual-pop-${esc(group.id)}">
              <button type="button" class="grp-gen-round" data-grp-generate="${esc(group.id)}" title="Generate test cases from agent prompt + brief (uses Effort %)"><i data-lucide="sparkles" style="width:18px;height:18px"></i></button>
              <button type="button" class="grp-brief-btn${group.hasBrief?' saved':''}" data-grp-brief="${esc(group.id)}">Brief</button>
              <button type="button" class="grp-specs-link" data-grp-manual="${esc(group.id)}">Test cases (JSON)</button>
            </div>
          </div>
          <button type="button" class="grp-run-agent" data-grp-run-agent="${esc(group.id)}" ${agentCnt===0?'disabled':''} title="LLM drives the journey — Effort % controls depth and retries">Agentic</button>
        </div>
      </div>
      <div class="fgroup-body">${casesHtml}</div>
    </div>`;
  }).join('');

  lucide.createIcons({el});
  /* Delegated listeners on the list */
  el.addEventListener('click', onListClick);
  updateBtn();
}

function esc(s){return (s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;')}

/* single delegated click handler */
function onListClick(e){
  /* Eye preview button — always allowed even while running */
  const eye=e.target.closest('[data-eyefile]');
  if(eye){e.stopPropagation();openPreview(eye.dataset.eyegroup,eye.dataset.eyefile,eye.dataset.eyename);return;}

  /* Star button — always allowed even while running */
  const starBtn=e.target.closest('[data-starname]');
  if(starBtn){e.stopPropagation();toggleStar(starBtn.dataset.starname);return;}

  if(running) return;

  /* Click on group checkbox → toggle all in group */
  const grpChk=e.target.closest('[data-grpchk]');
  if(grpChk){e.stopPropagation();toggleGroup(grpChk.dataset.grpchk);return;}

  const grpManualMenu=e.target.closest('[data-grp-manual-menu]');
  if(grpManualMenu){e.stopPropagation();toggleManualPopover(grpManualMenu.dataset.grpManualMenu);return;}

  const grpRunManual=e.target.closest('[data-grp-run-manual]');
  if(grpRunManual){e.stopPropagation();closeAllManualPopovers();runGroupManual(grpRunManual.dataset.grpRunManual);return;}

  const grpManual=e.target.closest('[data-grp-manual]');
  if(grpManual){e.stopPropagation();closeAllManualPopovers();openManualSpecsModal(grpManual.dataset.grpManual);return;}

  const grpGenerate=e.target.closest('[data-grp-generate]');
  if(grpGenerate){e.stopPropagation();closeAllManualPopovers();openGenerateSpecsModal(grpGenerate.dataset.grpGenerate);return;}

  const grpBrief=e.target.closest('[data-grp-brief]');
  if(grpBrief){e.stopPropagation();closeAllManualPopovers();openBriefModal(grpBrief.dataset.grpBrief);return;}

  const grpRun=e.target.closest('[data-grp-run-agent]');
  if(grpRun){e.stopPropagation();closeAllManualPopovers();runGroupAgentic(grpRun.dataset.grpRunAgent);return;}

  /* Click on group header row → expand/collapse */
  const hd=e.target.closest('.fgroup-hd');
  if(hd && !e.target.closest('[data-grpchk]')){
    const grpEl=document.getElementById('grp-'+hd.dataset.group);
    if(grpEl) grpEl.classList.toggle('open');
    return;
  }

  /* Click on test case row */
  const tcRow=e.target.closest('.tc-row');
  if(tcRow) toggleTC(tcRow.dataset.tc);
}

function toggleTC(name){
  if(!name||running) return;
  selected.has(name)?selected.delete(name):selected.add(name);
  refreshUI();
}

function toggleGroup(groupId){
  if(running) return;
  const group=allGroups.find(g=>g.id===groupId);
  if(!group) return;
  if(journeyOnlyUI){
    const hasAgent=group.testCases.some(tc=>tc.specType==='agent');
    if(!hasAgent){ toast('No agent scenarios in this journey','er'); return; }
    if(selectedJourneys.has(groupId)) selectedJourneys.delete(groupId);
    else selectedJourneys.add(groupId);
    refreshUI();
    return;
  }
  const vis=visibleCases(group);
  const allSel=vis.length&&vis.every(tc=>selected.has(tc.name));
  vis.forEach(tc=>{ allSel?selected.delete(tc.name):selected.add(tc.name); });
  refreshUI();
}

function toggleStar(name){
  if(!name) return;
  starred.has(name) ? starred.delete(name) : starred.add(name);
  localStorage.setItem('starredFlows', JSON.stringify([...starred]));
  refreshUI();
}

function selectAll(){
  if(journeyOnlyUI){
    allGroups.forEach(g=>{
      if(g.testCases.some(tc=>tc.specType==='agent')) selectedJourneys.add(g.id);
    });
  }else{
    allGroups.forEach(g=>visibleCases(g).forEach(tc=>selected.add(tc.name)));
  }
  refreshUI();
}
function clearAll(){
  if(journeyOnlyUI) selectedJourneys.clear();
  else selected.clear();
  refreshUI();
}

/* Re-render just the dynamic parts without rebuilding the whole DOM */
function refreshUI(){
  allGroups.forEach(group=>{
    const total=group.testCases.length;
    const selCnt=group.testCases.filter(tc=>selected.has(tc.name)).length;
    const agentCnt=group.testCases.filter(tc=>tc.specType==='agent').length;
    const jSel=selectedJourneys.has(group.id);

    /* Update group badge */
    const grpEl=document.getElementById('grp-'+group.id);
    if(!grpEl) return;
    grpEl.classList.toggle('journey-selected',journeyOnlyUI&&jSel);
    const badge=grpEl.querySelector('.grp-badge');
    if(badge){
      if(journeyOnlyUI) badge.textContent=String(agentCnt);
      else badge.textContent=`${selCnt} / ${total}`;
      badge.className='grp-badge'+(journeyOnlyUI||selCnt===0?' zero':'');
    }

    /* Update group checkbox */
    const chk=grpEl.querySelector('[data-grpchk]');
    if(chk){
      const full=journeyOnlyUI?jSel:(selCnt===total&&total>0);
      const part=!journeyOnlyUI&&selCnt>0&&!full;
      chk.className='grp-chk '+(full?'full':part?'part':'');
      chk.innerHTML=full
        ?`<svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="1.5,5 4,7.5 8.5,2"/></svg>`
        :`<svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="2" y1="5" x2="8" y2="5"/></svg>`;
    }

    /* Update individual rows */
    grpEl.querySelectorAll('.tc-row').forEach(row=>{
      const isSel=selected.has(row.dataset.tc);
      row.classList.toggle('sel',isSel);
      /* Update star button state */
      const starBtn=row.querySelector('.tc-star');
      if(starBtn){
        const isStarred=starred.has(row.dataset.tc);
        starBtn.classList.toggle('starred',isStarred);
        starBtn.title=isStarred?'Unstar this flow':'Star this flow';
        const svgEl=starBtn.querySelector('svg');
        if(svgEl) svgEl.setAttribute('fill',isStarred?'currentColor':'none');
      }
    });
  });
  updateBtn();
}

/* Search / filter */
function filterSearch(){
  const q=document.getElementById('searchInput').value.toLowerCase().trim();
  allGroups.forEach(group=>{
    const grpEl=document.getElementById('grp-'+group.id);
    if(!grpEl) return;
    if(journeyOnlyUI){
      const match=!q||group.name.toLowerCase().includes(q)||group.id.toLowerCase().includes(q);
      grpEl.style.display=match?'':'none';
      return;
    }
    let anyVisible=false;
    grpEl.querySelectorAll('.tc-row').forEach(row=>{
      const name=(row.dataset.tc||'').toLowerCase();
      const hide=!!q&&!name.includes(q);
      row.classList.toggle('hidden',hide);
      if(!hide) anyVisible=true;
    });
    if(q && anyVisible) grpEl.classList.add('open');
    grpEl.style.display=(q && !anyVisible)?'none':'';
  });
}

function findTestCaseByName(name){
  for(const g of allGroups){
    const tc=g.testCases.find(t=>t.name===name);
    if(tc) return tc;
  }
  return null;
}

function selectedAgentFlowNames(){
  return [...selected].filter(n=>{
    const tc=findTestCaseByName(n);
    return tc&&tc.specType==='agent';
  });
}

function selectedJourneyIds(){
  return [...selectedJourneys].filter(id=>{
    const g=allGroups.find(x=>x.id===id);
    return g&&g.testCases.some(tc=>tc.specType==='agent');
  });
}

function runSelectedJourneys(mode = 'agent'){
  if(running) return;
  const ids=selectedJourneyIds();
  if(!ids.length){ toast('Tick at least one journey','er'); return; }
  const names=ids.map(id=>{ const g=allGroups.find(x=>x.id===id); return g?g.name:id; });
  const effort=getAgentEffortPct();
  if(mode === 'manual') {
    log(`📋  Manual batch — ${ids.length} journey${ids.length>1?'s':''}`,'head');
    names.forEach(n=>log(`   · ${n}`,'info'));
    log('   Uses spec testdata and scripted steps (LLM phrasing off).','info');
    log('─'.repeat(58),'dull');
    startRun({ groupIds: ids, runMode:'agent', agentOnly:true, manualRun:true, agentEffort:100 });
  } else {
    log(`🤖  Agentic batch — ${ids.length} journey${ids.length>1?'s':''} @ ${effort}%`,'head');
    names.forEach(n=>log(`   · ${n}`,'info'));
    log('   One combined report (HTML + Excel) when the suite finishes.','info');
    log('─'.repeat(58),'dull');
    startRun({ groupIds: ids, runMode:'agent', agentOnly:true, agentEffort:effort });
  }
}

function closeAllManualPopovers(){
  document.querySelectorAll('.grp-manual-pop.open').forEach(el=>el.classList.remove('open'));
}

function toggleManualPopover(groupId){
  if(!groupId) return;
  const pop=document.getElementById('manual-pop-'+groupId);
  if(!pop) return;
  const willOpen=!pop.classList.contains('open');
  closeAllManualPopovers();
  if(willOpen){
    pop.classList.add('open');
    if(typeof lucide!=='undefined') lucide.createIcons({el:pop});
  }
}

document.addEventListener('click',(e)=>{
  if(!e.target.closest('.grp-manual-wrap')) closeAllManualPopovers();
});

function runGroupManual(groupId){
  if(running||!groupId) return;
  const group=allGroups.find(g=>g.id===groupId);
  const agentCnt=group?group.testCases.filter(tc=>tc.specType==='agent').length:0;
  if(!agentCnt){ toast('No test cases in this journey — add JSON via Manual ▾','er'); return; }
  log(`📋  Manual: ${group.name} — all ${agentCnt} saved test case(s)`,'head');
  log('   Uses spec testdata and scripted steps (LLM phrasing off).','info');
  if(group.requiresDbDelete) log('   DB journey — clear DB before each scenario.','info');
  log('─'.repeat(58),'dull');
  startRun({ groupId, runMode:'agent', agentOnly:true, manualRun:true, agentEffort:100 });
}

function runGroupAgentic(groupId){
  if(running||!groupId) return;
  const group=allGroups.find(g=>g.id===groupId);
  const agentCnt=group?group.testCases.filter(tc=>tc.specType==='agent').length:0;
  if(!agentCnt){ toast('No agent specs in this journey','er'); return; }
  const effort=getAgentEffortPct();
  log(`🤖  Agentic: ${group.name} @ ${effort}% effort`,'head');
  if(group.requiresDbDelete){
    log(`   DB journey — all ${agentCnt} scenario(s); clear DB before each.`,'info');
  }else{
    log(`   LLM plans each step; effort controls retries and eval depth.`,'info');
  }
  log('─'.repeat(58),'dull');
  startRun({ groupId, runMode:'agent', agentOnly:true, agentEffort:effort });
}

function runSelectedAgentic(){
  if(running) return;
  if(!selectedAgentFlowNames().length){ toast('Select at least one 🤖 agent test case','er'); return; }
  startRun({ runMode:'agent', agentOnly:true });
}

/* Update run button + header stats */
function updateBtn(){
  const n=journeyOnlyUI?selectedJourneys.size:selected.size;
  const lbl=document.getElementById('rzlbl');
  const badge=document.getElementById('rzbadge');
  if(lbl){
    lbl.textContent=journeyOnlyUI
      ?(n?`${n} journey${n>1?'s':''} selected — Run selected`:'Tick journeys, then Run selected')
      :(n?`${n} spec(s) selected`:'Select test cases');
  }
  if(badge){ badge.textContent=String(n); badge.classList.toggle('zero',n===0); }
  const rselAgent=document.getElementById('rselAgent');
  const rselManual=document.getElementById('rselManual');
  if(rselAgent) rselAgent.disabled=running||!selectedJourneyIds().length;
  if(rselManual) rselManual.disabled=running||!selectedJourneyIds().length;
  const mega=document.getElementById('rmega');
  const ckpt=document.getElementById('rckpt');
  if(mega) mega.disabled=running;
  if(ckpt) ckpt.disabled=running;
}

function runFullSuite(){
  if(running) return;
  selectAll();
  updateBtn();
  startRun({ runAll: true, runMode: 'script' });
}

function populateMegaGroupSelect(){
  const sel=document.getElementById('megaGroupSel');
  if(!sel) return;
  const rows=allGroups
    .map(g=>({ id:g.id, name:g.name, n:g.testCases.filter(tc=>tc.specType==='agent').length, requiresDbDelete:!!g.requiresDbDelete }))
    .filter(g=>g.n>0);
  sel.innerHTML=rows.map(g=>`<option value="${esc(g.id)}">${esc(g.name)}${g.requiresDbDelete?' [DB]':''} (${g.n} scenarios)</option>`).join('');
  if(!rows.length) sel.innerHTML='<option value="">No agent journeys</option>';
}

function openMegaModal(){
  populateMegaGroupSelect();
  const ov=document.getElementById('megaModalOverlay');
  if(ov) ov.style.display='flex';
}

function closeMegaModal(){
  const ov=document.getElementById('megaModalOverlay');
  if(ov) ov.style.display='none';
}

function confirmMegaRun(mode){
  closeMegaModal();
  if(running) return;
  if(mode==='all'){
    log('🤖  Agent suite — ALL journeys (LLM-driven).','head');
    log('   Tip: stop mid-run → Resume agent suite continues later.','info');
    log('─'.repeat(58),'dull');
    const me=document.getElementById('megaEffortSel');
    if(me) document.getElementById('agentEffortSel').value=me.value;
    startRun({ runAll: true, runMode: 'agent', agentSuite: true, agentEffort: getAgentEffortPct() });
    return;
  }
  const sel=document.getElementById('megaGroupSel');
  const groupId=sel&&sel.value?sel.value:'';
  if(!groupId){ toast('Pick a journey','er'); return; }
  const g=allGroups.find(x=>x.id===groupId);
  const me=document.getElementById('megaEffortSel');
  if(me) document.getElementById('agentEffortSel').value=me.value;
  log(`🤖  Agent suite — journey: ${g?g.name:groupId} @ ${getAgentEffortPct()}%`,'head');
  log('─'.repeat(58),'dull');
  startRun({ groupId, runMode: 'agent', agentOnly: true, agentEffort: getAgentEffortPct() });
}

function runMegaAgentSuite(){
  if(running) return;
  openMegaModal();
}

async function refreshAgentCheckpointUI(){
  const rck=document.getElementById('rckpt');
  const lbl=document.getElementById('rckptLbl');
  if(!rck||!lbl) return;
  try{
    const r=await fetch('/api/suite/agent-checkpoint');
    const j=await r.json();
    if(!j.ok||!j.eligible){
      rck.disabled=true;
      lbl.textContent='Resume agent suite (no checkpoint)';
      rck.title='Run the mega agent suite once; after an interrupted run, a checkpoint file appears and this button activates.';
      if(typeof lucide!=='undefined') lucide.createIcons({el:rck});
      return;
    }
    rck.disabled=!!running;
    const ph=j.phase==='deferred'?'deferred':'primary';
    const pos= ph==='primary'&&j.primaryTotal
      ? ` · ${j.primaryNextHuman}/${j.primaryTotal}`
      : (j.phase==='deferred'&&j.deferredTotal?` · def ${j.deferredNextHuman}/${j.deferredTotal}`:'');
    lbl.textContent=`Resume · ${j.nextSnippet||'next'}${pos}`;
    rck.title=`${j.label||'Agent suite'} — phase: ${ph}. Continues from disk (.hr-suite-checkpoint-agent.json). Updated: ${j.updatedAt||'?'}`;
  }catch{
    rck.disabled=true;
    lbl.textContent='Resume agent suite (?)';
  }
  if(typeof lucide!=='undefined') lucide.createIcons({el:rck});
}

async function resumeInterruptedAgentSuite(){
  if(running) return;
  try{
    const ck=await fetch('/api/suite/agent-checkpoint').then(r=>r.json());
    if(!ck.eligible){
      toast('No saved agent checkpoint — run the mega suite first, or it was already cleared.','er');
      return;
    }
  }catch(e){
    toast('Could not read checkpoint: '+(e.message||e),'er');
    return;
  }
  await refreshChromeStatus();
  if(!chromeReady){
    log('❌ Chrome CDP offline — click Prepare Chrome (Parallel on = keep your Chrome open). Open HR Chat in the automation window; wait for green CDP.','fail');
    toast('Prepare automation Chrome first (Parallel mode).','er');
    return;
  }
  log('📂  Resuming agent suite from saved checkpoint (same spec order as the interrupted run).','head');
  log('─'.repeat(58),'dull');
  startRun({ resumeAgentSuite: true, runMode: 'agent' });
}

function hideReportPreview(){
  const slot=document.getElementById('reportSlot');
  const frame=document.getElementById('reportFrame');
  if(slot) slot.classList.remove('on');
  if(frame) frame.src='about:blank';
}

function showReportPreview(htmlFile, fullHtmlFile){
  const slot=document.getElementById('reportSlot');
  const frame=document.getElementById('reportFrame');
  if(!slot||!frame) return;
  if(!htmlFile && !fullHtmlFile){ hideReportPreview(); return; }
  let src=fullHtmlFile;
  if(!src && htmlFile) src=htmlFile.replace(/^test-report-/,'test-report-full-');
  if(!src) src=htmlFile;
  frame.src='/api/report-view/'+encodeURIComponent(src)+'?t='+Date.now();
  slot.classList.add('on');
  if(typeof lucide!=='undefined') lucide.createIcons({el:slot});
}

/* ── Run ── */
async function startRun(opts){
  const resumeAgentSuite = !!(opts && opts.resumeAgentSuite);
  const runAll = !!(opts && opts.runAll);
  const groupId = opts && opts.groupId ? String(opts.groupId).trim() : '';
  const groupIds = opts && Array.isArray(opts.groupIds) ? opts.groupIds.map(g=>String(g).trim()).filter(Boolean) : [];
  const agentOnly = !!(opts && opts.agentOnly);
  const manualRun = !!(opts && opts.manualRun);
  if(running)return;
  if(!resumeAgentSuite && !runAll && !groupId && !groupIds.length && !selected.size)return;
  await refreshChromeStatus();
  if(!chromeReady){
    log('❌ Chrome CDP offline — Prepare Chrome with Parallel checked, open HR Chat in the automation window, green CDP badge, then retry.','fail');
    toast('Prepare automation Chrome (Parallel) — Chat goes in that window.','er');
    return;
  }
  running=true;clearTerm(true);clearRunnerHud();setRunState(true);
  hideReportPreview();
  document.getElementById('sumbar').classList.remove('on');
  document.getElementById('dlbtn').style.display='none';
  const dpdf=document.getElementById('dlbtnPdf'); if(dpdf) dpdf.style.display='none';
  const dxls=document.getElementById('dlbtnXlsx'); if(dxls) dxls.style.display='none';
  document.getElementById('livetag').classList.add('on');

  const forcedMode = opts && opts.runMode ? opts.runMode : null; // explicit: 🤖 mega → 'agent'; 📜 full suite → 'script'
  if(resumeAgentSuite){
    log('▶  Resuming interrupted agent suite from disk checkpoint.', 'head');
  }else if(runAll){
    const modeLabel =
      forcedMode==='agent'
        ? '🤖 Agent runner — ALL JSON specs in agent-flows/ (LLM drives each scenario; not markdown scripts)'
        : forcedMode==='script'
          ? '📜 Script runner — ALL markdown flows in happy-flows/ (turn-by-turn scripts)'
          : 'Full suite (runMode auto — mixed selection behaviour)';
    log('▶  Starting full suite — '+modeLabel, 'head');
  }else if(groupIds.length){
    log(`▶  Agentic batch: ${groupIds.length} journeys (combined report)`, 'head');
    groupIds.forEach(id=>{
      const g=allGroups.find(x=>x.id===id);
      log(`   · ${g?g.name:id}`, 'info');
    });
  }else if(groupId){
    const g=allGroups.find(x=>x.id===groupId);
    log(manualRun
      ? `▶  Manual journey: ${g?g.name:groupId} (all saved test cases)`
      : `▶  Agentic journey: ${g?g.name:groupId} (LLM evaluates each bot reply)`, 'head');
  }else{
    const flows=agentOnly?selectedAgentFlowNames():[...selected];
    log(`▶  Starting ${flows.length} agentic test case${flows.length>1?'s':''}`, 'head');
    flows.forEach(f=>log(`   · ${f}`,'info'));
  }
  log('─'.repeat(58),'dull');

  try{
    let payload;
    if(resumeAgentSuite){
      payload={ resumeAgentSuite: true, runMode: 'agent' };
    }else if(groupIds.length){
      payload={ groupIds, runMode: 'agent', agentOnly: true, agentEffort: getAgentEffortPct() };
    }else if(groupId){
      payload={
        groupId,
        runMode: 'agent',
        agentOnly: true,
        manualRun,
        agentEffort: manualRun ? 100 : getAgentEffortPct(),
      };
    }else{
      const selArr=agentOnly?selectedAgentFlowNames():[...selected];
      const allAgent=selArr.length>0&&selArr.every(n=>{
        const tc=findTestCaseByName(n);
        return tc&&tc.specType==='agent';
      });
      const resolvedMode = forcedMode || (agentOnly || allAgent ? 'agent' : 'auto');
      payload =
        runAll
          ? { runAll: true, runMode: resolvedMode, agentSuite: resolvedMode === 'agent', scriptSuite: resolvedMode === 'script', agentEffort: getAgentEffortPct() }
          : { flows: selArr, runMode: resolvedMode, agentOnly: !!agentOnly };
    }

    const r=await fetch('/api/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const {runId,error}=await r.json();
    currentRunId=runId;
    if(error) throw new Error(error);
    document.getElementById('progf').classList.add('go');
    runStreamReconnectAttempts=0;
    runStreamCounters={passed:0,partial:0,failed:0,skipped:0,automation:0};
    attachRunStream(runId);
  }catch(err){log(`❌ ${err.message}`,'fail');finishRun(0,0,0,0,null,null,null,1,0);toast(err.message,'er');}
}

function processRunStreamEvent(d, runId){
  const c=runStreamCounters;
  if(d.type==='log'){
    const cls=classify(d.text);log(d.text,cls);
    const line=d.text||'';
    if(/\bSPEC\s+PASSED\b/i.test(line)||/\bFLOW\s+PASSED\b/i.test(line)) c.passed++;
    else if(/\bSPEC\s+NOT SCORED\b/i.test(line)) c.automation++;
    else if(/\bSPEC\s+PARTIAL\b/i.test(line)) c.partial++;
    else if(/\bSPEC\s+FAILED\b/i.test(line)||/\bFLOW\s+FAILED\b/i.test(line)) c.failed++;
    if(/⚠️/.test(line)&&/[Ss]kipped|[Ss]kipping/.test(line)) c.skipped++;
  }else if(d.type==='paused'){
    setPauseControlsState('paused');
    toast('Suite paused — do your manual steps, then click Resume','ok');
  }else if(d.type==='resumed'){
    setPauseControlsState('running');
  }else if(d.type==='db_delete_wait'){
    showDbGateModal(d);
  }else if(d.type==='runner_ui'){
    applyRunnerUiPayload(d.payload);
  }else if(d.type==='report_ready'){
    lastRunReport.jsonFile=d.jsonFile||lastRunReport.jsonFile;
    lastRunReport.htmlFile=d.htmlFile||lastRunReport.htmlFile;
    lastRunReport.fullHtmlFile=d.fullHtmlFile||lastRunReport.fullHtmlFile;
    lastRunReport.failedSpecs=Array.isArray(d.failedSpecs)?d.failedSpecs:[];
    lastRunReport.failedCount=d.retryCount!=null?d.retryCount:lastRunReport.failedSpecs.length;
    if(d.htmlFile||d.fullHtmlFile){
      const prev=document.getElementById('repViewMode');
      if(prev&&!prev.dataset.userPicked) prev.value='full';
    }
  }else if(d.type==='done'){
    if(runEventSource){try{runEventSource.close();}catch(_){} runEventSource=null;}
    if(d.jsonFile) lastRunReport.jsonFile=d.jsonFile;
    if(d.reportFile) lastRunReport.htmlFile=d.reportFile;
    if(d.fullHtmlFile) lastRunReport.fullHtmlFile=d.fullHtmlFile;
  if(d.failedSpecs) lastRunReport.failedSpecs=d.failedSpecs;
  if(d.retryCount!=null) lastRunReport.failedCount=d.retryCount;
    finishRun(
      d.passed!=null?d.passed:c.passed,
      d.partial!=null?d.partial:c.partial,
      d.failed!=null?d.failed:c.failed,
      c.skipped,
      d.reportFile||lastRunReport.htmlFile,d.pdfFile,d.excelFile,d.code,
      d.automation!=null?d.automation:c.automation,
      d.fullHtmlFile||lastRunReport.fullHtmlFile,
      d.jsonFile||lastRunReport.jsonFile
    );
    maybeOfferRetryAfterRun();
  }
}

function attachRunStream(runId){
  if(runEventSource){try{runEventSource.close();}catch(_){}}
  runEventSource=new EventSource(`/api/stream/${runId}`);
  runEventSource.onmessage=e=>{
    runStreamReconnectAttempts=0;
    try{ processRunStreamEvent(JSON.parse(e.data), runId); }catch(_){}
  };
  runEventSource.onerror=async()=>{
    if(runEventSource){try{runEventSource.close();}catch(_){}}
    runEventSource=null;
    if(!running||currentRunId!==runId) return;
    try{
      const st=await fetch(`/api/run-status/${runId}`);
      if(st.ok){
        const status=await st.json();
        if(status.done){
          finishRun(
            runStreamCounters.passed,
            runStreamCounters.partial,
            runStreamCounters.failed,
            runStreamCounters.skipped,
            status.reportFile,
            status.pdfFile,
            status.excelFile,
            0,
            runStreamCounters.automation,
            status.fullHtmlFile,
            status.reportJsonFile||lastRunReport.jsonFile
          );
          maybeOfferRetryAfterRun();
          return;
        }
      }
    }catch(_){}
    runStreamReconnectAttempts++;
    if(runStreamReconnectAttempts>RUN_SSE_MAX_RECONNECT){
      finishRun(0,0,0,0,null,null,null,1,0);
      toast('Connection lost — runner may still be active; check terminal or Reports tab','er');
      return;
    }
    log('↻ Reconnecting to run log (tab or network blip)…','warn');
    setTimeout(()=>{
      if(running&&currentRunId===runId&&!runEventSource) attachRunStream(runId);
    },1500);
  };
}

document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState!=='visible') return;
  if(running&&currentRunId&&!runEventSource) attachRunStream(currentRunId);
});

async function stopRun(){
  if(!running||!currentRunId) return;
  try{
    await fetch(`/api/stop/${currentRunId}`,{method:'POST'});
    log('⛔  Stop requested…','warn');
  }catch(e){
    toast('Stop failed: '+e.message,'er');
  }
}

async function pauseRun(){
  if(!running||!currentRunId)return;
  try{
    const r=await fetch(`/api/pause/${currentRunId}`,{method:'POST'});
    const d=await r.json();
    if(d.success||d.already){
      setPauseControlsState('paused');
      log('⏸️  Pause requested — will pause after the current spec/flow completes.','warn');
      toast('Pausing after current spec…','ok');
    }
  }catch(e){toast('Pause failed: '+e.message,'er');}
}

async function resumeRun(){
  if(!currentRunId)return;
  try{
    const r=await fetch(`/api/resume/${currentRunId}`,{method:'POST'});
    const d=await r.json();
    if(d.success||d.already){
      setPauseControlsState('running');
      log('▶️  Resumed — suite continuing…','pass');
      toast('Suite resumed!','ok');
    }
  }catch(e){toast('Resume failed: '+e.message,'er');}
}

/** Structured progress from runnerAgent.js (spec #, phase #, LLM busy, bot wait). */
let runnerHudState=null;

function applyRunnerUiPayload(p){
  if(!p||p.v!==1)return;
  runnerHudState=runnerHudState||{
    suiteTotal:null,suiteIndex:null,specName:null,groupName:null,
    phaseIndex:null,phaseTotal:null,phaseId:null,
    turnNumber:null,hint:null,
    llmBusy:false,llmPhase:null,lastLlmMs:null,
    waitBot:false,executing:false,
  };
  const S=runnerHudState;

  if(p.kind==='suite'&&p.step==='start'){
    S.suiteTotal=p.total;
  }
  if(p.kind==='suite'&&p.step==='done'){
    clearRunnerHud();
    return;
  }
  if(p.kind==='spec'&&p.step==='start'){
    S.suiteIndex=p.suiteIndex;
    S.suiteTotal=p.suiteTotal;
    S.specName=p.specName||'';
    S.groupName=p.groupName||'';
    S.turnNumber=null;
    S.hint='';
    S.phaseIndex=null;
    S.phaseTotal=null;
    S.phaseId='';
  }
  if(p.kind==='phase'&&p.step==='start'){
    S.phaseIndex=p.phaseIndex;
    S.phaseTotal=p.phaseTotal;
    S.phaseId=p.phaseId||'';
    S.turnNumber=null;
    S.hint='';
  }
  if(p.kind==='turn'){
    if(typeof p.turnNumber==='number')S.turnNumber=p.turnNumber;
    S.hint=p.hint||'';
  }
  if(p.kind==='llm'){
    if(typeof p.busy==='boolean')S.llmBusy=p.busy;
    if(p.phase)S.llmPhase=p.phase;
    if(typeof p.ms==='number')S.lastLlmMs=p.ms;
  }
  if(p.kind==='step'){
    if(p.phase==='waiting_bot')S.waitBot=!!p.busy;
    if(p.phase==='execute')S.executing=!!p.busy;
  }
  renderRunnerHud();
}

function renderRunnerHud(){
  const box=document.getElementById('runHud');
  const S=runnerHudState;
  if(!box||!S)return;
  const hasAnchor=S.suiteTotal!=null||S.phaseTotal!=null;
  if(!hasAnchor){
    box.classList.remove('on');
    return;
  }
  box.classList.add('on');

  const specEl=document.getElementById('rhSpec');
  const phaseEl=document.getElementById('rhPhase');
  const turnEl=document.getElementById('rhTurn');
  const llmEl=document.getElementById('rhLlm');
  const botEl=document.getElementById('rhBot');
  const exEl=document.getElementById('rhExec');

  let specTxt='Spec —';
  if(S.suiteTotal){
    if(S.suiteIndex!=null){
      specTxt=`Spec ${S.suiteIndex}/${S.suiteTotal}`;
      if(S.specName){
        const sn=S.specName.length>44?S.specName.slice(0,41)+'…':S.specName;
        specTxt+=` · ${sn}`;
      }
    }else{
      specTxt=`Suite · ${S.suiteTotal} specs`;
    }
  }
  specEl.textContent=specTxt;
  specEl.title=S.specName?(S.groupName?`${S.groupName}\n`:'')+S.specName:'';

  let phTxt='Phase —';
  if(S.phaseTotal){
    phTxt=`Phase ${S.phaseIndex!=null?S.phaseIndex:'—'}/${S.phaseTotal}`;
    if(S.phaseId)phTxt+=` · ${S.phaseId}`;
  }
  phaseEl.textContent=phTxt;

  turnEl.style.display='block';
  if(S.turnNumber!=null&&(S.hint||S.phaseId)){
    turnEl.textContent=`Turn ${S.turnNumber}: ${S.hint||''}`;
  }else if(S.turnNumber!=null){
    turnEl.textContent=`Turn ${S.turnNumber}`;
  }else{
    turnEl.textContent='';
    turnEl.style.display='none';
  }

  llmEl.classList.toggle('busy',!!S.llmBusy);
  const lbl=llmEl.querySelector('.rh-llm-lbl');
  if(lbl){
    lbl.textContent=S.llmBusy
      ? (S.llmPhase==='evaluate'?'LLM · CHECK':'LLM · PLAN')
      : (S.lastLlmMs!=null?`LLM · ${S.lastLlmMs}ms`:'LLM · idle');
  }

  botEl.style.display=S.waitBot?'inline-flex':'none';
  botEl.classList.toggle('busy',!!S.waitBot);

  exEl.style.display=S.executing?'inline-flex':'none';
  exEl.classList.toggle('busy',!!S.executing);
}

function clearRunnerHud(){
  runnerHudState=null;
  const box=document.getElementById('runHud');
  if(!box)return;
  box.classList.remove('on');
  const turnEl=document.getElementById('rhTurn');
  if(turnEl){turnEl.textContent='';turnEl.style.display='none';}
  const llm=document.getElementById('rhLlm');
  if(llm){
    llm.classList.remove('busy');
    const lb=llm.querySelector('.rh-llm-lbl');
    if(lb)lb.textContent='LLM';
  }
  const b=document.getElementById('rhBot');
  if(b){b.style.display='none';b.classList.remove('busy');}
  const x=document.getElementById('rhExec');
  if(x){x.style.display='none';x.classList.remove('busy');}
}

/** Sync sidebar + terminal Pause / Resume / Stop. state: idle | running | paused */
function setPauseControlsState(state){
  const pb=document.getElementById('pausebtn');
  const rb=document.getElementById('resumebtn');
  const sb=document.getElementById('stopbtn');
  const pT=document.getElementById('pausebtnT');
  const rT=document.getElementById('resumebtnT');
  const sT=document.getElementById('stopbtnT');
  const bar=document.getElementById('tbarRunCtl');
  const banner=document.getElementById('pausedBanner');
  const livetag=document.getElementById('livetag');
  const active=state==='running'||state==='paused';
  if(sb) sb.classList.toggle('on',active);
  if(pb) pb.classList.toggle('on',state==='running');
  if(rb) rb.classList.toggle('on',state==='paused');
  if(bar) bar.classList.toggle('vis',active);
  if(pT) pT.classList.toggle('on',state==='running');
  if(rT) rT.classList.toggle('on',state==='paused');
  if(sT) sT.classList.toggle('on',active);
  if(banner) banner.classList.toggle('on',state==='paused');
  if(livetag&&active){
    if(state==='paused') livetag.textContent='⏸ PAUSED';
    else if(running) livetag.textContent='● LIVE';
  }
  if(active&&bar&&typeof lucide!=='undefined') lucide.createIcons({el:bar});
}

function mirrorRunControlsToTerminal(){
  const rb=document.getElementById('resumebtn');
  const rT=document.getElementById('resumebtnT');
  const paused=(rb&&rb.classList.contains('on'))||(rT&&rT.classList.contains('on'));
  setPauseControlsState(!running?'idle':paused?'paused':'running');
}

function closeRetryFailedModal(){
  const el=document.getElementById('retryFailedOverlay');
  if(el) el.style.display='none';
}
function maybeOfferRetryAfterRun(){
  const n=lastRunReport.failedCount||(lastRunReport.failedSpecs||[]).length;
  if(!lastRunReport.jsonFile||!n) return;
  const list=document.getElementById('retryFailedList');
  const hint=document.getElementById('retryFailedHint');
  if(hint){
    hint.innerHTML=`${n} scenario${n===1?'':'s'} did not fully pass. Re-run them now and merge into <strong>${esc(lastRunReport.jsonFile)}</strong> (same HTML &amp; Excel files, updated in place).`;
  }
  if(list){
    const names=(lastRunReport.failedSpecs||[]).slice(0,12).map(s=>`<li>${esc(s.name||'—')} <span style="color:var(--t3)">(${esc(s.outcome||'')})</span></li>`).join('');
    list.innerHTML=names+(lastRunReport.failedSpecs.length>12?`<li>…and ${lastRunReport.failedSpecs.length-12} more</li>`:'');
  }
  document.getElementById('retryFailedOverlay').style.display='flex';
}
async function retryHistoryRun(jsonFile,ev){
  if(ev) ev.stopPropagation();
  if(running){ toast('A run is already in progress','er'); return; }
  if(!jsonFile){ toast('No results file for this run','er'); return; }
  const ok=confirm(
    'Re-run only failed and partial scenarios for this saved run?\n\n'+
    'The same report files (HTML, Excel, JSON) will be updated in place.'
  );
  if(!ok) return;
  switchTab('run');
  await startRetryFailedSpecs(jsonFile);
}

async function startRetryFailedSpecs(jsonFileOverride){
  const jsonFile=jsonFileOverride||lastRunReport.jsonFile;
  if(!jsonFile){ toast('No report JSON for this run','er'); return; }
  lastRunReport.jsonFile=jsonFile;
  closeRetryFailedModal();
  await refreshChromeStatus();
  if(!chromeReady){
    toast('Prepare Chrome before retry','er');
    return;
  }
  running=true;clearRunnerHud();setRunState(true);
  log(`🔁  Re-running failed/partial specs — updating ${jsonFile}`,'head');
  try{
    const r=await fetch('/api/retry-failed-specs',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ jsonFile, agentEffort: getAgentEffortPct() }),
    });
    const data=await r.json();
    if(data.error) throw new Error(data.error);
    currentRunId=data.runId;
    attachRunStream(data.runId);
    toast('Retry pass started','ok');
  }catch(e){
    running=false;setRunState(false);
    toast('Retry failed: '+e.message,'er');
  }
}

function finishRun(passed,partial,failed,skipped,reportFile,pdfFile,excelFile,code,automation,fullHtmlFile,jsonFile){
  if(runEventSource){try{runEventSource.close();}catch(_){} runEventSource=null;}
  runStreamReconnectAttempts=0;
  running=false;currentRunId=null;hideDbGateModal();clearRunnerHud();setRunState(false);
  const pf=document.getElementById('progf');
  pf.classList.remove('go');pf.style.width='100%';
  setTimeout(()=>{pf.style.width='0%';},900);
  document.getElementById('livetag').classList.remove('on');
  document.getElementById('spass').textContent=passed;
  const sp=document.getElementById('spartial');
  if(sp) sp.textContent=partial;
  document.getElementById('sfail').textContent=failed;
  document.getElementById('sskip').textContent=skipped;
  const autoEl=document.getElementById('sauto');
  const autoWrap=document.getElementById('sautoWrap');
  const autoN=automation|0;
  if(autoEl) autoEl.textContent=autoN;
  if(autoWrap) autoWrap.style.display=autoN>0?'flex':'none';
  document.getElementById('sumbar').classList.add('on');
  const b=document.getElementById('dlbtn');
  const dlHtml=fullHtmlFile||reportFile;
  if(dlHtml){b.href=`/api/reports/${encodeURIComponent(dlHtml)}`;b.style.display='inline-flex';}
  else{b.style.display='none';}
  const bp=document.getElementById('dlbtnPdf');
  if(bp){
    if(pdfFile){bp.href=`/api/reports/${pdfFile}`;bp.style.display='inline-flex';}
    else{bp.style.display='none';}
  }
  const bx=document.getElementById('dlbtnXlsx');
  if(bx){
    if(excelFile){bx.href=`/api/reports/${excelFile}`;bx.style.display='inline-flex';}
    else{bx.style.display='none';}
  }
  if(typeof lucide!=='undefined') lucide.createIcons({el:document.getElementById('sumbar')});
  if(jsonFile) lastRunReport.jsonFile=jsonFile;
  if(reportFile) lastRunReport.htmlFile=reportFile;
  if(fullHtmlFile) lastRunReport.fullHtmlFile=fullHtmlFile;
  lastRunReport.failedCount=(partial|0)+(failed|0);

  if(reportFile||fullHtmlFile){
    showReportPreview(reportFile,fullHtmlFile);
    log(fullHtmlFile?'📄  Full suite report (all passed + issues).':'📄  HTML report preview loaded below.','head');
  } else {
    hideReportPreview();
  }
  if(lastRunReport.jsonFile){
    loadReportsList().catch(()=>{});
    loadHistory().catch(()=>{});
  }
  log('─'.repeat(58),'dull');
  if(code===143) log('⚠️  Run stopped — report includes flows that finished before stop.','warn');
  if(code===0) log('✅  All test cases completed successfully.','pass');
  else log(code===143?'⚠️  Run ended after stop request.':'⚠️  Finished with exit code '+code+'.','warn');

  const hasReport=!!reportFile;
  let toastMsg='Finished with issues';
  if(code===0) toastMsg='Run complete!';
  else if(code===143) toastMsg='Stopped — report shown if available.';
  else if(hasReport){const folder=(UI_CONFIG&&UI_CONFIG.reportFolderName)?UI_CONFIG.reportFolderName:'reports';toastMsg='Run had errors — PDF & HTML are in folder “'+folder+'” (sidebar + History · hover for path).';} 
  toast(toastMsg,code===0?'ok':(code===143||hasReport)?'ok':'er');
  setTimeout(loadHistory,1500);
  refreshAgentCheckpointUI();
}

function setRunState(on){
  const rb=document.getElementById('rbtn');
  const rba=document.getElementById('rbtnAgent');
  const rfull=document.getElementById('rfull');
  const rmega=document.getElementById('rmega');
  if(rb){ rb.classList.toggle('running',on); rb.disabled=on; }
  if(rba){ rba.disabled=on; rba.classList.toggle('running',on); }
  if(rfull){ rfull.disabled=on; rfull.classList.toggle('running',on); }
  document.querySelectorAll('.grp-run-agent').forEach(b=>{ if(on) b.disabled=true; });
  if(rmega){ rmega.disabled=on; rmega.classList.toggle('running',on); }
  const rselAgent=document.getElementById('rselAgent');
  const rselManual=document.getElementById('rselManual');
  if(rselAgent){ rselAgent.disabled=on||!selectedJourneyIds().length; if(on) rselAgent.classList.add('running'); else rselAgent.classList.remove('running'); }
  if(rselManual){ rselManual.disabled=on||!selectedJourneyIds().length; if(on) rselManual.classList.add('running'); else rselManual.classList.remove('running'); }
  const rckpt=document.getElementById('rckpt');
  if(rckpt){
    if(on) rckpt.disabled=true;
    else refreshAgentCheckpointUI();
  }
  setPauseControlsState(on?'running':'idle');
  if(on){
    if(rmega) rmega.classList.add('running');
    document.getElementById('livetag').classList.add('on');
  }else{
    if(rmega) rmega.classList.remove('running');
    document.getElementById('livetag').classList.remove('on');
    updateBtn();
    refreshAgentCheckpointUI();
  }
}

/* ── Terminal ── */
function classify(line){
  if(/✅/.test(line)) return 'pass';if(/❌/.test(line)) return 'fail';if(/⚠️/.test(line)) return 'warn';
  if(/^\s*→/.test(line)) return 'send';if(/^\s*←/.test(line)) return 'recv';
  if(/═{3,}|─{3,}/.test(line)) return 'dull';
  if(/▶|🔌|⏳|📂|🏁|📊|📄/.test(line)) return 'head';
  if(/\[Turn/.test(line)) return 'head';
  return 'info';
}
function log(text,cls='info'){
  const t=document.getElementById('terminal'),e=document.getElementById('tempty');
  if(e) e.remove();
  const s=document.createElement('span');s.className=`tl ${cls}`;s.textContent=text;
  t.appendChild(s);t.appendChild(document.createTextNode('\n'));t.scrollTop=t.scrollHeight;
}
function clearTerm(keepEmpty=false){
  const t=document.getElementById('terminal');
  t.innerHTML=keepEmpty?'':`<div class="tempty" id="tempty">
    <div class="tempty-ico"><i data-lucide="zap" style="width:44px;height:44px;opacity:.25;color:var(--cy)"></i></div>
    <div class="tempty-txt">Ready to run tests</div>
    <div class="tempty-hint">$ select test cases and hit run<span class="tcursor"></span></div>
  </div>`;
  lucide.createIcons({el:t});
}
function scrollBot(){const t=document.getElementById('terminal');t.scrollTop=t.scrollHeight;}

/* ── History ── */
const histDetailCache = new Map(); // jsonFile → detail array

async function loadHistory(){
  try{
    const r=await fetch('/api/reports');const data=await r.json();
    document.getElementById('tcHist').textContent=data.length;
    renderHistory(data);
  }catch{
    document.getElementById('hbody').innerHTML='<div class="hempty"><div class="hempty-ico">⚠️</div><div class="hempty-txt">Failed to load history</div></div>';
  }
}

function renderHistory(reports){
  const el=document.getElementById('hbody');
  if(!reports.length){
    el.innerHTML='<div class="hempty"><div class="hempty-ico"><i data-lucide="folder-open" style="width:48px;height:48px"></i></div><div class="hempty-txt">No history yet — run some test cases first</div></div>';
    lucide.createIcons({el});return;
  }

  el.innerHTML=reports.map((r,idx)=>{
    const outcomeOf=f=>f.reportOutcome||f.outcome||(f.passed?'passed':((f.phasesPassed|0)>0?'partial':'failed'));
    const total=r.flows.length;
    const passed=r.flows.filter(f=>outcomeOf(f)==='passed').length;
    const partial=r.flows.filter(f=>outcomeOf(f)==='partial').length;
    const failed=r.flows.filter(f=>outcomeOf(f)==='failed').length;
    const automation=r.flows.filter(f=>outcomeOf(f)==='automation_error').length;
    const allP=passed===total,allF=failed===total;
    const icoCls=allP?'ap':allF?'af':'sf';
    const iconName=allP?'check-circle-2':allF?'x-circle':'alert-triangle';
    const iconColor=allP?'#00e676':allF?'#ff5252':'#ffb347';
    const date=new Date(r.date).toLocaleString('en-IN',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
    const jsonFile=r.file;

    // Title: first flow name (title-cased) or "N flows"
    const rawName=r.flows[0]?.name||'';
    const title=(total===1
      ? rawName.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())
      : `${total} scenarios`);
    const subtitle=`${passed} passed · ${partial} partial · ${failed} failed${automation?` · ${automation} not scored`:''} · ${date}`;
    const firstFlowName=rawName;
    const retryN=partial+failed;
    const retryBtn=retryN>0?`<button class="hc2-btn retry" title="Re-run ${retryN} failed/partial scenario${retryN===1?'':'s'} — updates this report in place" onclick="retryHistoryRun('${esc(jsonFile)}',event)"><i data-lucide="rotate-ccw"></i></button>`:'';

    return `<div class="hc" id="hc${idx}" data-file="${esc(jsonFile)}" data-firstflow="${esc(firstFlowName)}">
      <div class="hctop2">
        <div class="hc2-left">
          <div class="hc2-icon ${icoCls}">
            <i data-lucide="${iconName}" style="width:17px;height:17px;color:${iconColor}"></i>
          </div>
          <div class="hc2-meta">
            <div class="hc2-title">${esc(title)}</div>
            <div class="hc2-sub">${esc(subtitle)}</div>
          </div>
        </div>
        <div class="hc2-right">
          <span class="hc2-turns">${passed} ok · ${partial} partial · ${failed} fail</span>
          <button class="hc2-btn" title="Preview conversation" onclick="openHistPreview('${esc(jsonFile)}','${esc(firstFlowName)}');event.stopPropagation()">
            <i data-lucide="eye"></i>
          </button>
          ${r.file?`<a class="hc2-btn" href="${r.fullHtmlFile?`/api/reports/${encodeURIComponent(r.fullHtmlFile)}`:`/api/report-export/${encodeURIComponent(r.file)}?mode=full`}" target="_blank" title="Download full suite HTML" onclick="event.stopPropagation()"><i data-lucide="download"></i></a>`:''}
          ${r.excelFile?`<a class="hc2-btn" href="/api/reports/${r.excelFile}" target="_blank" title="Download Excel report" onclick="event.stopPropagation()"><i data-lucide="table-2"></i></a>`:''}
          ${r.pdfFile?`<a class="hc2-btn" href="/api/reports/${r.pdfFile}" target="_blank" title="Download PDF report" onclick="event.stopPropagation()"><i data-lucide="file-text"></i></a>`:''}
          ${retryBtn}
          <button class="hc2-btn del" title="Delete run" onclick="confirmDeleteHistory(${idx},'${esc(jsonFile)}');event.stopPropagation()">
            <i data-lucide="trash-2"></i>
          </button>
          <button class="hc2-chev" title="Expand / collapse" onclick="toggleH(${idx})">
            <i data-lucide="chevron-down"></i>
          </button>
        </div>
      </div>
      <div class="hcbody2" id="hcb-${idx}">
        <div class="hc2-loading">
          <i data-lucide="loader-2" style="width:14px;height:14px;animation:spin 1s linear infinite"></i>
          Loading details…
        </div>
      </div>
    </div>`;
  }).join('');

  lucide.createIcons({el});
}

async function toggleH(idx){
  const card=document.getElementById('hc'+idx);
  if(!card) return;
  const wasOpen=card.classList.contains('open');
  card.classList.toggle('open');
  if(!wasOpen){ await _loadHistDetail(idx, card.dataset.file); }
}

async function _loadHistDetail(idx, file){
  const body=document.getElementById('hcb-'+idx);
  if(!body) return;
  if(histDetailCache.has(file)){ _renderHistBody(idx,histDetailCache.get(file)); return; }
  try{
    const r=await fetch('/api/history/detail/'+encodeURIComponent(file));
    const data=await r.json();
    histDetailCache.set(file,data);
    _renderHistBody(idx,data);
  }catch(e){
    if(body) body.innerHTML=`<div class="hc2-loading" style="color:var(--rd)"><i data-lucide="alert-triangle" style="width:14px;height:14px"></i> Failed to load details</div>`;
    lucide.createIcons({el:body});
  }
}

function formatHistUserMessage(raw, t){
  const s=String(raw||'').trim();
  if(!s||s==='—') return '—';
  const low=s.toLowerCase();
  if(low==='(agent: done)'||low==='(agent:done)'){
    const why=(t&&t.agentRationale)?String(t.agentRationale).trim():'';
    return why
      ? `No further user message was needed. The test agent judged this phase complete: ${why}`
      : 'No further user message was needed. The test agent judged that this phase’s goal was already satisfied by the bot’s last reply.';
  }
  if(low.includes('context reset')) return 'The conversation was reset so this scenario could be run again from the start.';
  const click=s.match(/^\[click\]\s*(.+)$/i);
  if(click) return `The user selected the on-screen option: “${click[1].trim()}”.`;
  return s;
}
function isHistAutomationTurn(t){
  if(!t||t.skipped) return false;
  const fc=String(t.failureClass||'');
  if(/harness|automation|context_clear/i.test(fc)) return true;
  const u=String(t.userMessage||'').toLowerCase();
  if(/\$\$_?clearcontext|plan error|spec crash|harness error|context reset|restarting/i.test(u)) return true;
  const r=String(t.reason||'').toLowerCase();
  if(/forge delete|eval error|harness error|execute error|context clear|chat token failed|wrong journey.*forge/i.test(r)) return true;
  return false;
}
function isHistInfraTurn(t){
  if(!t||t.skipped||isHistAutomationTurn(t)) return false;
  const fc=String(t.failureClass||'');
  if(/infra_transient|harness_timeout/i.test(fc)) return true;
  const r=String(t.reason||'').toLowerCase();
  if(/blocked_error|timed out|no bot reply|try again later|having trouble|could not connect|network error/i.test(r)) return true;
  return false;
}
function histFlowOutcome(flow){
  const o=flow.reportOutcome||flow.outcome||(flow.passed?'passed':((flow.phasesPassed|0)>0?'partial':'failed'));
  if(o==='failed'&&!flow.turns?.some(t=>!t.skipped&&!isHistAutomationTurn(t)&&!isHistInfraTurn(t)&&t.passed===false&&(t.actualBotResponse||'').trim())) return 'automation_error';
  return o;
}
function formatHistStatus(t){
  if(t&&t.skipped) return 'SKIPPED';
  if(isHistAutomationTurn(t)||isHistInfraTurn(t)) return 'NOT SCORED';
  if(t&&t.outcome) return String(t.outcome).toUpperCase()==='AUTOMATION_ERROR'?'NOT SCORED':String(t.outcome).toUpperCase();
  if(t&&t.passed===true) return 'PASSED';
  const r=String(t&&t.reason||'').toLowerCase();
  if(r.includes('not_yet')) return 'FAILED';
  if(t&&t.passed===false) return 'FAILED';
  return '—';
}
function _renderHistBody(idx, flows){
  const body=document.getElementById('hcb-'+idx);
  if(!body) return;
  const rows=[];
  (flows||[]).forEach(flow=>{
    const ro=histFlowOutcome(flow);
    if(ro!=='partial'&&ro!=='failed') return;
    const scenario=(flow.name||'').replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
    const flowName=flow.groupName||flow.groupId||'—';
    let turns=(flow.turns||[]).filter(t=>!t.skipped&&!isHistAutomationTurn(t)&&!isHistInfraTurn(t)&&formatHistStatus(t)==='FAILED');
    if(!turns.length&&(ro==='partial'||ro==='failed')){
      const all=(flow.turns||[]).filter(t=>!t.skipped);
      const last=[...all].reverse().find(t=>{
        const u=String(t.userMessage||'').trim().toLowerCase();
        return u!=='(agent: done)'&&u!=='(agent:done)';
      });
      if(last) turns=[last];
    }
    if(!turns.length) return;
    turns.forEach(t=>{
      const harness=isHistAutomationTurn(t)||isHistInfraTurn(t);
      rows.push({
        scenario, flowName,
        user: formatHistUserMessage(t.userMessage,t),
        expected: String(t.expectedBotResponse||'—').trim(),
        bot: String(t.actualBotResponse||'').trim()||'No bot reply was captured.',
        status: harness?'HARNESS':(ro==='partial'?'PARTIAL':'FAILED'),
      });
    });
  });
  if(!rows.length){ body.innerHTML='<div class="hc2-loading">No bot response issues in this run.</div>'; return; }
  const trs=rows.map(r=>`<tr class="${r.status==='FAILED'?'row-fail':r.status==='PARTIAL'?'row-part':r.status==='HARNESS'?'row-skip':'row-skip'}">
    <td>${esc(r.scenario)}</td><td>${esc(r.flowName)}</td><td>${esc(r.user)}</td>
    <td>${esc(r.expected)}</td><td>${esc(r.bot)}</td>
    <td><span class="hfb ${r.status==='FAILED'?'f':r.status==='PARTIAL'?'w':r.status==='HARNESS'?'skip':'skip'}">${r.status}</span></td>
  </tr>`).join('');
  body.innerHTML=`<div style="overflow:auto;padding:8px 12px 14px">
    <table class="hist-flat" style="width:100%;border-collapse:collapse;font-size:12px">
      <thead><tr>
        <th>Scenario</th><th>Flow name</th><th>User message</th>
        <th>Expected response</th><th>Bot response</th><th>Status</th>
      </tr></thead><tbody>${trs}</tbody>
    </table></div>`;
  if(!document.getElementById('histFlatCss')){
    const css=document.createElement('style');
    css.id='histFlatCss';
    css.textContent=`.hist-flat th{background:#1e3a5f;color:#fff;padding:8px;text-align:left;font-size:11px;font-weight:700}
      .hist-flat td{padding:8px;border:1px solid var(--b1);vertical-align:top;word-break:break-word;line-height:1.4}
      .hist-flat tr.row-fail td{background:rgba(255,82,82,.06)} .hist-flat tr.row-pass td{background:rgba(0,255,148,.04)}`;
    document.head.appendChild(css);
  }
  lucide.createIcons({el:body});
}

/* ── Manage ── */
async function loadManage(){
  try{
    const r=await fetch('/api/flows');
    const groups=await r.json();
    const total=groups.reduce((s,g)=>s+g.testCases.length,0);
    document.getElementById('mnTcCount').textContent=total;
    renderManage(groups);
  }catch{
    document.getElementById('mnBody').innerHTML='<div class="hempty"><div class="hempty-ico">⚠️</div><div class="hempty-txt">Failed to load flows</div></div>';
  }
}

function renderManage(groups){
  const el=document.getElementById('mnBody');
  const GROUP_ICONS={
    'employment_letter':     `<i data-lucide="file-text"     style="width:15px;height:15px;color:var(--cy)"></i>`,
    'annual_health_checkup_employee': `<i data-lucide="activity" style="width:15px;height:15px;color:#00ff94"></i>`,
    'annual_health_checkup_employee_spouse': `<i data-lucide="activity" style="width:15px;height:15px;color:#34d399"></i>`,
    'annual_health_checkup_spouse_only': `<i data-lucide="activity" style="width:15px;height:15px;color:#6ee7b7"></i>`,
    'appraisal_letter':      `<i data-lucide="trending-up"   style="width:15px;height:15px;color:#7b61ff"></i>`,
    'uk_visa':               `<i data-lucide="plane"         style="width:15px;height:15px;color:var(--cy)"></i>`,
    'national_pension_scheme':`<i data-lucide="landmark"     style="width:15px;height:15px;color:#ffb347"></i>`,
    'voluntary_provident_fund':`<i data-lucide="wallet"      style="width:15px;height:15px;color:#ffb347"></i>`,
    'car_purchase':          `<i data-lucide="car"           style="width:15px;height:15px;color:var(--cy)"></i>`,
    'motorcycle_purchase':   `<i data-lucide="bike"          style="width:15px;height:15px;color:var(--cy)"></i>`,
    'policies':              `<i data-lucide="clipboard"     style="width:15px;height:15px;color:#7b61ff"></i>`,
    'negative_utterances':   `<i data-lucide="ban"           style="width:15px;height:15px;color:var(--rd)"></i>`,
  };

  el.innerHTML=groups.map(g=>{
    const icon=GROUP_ICONS[g.id]||`<i data-lucide="folder" style="width:15px;height:15px;color:var(--t2)"></i>`;
    const tcHtml=g.testCases.length===0
      ? `<div class="mn-no-cases">No test cases yet</div>`
      : g.testCases.map(tc=>`
        <div class="mn-tc" id="mntc-${esc(g.id+'-'+tc.file)}">
          <div class="mn-tc-info">
            <div class="mn-tc-name">${tc.name}</div>
            <div class="mn-tc-tags">
              <span class="tag tturns">${tc.turns} turns</span>
              <span class="tag ${tc.isEdge?'tedge':'thappy'}">${tc.isEdge?'edge':'happy'}</span>
              <span class="tag ${tc.specType==='agent'?'tagent':'tscript'}">${tc.specType==='agent'?'🤖 agent':'script'}</span>
              ${tc.hasUpload?'<span class="tag tupload">upload</span>':''}
            </div>
          </div>
          <div class="mn-tc-acts" id="acts-${esc(g.id+'-'+tc.file)}">
            <button class="mn-act" title="Preview" onclick="openPreview('${esc(g.id)}','${esc(tc.file)}','${esc(tc.name)}')">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            </button>
            <button class="mn-act del" title="Delete" onclick="confirmDelete('${esc(g.id)}','${esc(tc.file)}','${esc(tc.name)}')">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
            </button>
          </div>
        </div>`).join('');

    return `<div class="mn-grp" id="mngrp-${esc(g.id)}">
      <div class="mn-grp-hd" onclick="toggleMnGrp('${esc(g.id)}')">
        <svg class="mn-grp-chev" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="5 3 11 8 5 13"/></svg>
        <div class="mn-grp-ico">${icon}</div>
        <span class="mn-grp-name">${g.name}${g.requiresDbDelete?'<span class="grp-db-badge" title="DB delete before run">DB</span>':''}</span>
        <span class="mn-grp-cnt${g.testCases.length===0?' zero':''}">${g.testCases.length} case${g.testCases.length!==1?'s':''}</span>
      </div>
      <div class="mn-grp-body" id="mnbody-${esc(g.id)}">${tcHtml}</div>
    </div>`;
  }).join('');
  lucide.createIcons({el});
}

function toggleMnGrp(groupId){
  const grpEl=document.getElementById('mngrp-'+groupId);
  if(!grpEl) return;
  grpEl.classList.toggle('open');
}

function confirmDelete(groupId, file, name){
  const actsId='acts-'+groupId+'-'+file;
  const acts=document.getElementById(actsId);
  if(!acts) return;
  acts.innerHTML=`
    <div class="mn-del-confirm">
      <span>Delete?</span>
      <button class="mn-del-yes" onclick="doDelete('${esc(groupId)}','${esc(file)}','${esc(name)}')">Yes</button>
      <button class="mn-del-no" onclick="cancelDelete('${esc(groupId)}','${esc(file)}','${esc(name)}')">No</button>
    </div>`;
}

function cancelDelete(groupId, file, name){
  const actsId='acts-'+groupId+'-'+file;
  const acts=document.getElementById(actsId);
  if(!acts) return;
  acts.innerHTML=`
    <button class="mn-act" title="Preview" onclick="openPreview('${esc(groupId)}','${esc(file)}','${esc(name)}')">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
    </button>
    <button class="mn-act del" title="Delete" onclick="confirmDelete('${esc(groupId)}','${esc(file)}','${esc(name)}')">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
    </button>`;
}

async function doDelete(groupId, file, name){
  try{
    const r=await fetch(`/api/delete/${encodeURIComponent(groupId)}/${encodeURIComponent(file)}`,{method:'DELETE'});
    const data=await r.json();
    if(data.error) throw new Error(data.error);

    // Remove from selected set
    selected.delete(name);

    // Remove row from manage UI
    const rowId='mntc-'+groupId+'-'+file;
    const row=document.getElementById(rowId);
    if(row) row.remove();

    // Update group count
    const grpEl=document.getElementById('mngrp-'+groupId);
    if(grpEl){
      const remaining=grpEl.querySelectorAll('.mn-tc').length;
      const cnt=grpEl.querySelector('.mn-grp-cnt');
      if(cnt) cnt.textContent=`${remaining} case${remaining!==1?'s':''}`;
      const total=parseInt(document.getElementById('mnTcCount').textContent||'0')-1;
      document.getElementById('mnTcCount').textContent=Math.max(0,total);
    }

    // Refresh run tab sidebar
    await loadFlows();
    toast(`Deleted: ${file}`,'ok');
  }catch(e){
    toast('Delete failed: '+e.message,'er');
  }
}

/* ── Markdown Preview ── */
async function openPreview(groupId, file, name) {
  const overlay = document.getElementById('prevOverlay');
  const body    = document.getElementById('prevBody');

  // Populate header
  document.getElementById('prevName').textContent = name.replace(/_/g,' ');
  document.getElementById('prevGrp').textContent  = groupId.replace(/_/g,' ');
  document.getElementById('prevTc').textContent   = file;
  overlay.classList.add('on');
  body.innerHTML = '<div class="prev-empty"><div class="prev-empty-ico">⏳</div><div class="prev-empty-txt">Loading…</div></div>';

  try {
    const r = await fetch(`/api/preview/${encodeURIComponent(groupId)}/${encodeURIComponent(file)}`);
    const { content, error } = await r.json();
    if (error) throw new Error(error);
    const turns = parseMdTurns(content);
    body.innerHTML = turns.length
      ? renderConvPreview(turns)
      : `<div class="prev-empty"><div class="prev-empty-ico"><i data-lucide="inbox" style="width:36px;height:36px"></i></div><div class="prev-empty-txt">No turns found in this file</div></div>`;
    lucide.createIcons({el:body});
  } catch(e) {
    body.innerHTML = `<div class="prev-empty"><div class="prev-empty-ico"><i data-lucide="alert-triangle" style="width:36px;height:36px;color:var(--rd)"></i></div><div class="prev-empty-txt">${e.message}</div></div>`;
    lucide.createIcons({el:body});
  }
}

function closePrev() {
  document.getElementById('prevOverlay').classList.remove('on');
}

// Close on Escape key
document.addEventListener('keydown', e => {
  if(e.key==='Escape'){
    closePrev();
    closeHistPreview();
  }
});

function parseMdTurns(md) {
  // Split on ### Turn N headers
  const sections = md.split(/###\s+Turn\s+\d+[^\n]*/i).slice(1);
  return sections.map((section, idx) => {
    // Cut at ## sections (Validation Points etc.)
    const clean = section.split(/\n##\s+/i)[0];

    const userMatch = clean.match(/\*\*User:\*\*\s*([\s\S]*?)(?=\*\*HR Agentic Bot:\*\*|$)/i);
    const botMatch  = clean.match(/\*\*HR Agentic Bot:\*\*\s*([\s\S]*?)(?=\n---|$)/i);

    function extractBq(raw) {
      if (!raw) return '';
      return raw.split('\n')
        .filter(l => l.trim().startsWith('>'))
        .map(l => l.replace(/^>\s?/, '').trim())
        .filter(Boolean)
        .join('\n');
    }

    return {
      turn: idx + 1,
      user: extractBq(userMatch ? userMatch[1] : ''),
      bot:  extractBq(botMatch  ? botMatch[1]  : ''),
    };
  }).filter(t => t.user || t.bot);
}

function renderConvPreview(turns) {
  return turns.map(t => {
    const isUpload = /^\[uploads?\s/i.test(t.user.trim());
    const userBubble = isUpload
      ? `<div class="bubble-upload"><i data-lucide="paperclip" style="width:13px;height:13px"></i> File upload</div>`
      : `<div class="bubble-text">${escHtml(t.user)}</div>`;

    return `
      <div class="prev-turn-lbl">Turn ${t.turn}</div>
      ${t.user ? `
      <div class="prev-bubble user">
        <div class="bubble-avi"><i data-lucide="user" style="width:14px;height:14px"></i></div>
        <div class="bubble-body">
          <div class="bubble-who">You</div>
          ${userBubble}
        </div>
      </div>` : ''}
      ${t.bot ? `
      <div class="prev-bubble bot">
        <div class="bubble-avi"><i data-lucide="bot" style="width:14px;height:14px"></i></div>
        <div class="bubble-body">
          <div class="bubble-who">HR Bot</div>
          <div class="bubble-text">${escHtml(t.bot)}</div>
        </div>
      </div>` : ''}`;
  }).join('');
}

function escHtml(s) {
  return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/* ── Generator ── */
let genMarkdown = '';

function parseRawConversation(raw, userId) {
  const BOT  = 'RE HR Ag Ai V3';
  const USER = (userId || 'GM').trim();
  const tsRe     = /^\d{1,2}:\d{2}\s*(AM|PM)$/i;
  const timingRe = /^\d+\.?\d*s$/;
  const IGNORE   = new Set(['Analyze response', BOT, USER]);

  const lines = raw.split('\n').map(l => l.trim());
  const turns = [];
  let speaker = null;
  let buf = [];

  function flush() {
    const text = buf
      .filter(l => l && !tsRe.test(l) && !timingRe.test(l) && !IGNORE.has(l))
      .join('\n').trim();
    if (text) {
      // Content before any speaker tag = user's opening message (e.g. "motorcycle purchase")
      turns.push({ speaker: speaker || 'user', text });
    }
    buf = [];
  }

  for (const line of lines) {
    if (line === BOT)        { flush(); speaker = 'bot';  }
    else if (line === USER)  { flush(); speaker = 'user'; }
    else                     { buf.push(line); }
  }
  flush();
  return turns;
}

function buildMarkdown(turns, groupId, caseName) {
  const GROUPS = {
    employment_letter:'Employment Letter',
    annual_health_checkup_employee:'AHC — Employee Only',
    annual_health_checkup_employee_spouse:'AHC — Employee with Spouse',
    annual_health_checkup_spouse_only:'AHC — Spouse Only',
    appraisal_letter:'Appraisal Letter', uk_visa:'UK Visa',
    national_pension_scheme:'National Pension Scheme', voluntary_provident_fund:'Voluntary Provident Fund',
    car_purchase:'Car Purchase', motorcycle_purchase:'Motorcycle Purchase',
    policies:'Policies', negative_utterances:'Negative Utterances',
  };
  const groupName = GROUPS[groupId] || groupId;
  const title = caseName.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase());

  let md = `# ${groupName} - ${title}\n\n`;
  md += `**Test Case:** ${title}\n`;
  md += `**Agent:** HR Agentic Bot\n\n---\n\n`;
  md += `## Conversation Flow\n\n`;

  // Start from first user turn (skip any orphaned leading bot message)
  let i = 0;
  while (i < turns.length && turns[i].speaker === 'bot') i++;
  let turnNum = 0;

  while (i < turns.length) {
    const t = turns[i];
    if (t.speaker === 'user') {
      turnNum++;
      const isUpload = /^attachment$/i.test(t.text.trim());
      const userText = isUpload ? '[Uploads file]' : t.text;

      md += `### Turn ${turnNum}\n\n`;
      md += `**User:**\n`;
      userText.split('\n').forEach(l => { md += `> ${l}\n`; });
      md += '\n';

      if (i + 1 < turns.length && turns[i+1].speaker === 'bot') {
        i++;
        md += `**HR Agentic Bot:**\n`;
        turns[i].text.split('\n').forEach(l => { md += `> ${l}\n`; });
        md += '\n---\n\n';
      }
      i++;
    } else {
      i++; // skip orphaned bot turn
    }
  }

  md += `## Test Validation Points\n\n`;
  md += `1. All ${turnNum} turns completed successfully.\n\n`;
  md += `## Expected Outcome\n\n`;
  md += `The flow completes with all expected bot responses validated.\n`;

  return { md, turnNum };
}

function genPreview() {
  const raw     = document.getElementById('genInput').value.trim();
  const groupId = document.getElementById('genGroup').value;
  const name    = document.getElementById('genName').value.trim();
  const userId  = document.getElementById('genUserId').value.trim();

  if (!raw)     { toast('Paste a conversation first','er'); return; }
  if (!groupId) { toast('Select a flow group','er'); return; }
  if (!name)    { toast('Enter a test case name','er'); return; }
  if (!userId)  { toast('Enter your User ID (e.g. GM, JK, RJ)','er'); return; }
  localStorage.setItem('genUserId', userId); // remember for next time

  const turns = parseRawConversation(raw, userId);
  if (!turns.length) { toast('Could not parse any turns — check the format','er'); return; }

  const { md, turnNum } = buildMarkdown(turns, groupId, name);
  genMarkdown = md;

  // Replace preview area with editable textarea + hint
  const prev = document.getElementById('genPreview');
  prev.innerHTML = `
    <textarea class="gen-md-edit" id="genMdEdit" spellcheck="false">${md.replace(/</g,'&lt;')}</textarea>
    <div class="gen-edit-hint">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      Click anywhere in the preview to edit — changes are saved automatically
    </div>`;

  // Sync edits back to genMarkdown live
  document.getElementById('genMdEdit').addEventListener('input', function(){
    genMarkdown = this.value;
  });

  // Turns badge
  const badge = document.getElementById('genTurns');
  badge.textContent = `${turnNum} turn${turnNum!==1?'s':''} parsed`;
  badge.style.display = 'inline-flex';

  // Save bar
  const filename = name.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'') + '.md';
  document.getElementById('genSaveInfo').textContent = `Will save as: ${groupId}/${filename}`;
  const sb = document.getElementById('genSaveBar');
  sb.style.display = 'flex';
  sb.dataset.saveMode = 'markdown';
  const saveLbl = document.querySelector('#genSaveBar .gen-save-btn span');
  if (saveLbl) saveLbl.textContent = 'Save Test Case';

  toast(`${turnNum} turns parsed — preview ready!`,'ok');
}

async function saveGenerated() {
  const groupId = document.getElementById('genGroup').value;
  const name    = document.getElementById('genName').value.trim();
  const editEl  = document.getElementById('genMdEdit');
  const saveBar = document.getElementById('genSaveBar');
  const saveMode = saveBar && saveBar.dataset.saveMode;

  if (saveMode === 'agent') {
    if (editEl) {
      try { genAgentSpec = JSON.parse(editEl.value); } catch { toast('Invalid JSON in preview','er'); return; }
    }
    if (!genAgentSpec || !groupId) { toast('Generate an agent spec preview first','er'); return; }
    const filename = (genAgentSpec.name || name).toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'') + '.json';
    try {
      const r = await fetch('/api/save-agent-spec', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ groupId, filename, spec: genAgentSpec }),
      });
      const data = await r.json();
      if (data.error) throw new Error(data.error);
      toast(`Saved agent spec: ${data.file}`,'ok');
      saveBar.dataset.saveMode = '';
      saveBar.style.display = 'none';
      if (document.querySelector('#genSaveBar .gen-save-btn span')) {
        document.querySelector('#genSaveBar .gen-save-btn span').textContent = 'Save Test Case';
      }
      genAgentSpec = null;
      await loadFlows();
      return;
    } catch (e) { toast('Save failed: '+e.message,'er'); return; }
  }

  if (editEl) genMarkdown = editEl.value;
  if (!genMarkdown || !groupId || !name) { toast('Generate a preview first','er'); return; }

  try {
    const r = await fetch('/api/generate', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ groupId, name, markdown: genMarkdown }),
    });
    const data = await r.json();
    if (data.error) throw new Error(data.error);

    toast(`Saved: ${data.file}`,'ok');
    await loadFlows(); // refresh sidebar

    // Reset form
    document.getElementById('genInput').value = '';
    document.getElementById('genName').value  = '';
    document.getElementById('genGroup').value = '';
    document.getElementById('genTurns').style.display = 'none';
    document.getElementById('genSaveBar').style.display = 'none';
    document.getElementById('genPreview').innerHTML = `<div class="gen-empty">
      <div class="gen-empty-ico">✅</div>
      <div class="gen-empty-txt">Test case saved!</div>
      <div class="gen-empty-hint">${data.file} added to ${data.groupId}</div>
    </div>`;
    genMarkdown = '';
  } catch(e) {
    toast('Save failed: ' + e.message,'er');
  }
}

function copyGenMd() {
  const editEl = document.getElementById('genMdEdit');
  const text   = editEl ? editEl.value : genMarkdown;
  if (!text) { toast('Nothing to copy','er'); return; }
  navigator.clipboard.writeText(text).then(() => toast('Copied to clipboard','ok'));
}

/* ── Toast ── */
function toast(msg,type='ok'){
  const icons={ok:'✅',er:'❌'};
  const el=document.createElement('div');el.className=`toast ${type}`;
  el.innerHTML=`<span>${icons[type]||'ℹ️'}</span>${msg}`;
  document.getElementById('toasts').appendChild(el);
  setTimeout(()=>el.remove(),3500);
}

function showDbGateModal({ groupId, groupName, hint, instructions }) {
  dbGatePending = { groupId, groupName, hint, instructions };
  const ov = document.getElementById('dbGateOverlay');
  const title = document.getElementById('dbGateTitle');
  const body = document.getElementById('dbGateBody');
  const accessEl = document.getElementById('dbGateAccess');
  const linkEl = document.getElementById('dbGateLink');
  const listEl = document.getElementById('dbGateList');
  const hintEl = document.getElementById('dbGateHint');
  const label = groupName || groupId || 'journey';
  const inst = instructions || null;

  if (title) title.textContent = `Manual DB delete — ${label}`;
  if (body) {
    body.textContent = `The runner is paused. Sign in to Yellow.ai Studio and delete the rows below, then click Done.`;
  }
  if (accessEl) {
    accessEl.textContent = inst?.accessAccount
      ? `Studio access required: ${inst.accessAccount}`
      : 'Studio access required: mohamed.asif@yellow.ai';
  }
  if (linkEl) {
    const url = inst?.tableUrl || '';
    if (url) {
      linkEl.href = url;
      linkEl.textContent = `Open table: ${inst.table || url}`;
      linkEl.style.display = 'inline-block';
    } else {
      linkEl.style.display = 'none';
    }
  }
  if (listEl) {
    listEl.innerHTML = '';
    const rows = inst?.deleteRows || [];
    if (rows.length) {
      for (const row of rows) {
        const li = document.createElement('li');
        li.textContent = row;
        listEl.appendChild(li);
      }
      listEl.style.display = 'block';
    } else {
      listEl.style.display = 'none';
    }
  }
  if (hintEl) hintEl.textContent = hint || '';
  if (ov) ov.classList.add('on');
  const livetag = document.getElementById('livetag');
  if (livetag) livetag.textContent = '⏸ DB DELETE';
  log(`⏸  DB gate — ${inst?.accessAccount || 'mohamed.asif@yellow.ai'} must delete rows for ${label}`, 'warn');
  toast('Manual DB delete required (Yellow Studio)', 'ok');
}

function hideDbGateModal() {
  dbGatePending = null;
  const ov = document.getElementById('dbGateOverlay');
  if (ov) ov.classList.remove('on');
  const livetag = document.getElementById('livetag');
  if (livetag && running) livetag.textContent = '● LIVE';
}

async function confirmDbGateDone() {
  let gid = dbGatePending?.groupId || '';
  if (!gid) {
    try {
      const st = await fetch('/api/db-gate/status').then(r => r.json());
      if (st.gate?.waiting) gid = st.gate.groupId || '';
    } catch (_) {}
  }
  try {
    const r = await fetch('/api/db-gate/done', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupId: gid }),
    });
    const d = await r.json();
    if (!d.ok) {
      toast(d.error || 'Could not acknowledge DB gate', 'er');
      return;
    }
    const label = dbGatePending?.groupName || gid;
    hideDbGateModal();
    log(`✅  DB cleared for ${label} — runner continuing…`, 'ok');
    toast('DB cleared — resuming run', 'ok');
  } catch (e) {
    toast('DB gate failed: ' + e.message, 'er');
  }
}

/* ── History Result Preview ── */
function openHistPreview(jsonFile, flowName){
  const overlay=document.getElementById('histPrevOverlay');
  const body=document.getElementById('histPrevBody');
  const statsBar=document.getElementById('histStatsBar');

  document.getElementById('histPrevName').textContent=flowName.replace(/_/g,' ');
  document.getElementById('histPrevDate').textContent='';
  document.getElementById('histPrevFile').textContent=jsonFile;
  statsBar.innerHTML='';
  body.innerHTML='<div class="prev-empty"><div class="prev-empty-ico"><i data-lucide="loader-2" style="width:36px;height:36px;animation:spin 1s linear infinite"></i></div><div class="prev-empty-txt">Loading…</div></div>';
  overlay.classList.add('on');
  lucide.createIcons({el:overlay});

  fetch('/api/history/detail/'+encodeURIComponent(jsonFile))
    .then(r=>r.json())
    .then(data=>{
      const flow=data.find(f=>f.name===flowName)||data[0];
      if(!flow){
        body.innerHTML='<div class="prev-empty"><div class="prev-empty-txt">No data found for this flow.</div></div>';
        return;
      }
      renderHistPreview(flow, jsonFile);
    })
    .catch(e=>{
      body.innerHTML=`<div class="prev-empty"><div class="prev-empty-ico"><i data-lucide="alert-triangle" style="width:36px;height:36px;color:var(--rd)"></i></div><div class="prev-empty-txt">${escHtml(String(e))}</div></div>`;
      lucide.createIcons({el:body});
    });
}

function renderHistPreview(flow, jsonFile){
  const body=document.getElementById('histPrevBody');
  const statsBar=document.getElementById('histStatsBar');
  if(!body||!statsBar) return;

  const turns=flow.turns||[];
  const passCount=turns.filter(t=>formatHistStatus(t)==='PASSED').length;
  const partialCount=turns.filter(t=>formatHistStatus(t)==='PARTIAL').length;
  const skipCount=turns.filter(t=>t.skipped).length;
  const failCount=turns.filter(t=>formatHistStatus(t)==='FAILED').length;
  const scores=turns.filter(t=>!t.skipped&&t.score!=null).map(t=>t.score);
  const avgScore=scores.length?Math.round(scores.reduce((a,b)=>a+b,0)/scores.length*100):null;
  const overall=flow.reportOutcome||flow.outcome||(flow.passed?'passed':((flow.phasesPassed|0)>0?'partial':'failed'));
  const overallLbl=overall==='passed'?'PASSED':overall==='partial'?'PARTIAL':overall==='automation_error'?'NOT SCORED':'FAILED';
  const overallCls=overall==='passed'?'pass':overall==='partial'?'part':overall==='automation_error'?'skip':'fail';

  // Stats bar
  statsBar.innerHTML=`
    <span class="hist-stat ok"><strong>${passCount}</strong>&nbsp;steps passed</span>
    ${partialCount?`<span class="hist-stat warn"><strong>${partialCount}</strong>&nbsp;partial</span>`:''}
    ${failCount?`<span class="hist-stat bad"><strong>${failCount}</strong>&nbsp;failed</span>`:''}
    ${skipCount?`<span class="hist-stat"><strong>${skipCount}</strong>&nbsp;skipped</span>`:''}
    ${avgScore!=null?`<span class="hist-stat warn"><strong>${avgScore}%</strong>&nbsp;avg match</span>`:''}
    <span class="hist-overall ${overallCls}">${overallLbl}</span>`;

  // Chat bubbles
  function cleanBot(raw){
    return (raw||'')
      .replace(/^(HR Agentic Bot[\s\S]*?Now\s*,\s*\n)/,'')
      .replace(/(,\s*\nNow\s*,?\s*)$/,'')
      .trim()||'—';
  }

  const html=turns.filter(t=>!isHistAutomationTurn(t)).map((t,i)=>{
    const num=t.turnNumber??t.turn??(i+1);
    const score=t.score!=null?Math.round(t.score*100):null;
    const scoreColor=score!=null?(score>=80?'#00e676':score>=60?'#ffb347':'#ff5252'):'var(--t3)';
    const st=formatHistStatus(t);
    const badgeCls=t.skipped?'skip':st==='PASSED'?'pass':st==='PARTIAL'?'part':'fail';
    const badgeTxt=t.skipped?'SKIPPED':st==='PASSED'?'PASS':st==='PARTIAL'?'PARTIAL':'FAIL';

    const turnLbl=`<div class="prev-turn-lbl ht">
      <span style="flex:1;height:1px;background:rgba(255,255,255,.05)"></span>
      <span style="font-size:9.5px;font-weight:700;letter-spacing:.1em;color:var(--t3)">TURN ${num}</span>
      <span class="ht-badge ${badgeCls}">${badgeTxt}</span>
      ${score!=null?`<span class="ht-score" style="color:${scoreColor}">${score}%</span>`:''}
      <span style="flex:1;height:1px;background:rgba(255,255,255,.05)"></span>
    </div>`;

    if(t.skipped) return turnLbl;

    const userMsg=t.userMessage||t.sent||'';
    const botMsg=cleanBot(t.actualBotResponse||t.received||'');
    const reason=(!t.passed&&t.reason)?`<div class="ht-reason">${escHtml(t.reason)}</div>`:'';

    return `${turnLbl}
    ${userMsg?`<div class="prev-bubble user">
      <div class="bubble-avi"><i data-lucide="user" style="width:14px;height:14px"></i></div>
      <div class="bubble-body">
        <div class="bubble-who">You</div>
        <div class="bubble-text">${escHtml(userMsg)}</div>
      </div>
    </div>`:''}
    <div class="prev-bubble bot">
      <div class="bubble-avi"><i data-lucide="bot" style="width:14px;height:14px"></i></div>
      <div class="bubble-body">
        <div class="bubble-who">HR Bot</div>
        <div class="bubble-text">${escHtml(botMsg)}</div>
        ${reason}
      </div>
    </div>`;
  }).join('');

  body.innerHTML=html;
  lucide.createIcons({el:body});
  lucide.createIcons({el:statsBar});
}

function closeHistPreview(){
  document.getElementById('histPrevOverlay').classList.remove('on');
}

/* ═══════════════════════════════════════════════════════════════
   TUNE PROMPTS
   ═══════════════════════════════════════════════════════════════ */
let tuneState = {
  runs: [],
  flows: [],
  prompts: [],
  selectedRun: null,
  selectedFlow: null,
  currentPrompt: '',
  suggestedPrompt: '',
  promptFile: '',
  iteration: 0,
  hasSuggestion: false,
  failsHidden: false,
};

/* ── Token count helper ── */
function _approxTokens(str){ return Math.round((str||'').length / 4); }

/* ── Auto-suggest prompt file ── */
function autoSuggestPromptFile(flowName, promptFiles){
  if(!promptFiles.length) return '';
  const strip = s => s.toLowerCase()
    .replace(/\.md$/,'')
    .replace(/happy_flow|edge_case|flow|test|case|bot|agent/g,'')
    .replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'');
  const flowKey = strip(flowName);
  const flowTokens = flowKey.split('_').filter(Boolean);
  let best = -1, bestFile = promptFiles[0];
  for(const f of promptFiles){
    const fk = strip(f);
    const ft = fk.split('_').filter(Boolean);
    const overlap = flowTokens.filter(t => ft.includes(t)).length;
    const score = overlap / Math.max(flowTokens.length, ft.length, 1);
    if(score > best){ best = score; bestFile = f; }
  }
  return bestFile;
}

/* ── Load data when tab opens ── */
async function loadTuneData(){
  try{ const r=await fetch('/api/reports'); tuneState.runs=await r.json(); } catch(e){ tuneState.runs=[]; }
  try{ const r=await fetch('/api/prompts'); tuneState.prompts=await r.json(); } catch(e){ tuneState.prompts=[]; }
  renderTuneRunDropdown();
  _buildPromptDropdown();
  lucide.createIcons({el:document.getElementById('pt')});
}

function renderTuneRunDropdown(){
  const sel=document.getElementById('tuneRunSel');
  const prev=sel.value;
  sel.innerHTML='<option value="">— select a test run —</option>';
  tuneState.runs.forEach((run,i)=>{
    // Parse timestamp from filename: test-results-2026-05-12T05-12-31-567Z.json
    // Convert "2026-05-12T05-12-31-567Z" → "2026-05-12T05:12:31.567Z"
    const tsRaw=run.file.replace('test-results-','').replace('.json','');
    const tsIso=tsRaw.replace(/T(\d{2})-(\d{2})-(\d{2})-(\d+)Z/,'T$1:$2:$3.$4Z');
    let timeStr=tsRaw;
    try{
      const d=new Date(tsIso);
      const day=d.toLocaleDateString('en-GB',{day:'2-digit',month:'short'});
      const time=d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',hour12:false});
      timeStr=day+', '+time;
    } catch(_){}

    // Flow names
    const flowNames=run.flows.map(f=>f.name).join(', ');
    const flowLabel=run.flows.length===1
      ? flowNames
      : run.flows.length+' flows';

    // Failing turns
    const failTurns=run.flows.reduce((s,f)=>s+(f.totalTurns-f.passedTurns),0);
    const failLabel=failTurns>0?' · '+failTurns+' failing':'';

    const label=flowLabel+' · '+timeStr+failLabel;
    const opt=document.createElement('option');
    opt.value=i; opt.textContent=label; sel.appendChild(opt);
  });
  if(prev) sel.value=prev;
}

function _buildPromptDropdown(){
  const sel=document.getElementById('tunePromptSel');
  const prev=sel.value;
  sel.innerHTML='<option value="">— select prompt file —</option>';
  tuneState.prompts.forEach(f=>{
    const opt=document.createElement('option');
    opt.value=f; opt.textContent=f; sel.appendChild(opt);
  });
  sel.disabled=false;
  if(prev) sel.value=prev;
}

function onTuneRunChange(){
  const idx=document.getElementById('tuneRunSel').value;
  const flowSel=document.getElementById('tuneFlowSel');
  flowSel.innerHTML='<option value="">— select a flow —</option>';
  flowSel.disabled=true;
  if(idx===''){
    tuneState.selectedRun=null; tuneState.flows=[];
    _resetTuneFlow(); return;
  }
  const run=tuneState.runs[+idx];
  fetch('/api/history/detail/'+encodeURIComponent(run.file))
    .then(r=>r.json())
    .then(detail=>{
      tuneState.selectedRun=detail;
      tuneState.flows=detail.filter(f=>f.turns.some(t=>!t.passed&&!t.skipped));
      renderTuneFlowDropdown();
      flowSel.disabled=tuneState.flows.length===0;
      if(tuneState.flows.length===0) toast('No failing flows in this run 🎉');
    })
    .catch(e=>toast('Failed to load run: '+e.message,'er'));
}

function renderTuneFlowDropdown(){
  const sel=document.getElementById('tuneFlowSel');
  sel.innerHTML='<option value="">— select a flow —</option>';
  tuneState.flows.forEach((f,i)=>{
    const fails=f.turns.filter(t=>!t.passed&&!t.skipped).length;
    const opt=document.createElement('option');
    opt.value=i;
    opt.textContent=f.name+' · '+fails+' failing';
    sel.appendChild(opt);
  });
}

function onTuneFlowChange(){
  const idx=document.getElementById('tuneFlowSel').value;
  if(idx===''){
    tuneState.selectedFlow=null;
    document.getElementById('tuneFailList').innerHTML='<div class="tune-fails-empty">Select a flow to see failing turns.</div>';
    document.getElementById('tuneFailCount').textContent='0';
    _resetTuneFlow(); return;
  }
  tuneState.selectedFlow=tuneState.flows[+idx];
  renderTuneFailCards();
  // Auto-suggest prompt file
  const suggested=autoSuggestPromptFile(tuneState.selectedFlow.name, tuneState.prompts);
  if(suggested){
    document.getElementById('tunePromptSel').value=suggested;
    onTunePromptChange();
  } else {
    _updateTuneButtons();
  }
}

function renderTuneFailCards(){
  const flow=tuneState.selectedFlow;
  if(!flow) return;
  const fails=flow.turns.filter(t=>!t.passed&&!t.skipped);
  document.getElementById('tuneFailCount').textContent=fails.length;
  // Update tab badge
  const tcTune=document.getElementById('tcTune');
  if(tcTune){ tcTune.textContent=fails.length; tcTune.style.display=fails.length?'':'none'; }
  const list=document.getElementById('tuneFailList');
  if(!fails.length){
    list.innerHTML='<div class="tune-fails-empty">🎉 No failing turns — all passed!</div>';
    return;
  }
  list.innerHTML=fails.map((t,i)=>`
    <div class="tune-fail-card">
      <div class="tune-fail-hd">
        <span class="tune-fail-turn">Turn ${t.turnNumber||(i+1)}</span>
        <span class="tune-fail-badge"><i data-lucide="x" style="width:9px;height:9px"></i> FAIL</span>
      </div>
      <div class="tune-fail-field">
        <div class="tune-fail-field-lbl">User Said</div>
        <div class="tune-fail-field-val">${esc(String(t.userMessage||'').slice(0,100))}</div>
      </div>
      ${t.reason?`<div class="tune-fail-field">
        <div class="tune-fail-field-lbl why">Why It Failed</div>
        <div class="tune-fail-field-val reason">${esc(String(t.reason).slice(0,160))}</div>
      </div>`:''}
    </div>`).join('');
  lucide.createIcons({el:document.getElementById('tuneFailList')});
}

function toggleTuneFails(){
  const wrap=document.getElementById('tuneFailsWrap');
  tuneState.failsHidden=!tuneState.failsHidden;
  wrap.classList.toggle('tune-fails-collapsed', tuneState.failsHidden);
  const tog=document.getElementById('tuneFailsToggle');
  tog.innerHTML=tuneState.failsHidden
    ? '<i data-lucide="chevron-down" style="width:13px;height:13px"></i> Show'
    : '<i data-lucide="chevron-up" style="width:13px;height:13px"></i> Hide';
  lucide.createIcons({el:tog});
}

async function onTunePromptChange(){
  const file=document.getElementById('tunePromptSel').value;
  tuneState.promptFile=file;
  tuneState.hasSuggestion=false;
  tuneState.suggestedPrompt='';
  tuneState.currentPrompt='';
  document.getElementById('tuneCurrentTa').value='';
  document.getElementById('tuneSuggestedTa').value='';
  
  
  document.getElementById('tuneDiffEl').innerHTML='';
  document.getElementById('tuneBanner').classList.remove('show');
  document.getElementById('tuneNewBadge').style.display='none';
  document.getElementById('tpCurrentChars').textContent='';

  if(!file){ _updateTuneButtons(); return; }

  _setTuneStatus('Loading '+file+'…','');
  _updateTuneButtons(); // enable Suggest optimistically once file chosen

  try{
    const r=await fetch('/api/prompts/'+encodeURIComponent(file));
    if(!r.ok){
      const txt=await r.text();
      throw new Error('HTTP '+r.status+': '+txt.slice(0,120));
    }
    const data=await r.json();
    if(data.error) throw new Error(data.error);
    tuneState.currentPrompt=data.content||'';
    if(!tuneState.currentPrompt) throw new Error('Prompt file is empty.');
    document.getElementById('tuneCurrentTa').value=tuneState.currentPrompt;
    
    updateTuneChars();
    _setTuneStatus('Prompt loaded — '+tuneState.currentPrompt.length.toLocaleString()+' chars','ok');
  } catch(e){
    tuneState.currentPrompt='';
    _setTuneStatus('⚠ '+e.message,'er');
    toast('Failed to load prompt: '+e.message,'er');
  }
  _updateTuneButtons();
  _updateIterBar();
}

function updateTuneChars(){
  const cur=document.getElementById('tuneCurrentTa').value;
  const sug=document.getElementById('tuneSuggestedTa').value;
  document.getElementById('tpCurrentChars').textContent=cur.length?cur.length.toLocaleString()+' chars':'';
  document.getElementById('tpSideLChars').textContent=cur.length?cur.length.toLocaleString()+' chars':'';
  if(sug){
    const diff=sug.length-cur.length;
    const sign=diff>=0?'+':'';
    document.getElementById('tpSugChars').textContent=sug.length.toLocaleString()+' chars ('+sign+diff+')';
    document.getElementById('tpSideRChars').textContent=sug.length.toLocaleString()+' chars';
    const infoEl=document.getElementById('tuneCharInfo');
    infoEl.textContent=sug.length.toLocaleString()+' chars ('+sign+diff+')';
    infoEl.style.display='';
    document.getElementById('tuneModelInfo').style.display='';
  }
}

function syncSideToSuggested(){
  // Side-by-side is now rendered (not a textarea) — no-op
}

/* ── LCS-based line diff ── */
function _lcsLineDiff(oldLines, newLines){
  // For large files cap LCS at 800 lines to stay fast, fall back to simple diff
  if(oldLines.length > 800 || newLines.length > 800) return _simpleDiff(oldLines, newLines);
  const m=oldLines.length, n=newLines.length;
  // Build LCS table
  const dp=Array.from({length:m+1},()=>new Uint16Array(n+1));
  for(let i=1;i<=m;i++){
    for(let j=1;j<=n;j++){
      dp[i][j] = oldLines[i-1]===newLines[j-1] ? dp[i-1][j-1]+1 : Math.max(dp[i-1][j],dp[i][j-1]);
    }
  }
  // Backtrack
  const ops=[];
  let i=m, j=n;
  while(i>0||j>0){
    if(i>0&&j>0&&oldLines[i-1]===newLines[j-1]){ ops.unshift({t:'same',a:oldLines[i-1],b:newLines[j-1]}); i--;j--; }
    else if(j>0&&(i===0||dp[i][j-1]>=dp[i-1][j])){ ops.unshift({t:'add',b:newLines[j-1]}); j--; }
    else { ops.unshift({t:'del',a:oldLines[i-1]}); i--; }
  }
  return ops;
}

function _simpleDiff(oldLines, newLines){
  const maxLen=Math.max(oldLines.length,newLines.length);
  const ops=[];
  for(let i=0;i<maxLen;i++){
    const a=oldLines[i]??null, b=newLines[i]??null;
    if(a===b) ops.push({t:'same',a,b});
    else {
      if(a!==null) ops.push({t:'del',a});
      if(b!==null) ops.push({t:'add',b});
    }
  }
  return ops;
}

/* ── Render diff into side-by-side panes ── */
function _renderSideBySide(){
  const cur = tuneState.currentPrompt || '';
  const sug = document.getElementById('tuneSuggestedTa').value || tuneState.suggestedPrompt || '';
  const ops = _lcsLineDiff(cur.split('\n'), sug.split('\n'));

  let leftHtml='', rightHtml='';
  let lNum=1, rNum=1;

  ops.forEach(op=>{
    if(op.t==='same'){
      leftHtml  += `<div class="dl same"><span class="dl-num">${lNum++}</span><span class="dl-txt">${esc(op.a)}</span></div>`;
      rightHtml += `<div class="dl same"><span class="dl-num">${rNum++}</span><span class="dl-txt">${esc(op.b)}</span></div>`;
    } else if(op.t==='del'){
      leftHtml  += `<div class="dl del"><span class="dl-num">${lNum++}</span><span class="dl-txt">${esc(op.a)}</span></div>`;
      rightHtml += `<div class="dl empty"><span class="dl-num"></span><span class="dl-txt"></span></div>`;
    } else { // add
      leftHtml  += `<div class="dl empty"><span class="dl-num"></span><span class="dl-txt"></span></div>`;
      rightHtml += `<div class="dl add"><span class="dl-num">${rNum++}</span><span class="dl-txt">${esc(op.b)}</span></div>`;
    }
  });

  document.getElementById('sideLView').innerHTML = leftHtml;
  document.getElementById('sideRView').innerHTML = rightHtml;

  // Char counts
  document.getElementById('tpSideLChars').textContent = cur.length.toLocaleString()+' chars';
  const delta = sug.length - cur.length;
  document.getElementById('tpSideRChars').textContent = sug.length.toLocaleString()+' chars ('+(delta>=0?'+':'')+delta+')';

  _bindSideScroll();
}

/* ── Sync scroll between the two side panes ── */
let _sideScrollBound = false;
function _bindSideScroll(){
  if(_sideScrollBound) return;
  _sideScrollBound = true;
  const L=document.getElementById('sideLView'), R=document.getElementById('sideRView');
  let busy=false;
  L.addEventListener('scroll',()=>{ if(!busy){busy=true; R.scrollTop=L.scrollTop; R.scrollLeft=L.scrollLeft; requestAnimationFrame(()=>busy=false); } });
  R.addEventListener('scroll',()=>{ if(!busy){busy=true; L.scrollTop=R.scrollTop; L.scrollLeft=R.scrollLeft; requestAnimationFrame(()=>busy=false); } });
}

/* ── Unified diff view (Diff tab) ── */
function _renderDiff(){
  const a=(tuneState.currentPrompt||'').split('\n');
  const b=(document.getElementById('tuneSuggestedTa').value||tuneState.suggestedPrompt||'').split('\n');
  const ops=_lcsLineDiff(a,b);
  let html='';
  ops.forEach(op=>{
    if(op.t==='same') html+=`<span class="diff-ctx">${esc(op.a)}\n</span>`;
    else if(op.t==='del') html+=`<span class="diff-del">- ${esc(op.a)}\n</span>`;
    else html+=`<span class="diff-add">+ ${esc(op.b)}\n</span>`;
  });
  document.getElementById('tuneDiffEl').innerHTML=html;
}

function setTuneView(view){
  const panes=['Current','Suggested','SideL','SideR','Diff'];
  panes.forEach(p=>document.getElementById('tp'+p).classList.add('hidden'));
  document.getElementById('tpSideDivider').classList.add('hidden');
  ['current','suggested','side','diff'].forEach(v=>{
    document.getElementById('tv'+v.charAt(0).toUpperCase()+v.slice(1)).classList.remove('active');
  });
  if(view==='current'){
    document.getElementById('tpCurrent').classList.remove('hidden');
    document.getElementById('tvCurrent').classList.add('active');
  } else if(view==='suggested'){
    document.getElementById('tpSuggested').classList.remove('hidden');
    document.getElementById('tvSuggested').classList.add('active');
  } else if(view==='side'){
    document.getElementById('tpSideL').classList.remove('hidden');
    document.getElementById('tpSideDivider').classList.remove('hidden');
    document.getElementById('tpSideR').classList.remove('hidden');
    document.getElementById('tvSide').classList.add('active');
    _renderSideBySide();
  } else if(view==='diff'){
    document.getElementById('tpDiff').classList.remove('hidden');
    document.getElementById('tvDiff').classList.add('active');
    _renderDiff();
  }
}

function _setTuneStatus(msg, cls){
  const dot=document.getElementById('tuneStatusDot');
  const txt=document.getElementById('tuneStatusTxt');
  txt.textContent=msg;
  txt.className='tune-status-txt'+(cls?' '+cls:'');
  dot.className='tune-status-dot'+(cls?' '+cls:'');
}

function _updateTuneButtons(){
  const hasFlow=!!tuneState.selectedFlow;
  const hasPromptFile=!!tuneState.promptFile;
  const hasPromptContent=!!tuneState.currentPrompt;
  const hasSug=tuneState.hasSuggestion;
  const maxed=tuneState.iteration>=5;

  // Suggest enabled as long as flow + file are chosen AND content loaded
  document.getElementById('tuneSuggestBtn').disabled=!hasFlow||!hasPromptFile||!hasPromptContent||maxed;
  document.getElementById('tuneApplyBtn').disabled=!hasSug;
  document.getElementById('tuneRejectBtn').disabled=!hasSug;
  document.getElementById('tuneContinueBtn').disabled=!hasSug||maxed;
  ['tvSuggested','tvSide','tvDiff'].forEach(id=>{ document.getElementById(id).disabled=!hasSug; });

  const iterWrap=document.getElementById('tuneIterWrap');
  iterWrap.style.display=hasPromptFile?'flex':'none';
}

function _updateIterBar(){
  const pct=Math.min(tuneState.iteration/5*100,100);
  document.getElementById('tuneIterFill').style.width=pct+'%';
  document.getElementById('tuneIterNum').textContent=tuneState.iteration;
}

function _resetTuneFlow(){
  tuneState.selectedFlow=null;
  tuneState.currentPrompt='';
  tuneState.suggestedPrompt='';
  tuneState.hasSuggestion=false;
  tuneState.iteration=0;
  document.getElementById('tuneCurrentTa').value='';
  document.getElementById('tuneSuggestedTa').value='';
  
  
  document.getElementById('tuneDiffEl').innerHTML='';
  document.getElementById('tuneFailList').innerHTML='<div class="tune-fails-empty">Select a test run and flow above.</div>';
  document.getElementById('tuneFailCount').textContent='0';
  document.getElementById('tuneBanner').classList.remove('show');
  document.getElementById('tuneNewBadge').style.display='none';
  document.getElementById('tuneCharInfo').style.display='none';
  document.getElementById('tuneModelInfo').style.display='none';
  _setTuneStatus('Ready','');
  _updateTuneButtons();
  _updateIterBar();
  setTuneView('current');
}

/* ── Suggest ── */
async function doTuneSuggest(){
  if(!tuneState.selectedFlow||!tuneState.promptFile) return;
  // Sync textarea → state (user may have edited)
  tuneState.currentPrompt=document.getElementById('tuneCurrentTa').value;
  const fails=tuneState.selectedFlow.turns.filter(t=>!t.passed&&!t.skipped);
  if(!fails.length){ toast('No failing turns to fix! 🎉'); return; }

  document.getElementById('tuneSuggestBtn').disabled=true;
  _setTuneStatus('Asking GPT-4.1 to improve the prompt…','thinking');

  try{
    const r=await fetch('/api/tune/suggest',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        promptFile:tuneState.promptFile,
        currentPrompt:tuneState.currentPrompt,
        failingTurns:fails.map(t=>({
          name:t.name||'',
          turnNumber:t.turnNumber,
          userMessage:t.userMessage||'',
          expected:t.expectedBotResponse||'',
          actual:t.actualBotResponse||'',
          reason:t.reason||'',
        })),
      }),
    });
    const data=await r.json();
    if(data.error) throw new Error(data.error);

    tuneState.suggestedPrompt=data.suggested;
    tuneState.hasSuggestion=true;
    tuneState.iteration++;

    document.getElementById('tuneSuggestedTa').value=tuneState.suggestedPrompt;
    
    
    updateTuneChars();
    _renderDiff();

    // Show banner with summary
    const delta=tuneState.suggestedPrompt.length-tuneState.currentPrompt.length;
    const sign=delta>=0?'+':'';
    const tokens=_approxTokens(tuneState.suggestedPrompt);
    document.getElementById('tuneBannerText').textContent=
      'Prompt improved to address '+fails.length+' failing turn'+(fails.length===1?'':'s')+'.';
    document.getElementById('tuneBannerMeta').textContent=
      '~'+tokens.toLocaleString()+' tokens · gpt-4.1 · iteration '+tuneState.iteration+'/5';
    document.getElementById('tuneBanner').classList.add('show');
    document.getElementById('tuneNewBadge').style.display='';
    lucide.createIcons({el:document.getElementById('tuneBanner')});

    _setTuneStatus('Suggestion ready · '+fails.length+' failing turns addressed.','ok');
    setTuneView('suggested');
  } catch(e){
    _setTuneStatus('Error: '+e.message,'er');
    toast('GPT error: '+e.message,'er');
  }
  _updateTuneButtons();
  _updateIterBar();
}

/* ── Apply ── */
async function doTuneApply(){
  if(!tuneState.hasSuggestion) return;
  const content=document.getElementById('tuneSuggestedTa').value;
  try{
    const r=await fetch('/api/tune/apply',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({promptFile:tuneState.promptFile,content}),
    });
    const data=await r.json();
    if(data.error) throw new Error(data.error);
    tuneState.currentPrompt=content;
    document.getElementById('tuneCurrentTa').value=content;
    
    tuneState.suggestedPrompt='';
    tuneState.hasSuggestion=false;
    document.getElementById('tuneSuggestedTa').value='';
    
    document.getElementById('tuneBanner').classList.remove('show');
    document.getElementById('tuneNewBadge').style.display='none';
    updateTuneChars();
    toast('✅ Prompt saved — .bak backup created.');
    _setTuneStatus('Applied. Re-run tests to verify.','ok');
    setTuneView('current');
  } catch(e){
    toast('Apply failed: '+e.message,'er');
    _setTuneStatus('Apply failed.','er');
  }
  _updateTuneButtons();
}

/* ── Reject ── */
function doTuneReject(){
  tuneState.suggestedPrompt='';
  tuneState.hasSuggestion=false;
  document.getElementById('tuneSuggestedTa').value='';
  
  document.getElementById('tuneDiffEl').innerHTML='';
  document.getElementById('tuneBanner').classList.remove('show');
  document.getElementById('tuneNewBadge').style.display='none';
  document.getElementById('tuneCharInfo').style.display='none';
  document.getElementById('tuneModelInfo').style.display='none';
  _setTuneStatus('Rejected. Edit manually or suggest again.','');
  setTuneView('current');
  _updateTuneButtons();
}

/* ── Continue (iterate) ── */
async function doTuneContinue(){
  if(tuneState.iteration>=5){ toast('Max 5 iterations reached.','er'); return; }
  // Promote suggestion → current
  const sug=document.getElementById('tuneSuggestedTa').value;
  if(sug){
    tuneState.currentPrompt=sug;
    document.getElementById('tuneCurrentTa').value=sug;
    
  }
  tuneState.suggestedPrompt='';
  tuneState.hasSuggestion=false;
  document.getElementById('tuneSuggestedTa').value='';
  document.getElementById('tuneBanner').classList.remove('show');
  document.getElementById('tuneNewBadge').style.display='none';
  _updateTuneButtons();
  await doTuneSuggest();
}

/* ── History Delete ── */
function confirmDeleteHistory(idx, jsonFile){
  event.stopPropagation();
  const card=document.getElementById('hc'+idx);
  if(!card||card.querySelector('.hdel-confirm')) return;
  const conf=document.createElement('div');
  conf.className='hdel-confirm';
  conf.innerHTML=`<span>Delete this run?</span>
    <button class="hdelbtn-yes" onclick="doDeleteHistory(${idx},'${escHtml(jsonFile)}');event.stopPropagation()">Yes, delete</button>
    <button class="hdelbtn-no" onclick="this.closest('.hdel-confirm').remove();event.stopPropagation()">Cancel</button>`;
  const hctop2=card.querySelector('.hctop2');
  if(hctop2) hctop2.insertAdjacentElement('afterend', conf);
}

/* ── Journey briefs ── */
async function loadJourneyBriefs(){
  try{
    const r=await fetch('/api/journey-briefs');
    if(!r.ok) return;
    journeyBriefs=await r.json();
  }catch{ journeyBriefs={}; }
}

function openBriefModal(groupId){
  const g=allGroups.find(x=>x.id===groupId);
  briefModalGroupId=groupId;
  document.getElementById('briefModalTitle').textContent='Journey brief — '+(g?g.name:groupId);
  document.getElementById('briefModalText').value=journeyBriefs[groupId]||'';
  document.getElementById('briefModalOverlay').style.display='flex';
  setTimeout(()=>document.getElementById('briefModalText').focus(), 80);
}

function closeBriefModal(){
  briefModalGroupId=null;
  document.getElementById('briefModalOverlay').style.display='none';
}

function openManualSpecsModal(groupId){
  const g=allGroups.find(x=>x.id===groupId);
  manualSpecsGroupId=groupId;
  document.getElementById('manualSpecsTitle').textContent='Manual test cases — '+(g?g.name:groupId);
  document.getElementById('manualSpecsText').value='';
  document.getElementById('manualSpecsOverlay').style.display='flex';
  setTimeout(()=>document.getElementById('manualSpecsText').focus(),80);
}
function closeManualSpecsModal(){
  manualSpecsGroupId=null;
  document.getElementById('manualSpecsOverlay').style.display='none';
}
async function saveManualSpecs(){
  if(!manualSpecsGroupId){ closeManualSpecsModal(); return; }
  const raw=document.getElementById('manualSpecsText').value;
  if(!raw.trim()){ toast('Paste at least one JSON spec','er'); return; }
  try{
    const r=await fetch('/api/save-manual-specs',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ groupId: manualSpecsGroupId, specsText: raw }),
    });
    const d=await r.json();
    if(d.error) throw new Error(d.error);
    toast('Saved '+d.count+' test case'+(d.count===1?'':'s'),'ok');
    closeManualSpecsModal();
    await loadFlows();
  }catch(e){ toast('Save failed: '+e.message,'er'); }
}

function openGenerateSpecsModal(groupId){
  const g=allGroups.find(x=>x.id===groupId);
  generateSpecsGroupId=groupId;
  document.getElementById('generateSpecsTitle').textContent='Generate test cases — '+(g?g.name:groupId);
  const eff=document.getElementById('agentEffortSel');
  const ge=document.getElementById('generateSpecsEffort');
  if(ge&&eff) ge.value=eff.value||'50';
  document.getElementById('generateSpecsBrief').value=journeyBriefs[groupId]||'';
  document.getElementById('generateSpecsStatus').textContent='';
  document.getElementById('generateSpecsOverlay').style.display='flex';
}
function closeGenerateSpecsModal(){
  generateSpecsGroupId=null;
  document.getElementById('generateSpecsOverlay').style.display='none';
}
async function runGenerateJourneySpecs(){
  if(!generateSpecsGroupId){ return; }
  const effort=parseInt(document.getElementById('generateSpecsEffort').value,10)||50;
  const brief=document.getElementById('generateSpecsBrief').value;
  const st=document.getElementById('generateSpecsStatus');
  st.textContent='Generating with LLM…';
  try{
    const r=await fetch('/api/generate-journey-specs',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ groupId: generateSpecsGroupId, effortPct: effort, brief, save: true }),
    });
    const d=await r.json();
    if(d.error) throw new Error(d.error);
    st.textContent='Saved '+d.count+' spec(s) at '+d.effortPct+'% effort: '+(d.saved||[]).map(s=>s.filename).join(', ');
    toast('Generated '+d.count+' test cases','ok');
    await loadFlows();
  }catch(e){
    st.textContent='';
    toast('Generate failed: '+e.message,'er');
  }
}

async function saveJourneyBrief(){
  if(!briefModalGroupId){ closeBriefModal(); return; }
  const text=document.getElementById('briefModalText').value;
  try{
    const r=await fetch('/api/journey-briefs/'+encodeURIComponent(briefModalGroupId),{
      method:'PUT',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({text}),
    });
    const data=await r.json();
    if(data.error) throw new Error(data.error);
    const trimmed=text.trim();
    if(trimmed) journeyBriefs[briefModalGroupId]=trimmed;
    else delete journeyBriefs[briefModalGroupId];
    const g=allGroups.find(x=>x.id===briefModalGroupId);
    if(g){ g.hasBrief=!!trimmed; g.briefPreview=trimmed?trimmed.slice(0,120)+(trimmed.length>120?'…':''):''; }
    toast('Journey brief saved','ok');
    closeBriefModal();
    renderGroups(document.getElementById('searchInput').value);
  }catch(e){ toast('Save failed: '+e.message,'er'); }
}

function onGenGroupChange(){
  const gid=document.getElementById('genGroup').value;
  const box=document.getElementById('genBriefBox');
  const ta=document.getElementById('genJourneyBrief');
  if(!box||!ta) return;
  if(!gid){ box.style.display='none'; return; }
  box.style.display='block';
  ta.value=journeyBriefs[gid]||'';
}

async function saveGenJourneyBrief(){
  const gid=document.getElementById('genGroup').value;
  const ta=document.getElementById('genJourneyBrief');
  if(!gid){ toast('Select a flow group first','er'); return; }
  try{
    const r=await fetch('/api/journey-briefs/'+encodeURIComponent(gid),{
      method:'PUT',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({text: ta.value}),
    });
    const data=await r.json();
    if(data.error) throw new Error(data.error);
    const trimmed=ta.value.trim();
    if(trimmed) journeyBriefs[gid]=trimmed;
    else delete journeyBriefs[gid];
    const g=allGroups.find(x=>x.id===gid);
    if(g){ g.hasBrief=!!trimmed; g.briefPreview=trimmed?trimmed.slice(0,120)+(trimmed.length>120?'…':''):''; }
    toast('Journey brief saved','ok');
    renderGroups(document.getElementById('searchInput').value);
  }catch(e){ toast('Save failed: '+e.message,'er'); }
}

async function genAgentPreview(){
  const raw=document.getElementById('genInput').value.trim();
  const groupId=document.getElementById('genGroup').value;
  const name=document.getElementById('genName').value.trim();
  const userId=document.getElementById('genUserId').value.trim();
  if(!raw){ toast('Paste a conversation first','er'); return; }
  if(!groupId){ toast('Select a flow group','er'); return; }
  if(!name){ toast('Enter a test case name','er'); return; }
  toast('Generating agent spec with LLM…','info');
  try{
    const r=await fetch('/api/generate-agent-spec',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ groupId, name, chatTranscript: raw, userId }),
    });
    const data=await r.json();
    if(data.error) throw new Error(data.error);
    genAgentSpec=data.spec;
    const jsonStr=JSON.stringify(data.spec,null,2);
    const prev=document.getElementById('genPreview');
    prev.innerHTML=`<textarea class="gen-md-edit" id="genMdEdit" spellcheck="false">${jsonStr.replace(/</g,'&lt;')}</textarea>
      <div class="gen-edit-hint">Agent JSON — edit if needed, then Save</div>`;
    document.getElementById('genMdEdit').addEventListener('input', function(){
      try{ genAgentSpec=JSON.parse(this.value); }catch{}
    });
    document.getElementById('genTurns').style.display='none';
    document.getElementById('genSaveInfo').textContent=`Will save as: ${data.groupId}/${data.filename}`;
    document.getElementById('genSaveBar').style.display='flex';
    document.querySelector('#genSaveBar .gen-save-btn span').textContent='Save agent spec';
    document.getElementById('genSaveBar').dataset.saveMode='agent';
    toast('Agent spec ready — review and save','ok');
  }catch(e){ toast('Generate failed: '+e.message,'er'); }
}

async function doDeleteHistory(idx, jsonFile){
  event.stopPropagation();
  try{
    const r=await fetch('/api/history/delete/'+encodeURIComponent(jsonFile),{method:'DELETE'});
    const data=await r.json();
    if(data.success){
      histDetailCache.delete(jsonFile);
      const card=document.getElementById('hc'+idx);
      if(card) card.remove();
      toast('Run deleted successfully');
    } else {
      toast('Failed to delete: '+(data.error||'unknown error'),'er');
    }
  } catch(e){
    toast('Error: '+e.message,'er');
  }
}
