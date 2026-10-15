const state={token:localStorage.getItem('parking_token')||'',user:null,view:'',cache:{bootstrap:{settings:(typeof INITIAL_PUBLIC_SETTINGS!=='undefined'&&INITIAL_PUBLIC_SETTINGS)||{}}},scanResult:null,scanner:null,libs:{},navSeq:0};
const APP_FRONTEND_VERSION='1.2.12.24';
function appSettings(){return state.cache?.bootstrap?.settings||{}}
function appDisplayName(){return appSettings().NombreOficial||'Parking Comunidad'}
function appDescription(){return appSettings().Descripcion||appSettings().NombreCorto||'Gestión de acceso y parking de la comunidad'}
function appLogoUrl(){return appSettings().LogoUrl||''}
function appBrandHtml(compact=false){const logo=appLogoUrl(),name=appDisplayName();return `<span class="brand-identity ${compact?'compact':''}">${logo?`<img class="brand-logo" src="${esc(logo)}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='grid'"><span class="brand-fallback" style="display:none">P</span>`:`<span class="brand-fallback">P</span>`}<span class="brand-name">${esc(name)}</span></span>`}
function applyParkingSettings(settings){settings=settings||{};const root=document.documentElement;if(settings.ColorPrincipal)root.style.setProperty('--brand',settings.ColorPrincipal);if(settings.ColorSecundario)root.style.setProperty('--dark',settings.ColorSecundario);if(settings.ColorAcento)root.style.setProperty('--accent',settings.ColorAcento);document.title=settings.NombreOficial||'Parking Comunidad'}
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


