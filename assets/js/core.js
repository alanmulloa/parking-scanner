const state={token:localStorage.getItem('parking_token')||'',user:null,view:'',cache:{},scanResult:null,scanner:null,libs:{},navSeq:0};
const $=s=>document.querySelector(s),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const SERVER_TIMEOUT_MS=18000;
const RETRYABLE_ACTIONS=new Set(['bootstrap','dashboard','listUsers','managerData','listHousing','listVehicles','formOptions','listIncidents','listAudit','listRequests','ownerBundle']);
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
