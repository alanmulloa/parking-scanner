let scanner=null,done=false,starting=false;
const status=document.getElementById('status');
const fallback=document.getElementById('fallback');
const back=document.getElementById('back');
const SCANNER_HOME='https://alanmulloa.github.io/parking-scanner/';
const rawReturn=new URLSearchParams(location.search).get('return')||'';

function show(msg,bad=false){status.textContent=msg;status.className='message'+(bad?' bad':'')}

function parseParkingAppUrl(value,requireQr=false){
  try{
    const u=new URL(String(value||''));
    if(u.protocol!=='https:'||u.hostname.toLowerCase()!=='script.google.com')return null;
    if(!/^\/macros\/s\/[^/]+\/(?:exec|dev)\/?$/.test(u.pathname))return null;
    if(requireQr&&!String(u.searchParams.get('q')||'').trim())return null;
    return u;
  }catch(e){return null}
}
const returnTarget=parseParkingAppUrl(rawReturn,false);
function validParkingUrl(text){
  const u=parseParkingAppUrl(text,true);if(!u)return false;
  if(returnTarget&&(u.origin!==returnTarget.origin||u.pathname!==returnTarget.pathname))return false;
  return true;
}
async function stop(){if(scanner){try{await scanner.stop()}catch(e){}try{scanner.clear()}catch(e){}scanner=null}}
async function start(){
  if(done||starting)return;
  starting=true;fallback.style.display='none';show('Solicitando permiso de cámara…');
  try{
    if(typeof Html5Qrcode==='undefined')throw new Error('No se pudo cargar el lector QR.');
    scanner=new Html5Qrcode('reader');
    await scanner.start({facingMode:'environment'},{fps:12,qrbox:(w,h)=>{const s=Math.floor(Math.min(w,h)*.72);return{width:s,height:s}},aspectRatio:1.333},async text=>{
      if(done)return;
      if(!validParkingUrl(text)){show('El QR leído no pertenece a esta aplicación.',true);return}
      done=true;navigator.vibrate?.(100);show('QR detectado. Volviendo…');await stop();window.location.href=text;
    },()=>{});
    show('Apunta al QR y mantenlo dentro del recuadro.');
  }catch(e){
    await stop();
    show('No se pudo iniciar la cámara automáticamente. Pulsa “ABRIR CÁMARA” y revisa el permiso si el navegador lo solicita.',true);
    fallback.style.display='block';
  }finally{starting=false}
}
fallback.addEventListener('click',start);
back.addEventListener('click',async()=>{done=true;await stop();if(returnTarget){window.location.href=returnTarget.href}else if(history.length>1){history.back()}else{window.location.href=SCANNER_HOME}});
window.addEventListener('pagehide',()=>{stop()});
window.addEventListener('load',()=>{setTimeout(start,150)});