const ensureXlsx=()=>loadExternal('xlsx',[
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
],'XLSX');
function excelValue(v){
  if(v===null||v===undefined)return '';
  if(v instanceof Date)return v;
  const s=String(v);
  if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)){const d=new Date(s);if(!Number.isNaN(d.getTime()))return d}
  if(/^\d{4}-\d{2}-\d{2}$/.test(s)){const [y,m,d]=s.split('-').map(Number);return new Date(Date.UTC(y,m-1,d))}
  return v;
}
async function downloadXlsx(filename,rows,columns,sheetName='Datos'){
  const data=rows||[];if(!data.length){toast('No hay registros para exportar.',true);return}
  const XLSX=await ensureXlsx();
  const cols=columns&&columns.length?columns:[...new Set(data.flatMap(r=>Object.keys(r||{})))];
  const normalized=data.map(r=>Object.fromEntries(cols.map(c=>[c,excelValue(r?.[c])])));
  const ws=XLSX.utils.json_to_sheet(normalized,{header:cols,cellDates:true});
  ws['!autofilter']={ref:`A1:${XLSX.utils.encode_col(Math.max(0,cols.length-1))}${data.length+1}`};
  ws['!cols']=cols.map(c=>({wch:Math.min(42,Math.max(12,String(c).length+2,...data.slice(0,200).map(r=>String(r?.[c]??'').length+2)))}));
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,String(sheetName||'Datos').slice(0,31));
  XLSX.writeFile(wb,filename,{cellDates:true,compression:true});
}
function exportButtonsHtml(prefix='export-current'){return `<div class="export-actions"><button class="secondary" id="${prefix}-xlsx">Exportar Excel</button><button class="secondary compact" id="${prefix}-csv">CSV</button></div>`}
function downloadCsv(filename,rows,columns){
  const cols=columns&&columns.length?columns:[...new Set((rows||[]).flatMap(r=>Object.keys(r||{})))];
  const cell=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
  const csv='\ufeff'+[cols.map(cell).join(';'),...(rows||[]).map(r=>cols.map(c=>cell(r[c])).join(';'))].join('\r\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

const UI_STATE_KEY='parking_ui_state_v3_'+APP_FRONTEND_VERSION;
function loadUiState(){try{return JSON.parse(sessionStorage.getItem(UI_STATE_KEY)||'{}')||{}}catch(e){return {}}}
function saveUiState(patch){try{const next=Object.assign({},loadUiState(),patch||{});sessionStorage.setItem(UI_STATE_KEY,JSON.stringify(next));return next}catch(e){return {}}}
function viewUiState(view=state.view){const all=loadUiState();return (all.views&&all.views[view])||{}}
function saveViewUiState(view,patch){try{const all=loadUiState(),views=Object.assign({},all.views||{});views[view]=Object.assign({},views[view]||{},patch||{});all.views=views;sessionStorage.setItem(UI_STATE_KEY,JSON.stringify(all));return views[view]}catch(e){return {}}}
function rememberCurrentView(view){if(view)saveUiState({view})}
function clearUiState(){try{sessionStorage.removeItem(UI_STATE_KEY)}catch(e){}}
function defaultViewForRole(role){return role==='ADMIN'?'dashboard':role==='CONTROL'?'control':'ownerHome'}


// 1.2.12 - utilidades UX compartidas + exportación Excel
function actionMenuHtml(inner,label='Acciones'){return `<details class="action-menu"><summary>${esc(label)}</summary><div class="action-menu-panel">${inner}</div></details>`}
function clientDateOnly(value){const m=String(value||'').match(/^(\d{4})-(\d{2})-(\d{2})/);return m?`${m[1]}-${m[2]}-${m[3]}`:''}
function periodMatches(value,period,from='',to=''){if(!period)return true;const d=clientDateOnly(value);if(!d)return false;const now=new Date(),today=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;const dateAgo=n=>{const x=new Date(now.getFullYear(),now.getMonth(),now.getDate()-n);return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`};if(period==='today')return d===today;if(period==='7')return d>=dateAgo(6)&&d<=today;if(period==='30')return d>=dateAgo(29)&&d<=today;if(period==='month'){const p=today.slice(0,7);return d.slice(0,7)===p}if(period==='prevmonth'){const x=new Date(now.getFullYear(),now.getMonth()-1,1),p=`${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}`;return d.slice(0,7)===p}if(period==='custom')return (!from||d>=from)&&(!to||d<=to);return true}
function periodFilterFields(prefix){return `<div class="field"><label>Período</label><select id="${prefix}-period"><option value="">Todo</option><option value="today">Hoy</option><option value="7">7 días</option><option value="30">30 días</option><option value="month">Mes actual</option><option value="prevmonth">Mes anterior</option><option value="custom">Personalizado</option></select></div><div class="field period-custom hide" id="${prefix}-from-wrap"><label>Desde</label><input type="date" id="${prefix}-from"></div><div class="field period-custom hide" id="${prefix}-to-wrap"><label>Hasta</label><input type="date" id="${prefix}-to"></div>`}
function bindPeriodVisibility(prefix){const p=$(`#${prefix}-period`),a=$(`#${prefix}-from-wrap`),b=$(`#${prefix}-to-wrap`);const refresh=()=>{const show=p&&p.value==='custom';a&&a.classList.toggle('hide',!show);b&&b.classList.toggle('hide',!show)};if(p)p.addEventListener('change',refresh);refresh()}


// 1.2.12 - menús de acciones flotantes y agrupaciones estables
(function installFloatingActionMenus(){
  if(window.__parkingFloatingMenusInstalled)return;window.__parkingFloatingMenusInstalled=true;
  const position=details=>{
    if(!details||!details.open||window.matchMedia('(max-width:720px)').matches)return;
    const panel=details.querySelector('.action-menu-panel'),summary=details.querySelector('summary');if(!panel||!summary)return;
    panel.dataset.floating='1';panel.style.position='fixed';panel.style.zIndex='5000';panel.style.top='0';panel.style.left='0';panel.style.right='auto';details.closest('.tablebox')?.classList.add('action-menu-open');
    const r=summary.getBoundingClientRect(),pw=Math.max(190,panel.offsetWidth||190),ph=panel.offsetHeight||220,gap=6;
    let left=Math.min(window.innerWidth-pw-8,Math.max(8,r.right-pw));
    let top=r.bottom+gap;if(top+ph>window.innerHeight-8&&r.top-ph-gap>8)top=r.top-ph-gap;
    panel.style.left=`${left}px`;panel.style.top=`${Math.max(8,top)}px`;
  };
  const reset=details=>{const p=details?.querySelector('.action-menu-panel');if(p){delete p.dataset.floating;p.style.position='';p.style.left='';p.style.top='';p.style.right='';p.style.bottom=''}details?.closest('.tablebox')?.classList.remove('action-menu-open')};
  const sync=details=>{if(!details)return;if(details.open){document.querySelectorAll('details.action-menu[open]').forEach(x=>{if(x!==details){x.open=false;reset(x)}});requestAnimationFrame(()=>requestAnimationFrame(()=>position(details)))}else reset(details)};
  document.addEventListener('click',e=>{const summary=e.target.closest?.('details.action-menu > summary');if(!summary)return;const d=summary.parentElement;setTimeout(()=>sync(d),0)},true);
  document.addEventListener('toggle',e=>{const d=e.target;if(d instanceof HTMLDetailsElement&&d.classList.contains('action-menu'))sync(d)},true);
  document.addEventListener('click',e=>{if(e.target.closest?.('.action-menu'))return;document.querySelectorAll('details.action-menu[open]').forEach(d=>{d.open=false;reset(d)})});
  window.addEventListener('resize',()=>document.querySelectorAll('details.action-menu[open]').forEach(position));
  window.addEventListener('scroll',()=>document.querySelectorAll('details.action-menu[open]').forEach(position),true);
})();
function groupedRowsStable(rows,groupKey,sortFn,groupOrderFn){
  const sorted=[...(rows||[])].sort(sortFn),groups=new Map();
  sorted.forEach(r=>{const k=groupKey(r);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(r)});
  let entries=[...groups.entries()];if(groupOrderFn)entries.sort(groupOrderFn);return entries;
}
