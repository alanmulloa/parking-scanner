let scanner=null,done=false,starting=false;
const status=document.getElementById('status');
const fallback=document.getElementById('fallback');
const back=document.getElementById('back');
const returnUrl=new URLSearchParams(location.search).get('return')||'';
function show(msg,bad=false){status.textContent=msg;status.className='message'+(bad?' bad':'')}
function validParkingUrl(text){
  try{const u=new URL(text);return u.protocol==='https:'&&u.searchParams.has('q')}catch(e){return false}
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
      if(!validParkingUrl(text)){show('El QR leído no contiene un enlace válido de Parking Comunidad.',true);return}
      done=true;navigator.vibrate?.(100);show('QR detectado. Volviendo a Parking Comunidad…');await stop();window.location.href=text;
    },()=>{});
    show('Apunta al QR y mantenlo dentro del recuadro.');
  }catch(e){
    await stop();
    show('No se pudo iniciar la cámara automáticamente. Pulsa “ABRIR CÁMARA” y revisa el permiso si el navegador lo solicita.',true);
    fallback.style.display='block';
  }finally{starting=false}
}
fallback.addEventListener('click',start);
back.addEventListener('click',async()=>{done=true;await stop();if(returnUrl){window.location.href=returnUrl}else if(history.length>1){history.back()}else{window.location.href='https://alanmulloa.github.io/parking-scanner/'}});
window.addEventListener('pagehide',()=>{stop()});
window.addEventListener('load',()=>{setTimeout(start,150)});
