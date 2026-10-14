const state={token:localStorage.getItem('parking_token')||'',user:null,view:'',cache:{},scanResult:null,scanner:null,libs:{},navSeq:0};
const $=s=>document.querySelector(s),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const SERVER_TIMEOUT_MS=18000;
const RETRYABLE_ACTIONS=new Set(['bootstrap','dashboard','listUsers','managerData','listHousing','listVehicles','formOptions','listIncidents','listAudit','listRequests','ownerBundle','listTemporaryPeriods','globalSearch','housingDetail','vehicleHistory']);
function sleep(ms){return new Promise(r=>setTimeout(r,ms))}
function server(fn,...args){
  return new Promise((resolve,reject)=>{
    let settled=false;
    const finish=(cb,value)=>{if(settled)return;settled=true;clearTimeout(timer);cb(value)};
    const timer=setTimeout(()=>finish(reject,new Error('El servidor está tardando demasiado en responder. Puedes reintentar sin recargar la página.')),SERVER_TIMEOUT_MS);
    try{
      google.script.run
        .withSuccessHandler(value=>finish(resolve,value))
        .withFailureHandler(e=>finish(reject,new Error((e&&e.message||String(e)).replace(/^Exception:\s*/,''))))[fn](...args);
    }catch(e){finish(reject,e instanceof Error?e:new Error(String(e)))}
  })
}
async function call(action,payload={}){
  const attempts=RETRYABLE_ACTIONS.has(action)?2:1;
  let last;
  for(let i=0;i<attempts;i++){
    try{return await server('api',state.token,action,payload)}catch(e){
      last=e;
      if(/sesión|session/i.test(e.message)){localStorage.removeItem('parking_token');state.token='';state.user=null;login(e.message);throw e}
      if(i+1<attempts)await sleep(650);
    }
  }
  throw last;
}
function busy(el,on=true){if(el)el.disabled=on}
function toast(message,bad=false){let t=$('#toast');if(!t){t=document.createElement('div');t.id='toast';document.body.appendChild(t)}t.className='message '+(bad?'bad':'');t.textContent=message;t.style.cssText='position:fixed;right:1rem;bottom:1rem;z-index:99;max-width:420px';clearTimeout(t.timer);t.timer=setTimeout(()=>t.remove(),4500)}
function loadExternal(key,urls,globalName){
  if(window[globalName])return Promise.resolve(window[globalName]);if(state.libs[key])return state.libs[key];
  state.libs[key]=new Promise(async(resolve,reject)=>{for(const url of urls){try{await new Promise((ok,no)=>{const s=document.createElement('script'),timer=setTimeout(()=>{s.remove();no(new Error('timeout'))},8000);s.src=url;s.async=true;s.onload=()=>{clearTimeout(timer);ok()};s.onerror=()=>{clearTimeout(timer);s.remove();no(new Error('load'))};document.head.appendChild(s)});if(window[globalName]){resolve(window[globalName]);return}}catch(e){}}reject(new Error('No se pudo cargar el componente. Comprueba la conexión e inténtalo de nuevo.'))});
  state.libs[key].catch(()=>delete state.libs[key]);return state.libs[key];
}
const ensureQr=()=>loadExternal('qr',['https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js','https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js'],'QRCode');
const ensureScanner=()=>loadExternal('scanner',['https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js','https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js'],'Html5Qrcode');
function qrTarget(token){const base=WEB_APP_URL||location.href.split('?')[0];return base+'?q='+encodeURIComponent(token)}
function qrSize(){return Math.max(220,Math.min(280,window.innerWidth-80))}

function downloadCsv(filename,rows,columns){
  const cols=columns&&columns.length?columns:[...new Set((rows||[]).flatMap(r=>Object.keys(r||{})))];
  const cell=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
  const csv='\ufeff'+[cols.map(cell).join(';'),...(rows||[]).map(r=>cols.map(c=>cell(r[c])).join(';'))].join('\r\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

const UI_STATE_KEY='parking_ui_state_v2';
function loadUiState(){try{return JSON.parse(sessionStorage.getItem(UI_STATE_KEY)||'{}')||{}}catch(e){return {}}}
function saveUiState(patch){try{const next=Object.assign({},loadUiState(),patch||{});sessionStorage.setItem(UI_STATE_KEY,JSON.stringify(next));return next}catch(e){return {}}}
function viewUiState(view=state.view){const all=loadUiState();return (all.views&&all.views[view])||{}}
function saveViewUiState(view,patch){try{const all=loadUiState(),views=Object.assign({},all.views||{});views[view]=Object.assign({},views[view]||{},patch||{});all.views=views;sessionStorage.setItem(UI_STATE_KEY,JSON.stringify(all));return views[view]}catch(e){return {}}}
function rememberCurrentView(view){if(view)saveUiState({view})}
function clearUiState(){try{sessionStorage.removeItem(UI_STATE_KEY)}catch(e){}}
function defaultViewForRole(role){return role==='ADMIN'?'dashboard':role==='CONTROL'?'control':'ownerHome'}


// 1.2.11.3 - utilidades UX compartidas
function actionMenuHtml(inner,label='Acciones'){return `<details class="action-menu"><summary>${esc(label)}</summary><div class="action-menu-panel">${inner}</div></details>`}
function clientDateOnly(value){const m=String(value||'').match(/^(\d{4})-(\d{2})-(\d{2})/);return m?`${m[1]}-${m[2]}-${m[3]}`:''}
function periodMatches(value,period,from='',to=''){if(!period)return true;const d=clientDateOnly(value);if(!d)return false;const now=new Date(),today=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;const dateAgo=n=>{const x=new Date(now.getFullYear(),now.getMonth(),now.getDate()-n);return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`};if(period==='today')return d===today;if(period==='7')return d>=dateAgo(6)&&d<=today;if(period==='30')return d>=dateAgo(29)&&d<=today;if(period==='month'){const p=today.slice(0,7);return d.slice(0,7)===p}if(period==='prevmonth'){const x=new Date(now.getFullYear(),now.getMonth()-1,1),p=`${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}`;return d.slice(0,7)===p}if(period==='custom')return (!from||d>=from)&&(!to||d<=to);return true}
function periodFilterFields(prefix){return `<div class="field"><label>Período</label><select id="${prefix}-period"><option value="">Todo</option><option value="today">Hoy</option><option value="7">7 días</option><option value="30">30 días</option><option value="month">Mes actual</option><option value="prevmonth">Mes anterior</option><option value="custom">Personalizado</option></select></div><div class="field period-custom hide" id="${prefix}-from-wrap"><label>Desde</label><input type="date" id="${prefix}-from"></div><div class="field period-custom hide" id="${prefix}-to-wrap"><label>Hasta</label><input type="date" id="${prefix}-to"></div>`}
function bindPeriodVisibility(prefix){const p=$(`#${prefix}-period`),a=$(`#${prefix}-from-wrap`),b=$(`#${prefix}-to-wrap`);const refresh=()=>{const show=p&&p.value==='custom';a&&a.classList.toggle('hide',!show);b&&b.classList.toggle('hide',!show)};if(p)p.addEventListener('change',refresh);refresh()}
