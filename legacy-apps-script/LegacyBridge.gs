/**
 * Parking Comunidad - Bridge Supabase <-> Apps Script
 *
 * Este archivo NO sustituye doGet(). Solo añade doPost() firmado y dos workers
 * dedicados que ejecutan comandos con la identidad Google correcta:
 * - mail bridge worker: instalar desde la cuenta remitente.
 * - document bridge worker: instalar desde la cuenta con permisos de Drive/Docs.
 */
const PARKING_BRIDGE_VERSION='1.0.1';
const PARKING_BRIDGE_SECRET_PROP='PARKING_BRIDGE_SECRET';
const PARKING_BRIDGE_MAIL_QUEUE_PROP='PARKING_BRIDGE_MAIL_COMMANDS';
const PARKING_BRIDGE_DOC_QUEUE_PROP='PARKING_BRIDGE_DOC_COMMANDS';
const PARKING_BRIDGE_RESULT_INDEX_PROP='PARKING_BRIDGE_RESULT_INDEX';
const PARKING_BRIDGE_RESULT_PREFIX='PARKING_BRIDGE_RESULT_';
const PARKING_BRIDGE_MAIL_HEARTBEAT_PROP='PARKING_BRIDGE_MAIL_HEARTBEAT';
const PARKING_BRIDGE_DOC_HEARTBEAT_PROP='PARKING_BRIDGE_DOC_HEARTBEAT';
const PARKING_BRIDGE_MAIL_HANDLER='processParkingBridgeMailCommandsWorker';
const PARKING_BRIDGE_DOC_HANDLER='processParkingBridgeDocumentCommandsWorker';
const PARKING_BRIDGE_QUEUE_LIMIT=20;
const PARKING_BRIDGE_RESULT_LIMIT=30;
const PARKING_BRIDGE_BATCH_SIZE=10;

function doPost(e){
  return parkingBridgeHandlePost_(e);
}

function parkingBridgeJson_(status,body){
  const out=ContentService.createTextOutput(JSON.stringify(Object.assign({status:status},body||{})));
  out.setMimeType(ContentService.MimeType.JSON);
  return out;
}

function parkingBridgeText_(v){return String(v==null?'':v)}
function parkingBridgeNow_(){return new Date().toISOString()}
function parkingBridgeParseJson_(raw,fallback){try{return JSON.parse(raw||'')}catch(e){return fallback}}
function parkingBridgeProps_(){return PropertiesService.getScriptProperties()}
function parkingBridgeReadPropJson_(key,fallback){return parkingBridgeParseJson_(parkingBridgeProps_().getProperty(key),fallback)}
function parkingBridgeWritePropJson_(key,value){parkingBridgeProps_().setProperty(key,JSON.stringify(value))}
function parkingBridgeHex_(bytes){return (bytes||[]).map(function(b){return ('0'+((Number(b)+256)%256).toString(16)).slice(-2)}).join('')}
function parkingBridgeConstantTimeEq_(a,b){a=parkingBridgeText_(a);b=parkingBridgeText_(b);if(a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0}

function parkingBridgeSecret_(){
  const secret=parkingBridgeProps_().getProperty(PARKING_BRIDGE_SECRET_PROP)||'';
  if(!secret)throw new Error('PARKING_BRIDGE_SECRET no está configurado en Script Properties.');
  return secret;
}

function parkingBridgeVerifyRequest_(body){
  const ts=Number(body.ts||0),nonce=parkingBridgeText_(body.nonce),action=parkingBridgeText_(body.action),payloadJson=parkingBridgeText_(body.payloadJson||'{}'),signature=parkingBridgeText_(body.signature).toLowerCase();
  if(!ts||!nonce||!action||!signature)throw new Error('Solicitud bridge incompleta.');
  if(Math.abs(Math.floor(Date.now()/1000)-ts)>300)throw new Error('Solicitud bridge caducada.');
  const cache=CacheService.getScriptCache(),nonceKey='PARKING_BRIDGE_NONCE_'+nonce;
  if(cache.get(nonceKey))throw new Error('Solicitud bridge repetida.');
  const message=[String(ts),nonce,action,payloadJson].join('\n');
  const expected=parkingBridgeHex_(Utilities.computeHmacSha256Signature(message,parkingBridgeSecret_()));
  if(!parkingBridgeConstantTimeEq_(expected,signature))throw new Error('Firma bridge no válida.');
  cache.put(nonceKey,'1',600);
  return {action:action,payload:parkingBridgeParseJson_(payloadJson,{})||{}};
}

function parkingBridgeHandlePost_(e){
  try{
    const body=parkingBridgeParseJson_(e&&e.postData&&e.postData.contents,{}),verified=parkingBridgeVerifyRequest_(body),action=verified.action,payload=verified.payload||{};
    if(action==='ping')return parkingBridgeJson_(200,{ok:true,bridgeVersion:PARKING_BRIDGE_VERSION,checkedAt:parkingBridgeNow_()});
    if(action==='status')return parkingBridgeJson_(200,{ok:true,bridgeVersion:PARKING_BRIDGE_VERSION,checkedAt:parkingBridgeNow_(),data:parkingBridgeStatus_()});
    if(action==='command.enqueue')return parkingBridgeJson_(200,{ok:true,data:parkingBridgeEnqueue_(payload)});
    if(action==='command.status')return parkingBridgeJson_(200,{ok:true,data:parkingBridgeCommandStatus_(parkingBridgeText_(payload.id))});
    throw new Error('Acción bridge no soportada.');
  }catch(err){return parkingBridgeJson_(400,{ok:false,error:String((err&&err.message)||err)})}
}

function parkingBridgeQueueProp_(domain){
  if(domain==='mail')return PARKING_BRIDGE_MAIL_QUEUE_PROP;
  if(domain==='documents')return PARKING_BRIDGE_DOC_QUEUE_PROP;
  throw new Error('Dominio bridge no válido.');
}

function parkingBridgeAllowedCommand_(domain,command){
  const allowed={
    mail:['testWelcome','senderMode','setNoReply','installWorker','workerStatus','uninstallWorker','emailStatus','processQueue','retryFailed'],
    documents:['configureFolder','verifyDrive','testDocs','installWorker','workerStatus','uninstallWorker','generateMissing','regenerateAll','processQueue']
  };
  return !!allowed[domain]&&allowed[domain].indexOf(command)>=0;
}

function parkingBridgeEnqueue_(payload){
  const domain=parkingBridgeText_(payload.domain),command=parkingBridgeText_(payload.command),args=payload.args&&typeof payload.args==='object'?payload.args:{};
  if(!parkingBridgeAllowedCommand_(domain,command))throw new Error('Comando bridge no permitido.');
  const id='BRG_'+Utilities.getUuid(),prop=parkingBridgeQueueProp_(domain),lock=LockService.getScriptLock();lock.waitLock(10000);
  try{
    const items=parkingBridgeReadPropJson_(prop,[]);if(items.length>=PARKING_BRIDGE_QUEUE_LIMIT)throw new Error('La cola bridge está completa.');
    items.push({id:id,domain:domain,command:command,args:args,createdAt:parkingBridgeNow_(),requestedBy:parkingBridgeText_(payload.requestedBy)});
    parkingBridgeWritePropJson_(prop,items);
  }finally{lock.releaseLock()}
  return {id:id,domain:domain,command:command,state:'PENDING',queuedAt:parkingBridgeNow_()};
}

function parkingBridgeResultKey_(id){return PARKING_BRIDGE_RESULT_PREFIX+parkingBridgeText_(id)}
function parkingBridgeSaveResult_(item){
  const lock=LockService.getScriptLock();lock.waitLock(10000);
  try{
    const props=parkingBridgeProps_(),index=parkingBridgeReadPropJson_(PARKING_BRIDGE_RESULT_INDEX_PROP,[]).filter(function(id){return id!==item.id});
    props.setProperty(parkingBridgeResultKey_(item.id),JSON.stringify(item));index.push(item.id);
    while(index.length>PARKING_BRIDGE_RESULT_LIMIT){const old=index.shift();if(old)props.deleteProperty(parkingBridgeResultKey_(old))}
    parkingBridgeWritePropJson_(PARKING_BRIDGE_RESULT_INDEX_PROP,index);
  }finally{lock.releaseLock()}
}
function parkingBridgeCommandStatus_(id){
  if(!id)throw new Error('ID de comando no indicado.');
  const result=parkingBridgeReadPropJson_(parkingBridgeResultKey_(id),null);if(result)return result;
  const pending=[].concat(parkingBridgeReadPropJson_(PARKING_BRIDGE_MAIL_QUEUE_PROP,[]),parkingBridgeReadPropJson_(PARKING_BRIDGE_DOC_QUEUE_PROP,[])).find(function(x){return x.id===id});
  return pending?{id:id,state:'PENDING',domain:pending.domain,command:pending.command,createdAt:pending.createdAt}:{id:id,state:'UNKNOWN'};
}

function parkingBridgeTakeCommands_(domain){
  const prop=parkingBridgeQueueProp_(domain),lock=LockService.getScriptLock();lock.waitLock(10000);let batch=[];
  try{const items=parkingBridgeReadPropJson_(prop,[]);batch=items.slice(0,PARKING_BRIDGE_BATCH_SIZE);parkingBridgeWritePropJson_(prop,items.slice(PARKING_BRIDGE_BATCH_SIZE))}finally{lock.releaseLock()}
  return batch;
}

function parkingBridgeRunCommands_(domain,runner){
  const batch=parkingBridgeTakeCommands_(domain),completed=[];
  batch.forEach(function(cmd){
    const started=new Date().getTime();
    try{const result=runner(cmd.command,cmd.args||{});const row={id:cmd.id,domain:domain,command:cmd.command,state:'DONE',ok:true,createdAt:cmd.createdAt,completedAt:parkingBridgeNow_(),durationMs:new Date().getTime()-started,result:result||{}};parkingBridgeSaveResult_(row);completed.push(row)}
    catch(err){const row={id:cmd.id,domain:domain,command:cmd.command,state:'DONE',ok:false,createdAt:cmd.createdAt,completedAt:parkingBridgeNow_(),durationMs:new Date().getTime()-started,error:String((err&&err.message)||err)};parkingBridgeSaveResult_(row);completed.push(row)}
  });
  return completed;
}

function parkingBridgeHeartbeat_(domain,data){
  const key=domain==='mail'?PARKING_BRIDGE_MAIL_HEARTBEAT_PROP:PARKING_BRIDGE_DOC_HEARTBEAT_PROP;
  const value=Object.assign({at:parkingBridgeNow_()},data||{});parkingBridgeWritePropJson_(key,value);return value;
}
function parkingBridgeHeartbeatAgeSec_(row){if(!row||!row.at)return null;const ms=new Date().getTime()-new Date(row.at).getTime();return isNaN(ms)?null:Math.max(0,Math.round(ms/1000))}

function parkingBridgeStatus_(){
  const mailHeartbeat=parkingBridgeReadPropJson_(PARKING_BRIDGE_MAIL_HEARTBEAT_PROP,null),docHeartbeat=parkingBridgeReadPropJson_(PARKING_BRIDGE_DOC_HEARTBEAT_PROP,null),mailQueue=userWelcomeQueueRead_(),mailFailed=userWelcomeFailedRead_(),docQueue=incidentDocumentQueueRead_(),docFailed=incidentDocumentFailedRead_();
  let drive=docHeartbeat&&docHeartbeat.drive?docHeartbeat.drive:null;if(!drive){try{drive=parkingDriveStructureStatus_()}catch(e){drive={ok:false,error:String((e&&e.message)||e)}}}
  return {
    mail:{provider:'Apps Script / Google',detail:'Correo heredado ejecutado por la cuenta remitente mediante bridge seguro.',sender:userWelcomeSenderStatus_(),activeWorkerConfigured:!!userWelcomeActiveTriggerId_(),queue:{pending:mailQueue.length,failed:mailFailed.length},bridgeWorker:{lastHeartbeat:mailHeartbeat,ageSec:parkingBridgeHeartbeatAgeSec_(mailHeartbeat),ready:parkingBridgeHeartbeatAgeSec_(mailHeartbeat)!==null&&parkingBridgeHeartbeatAgeSec_(mailHeartbeat)<180},commandsPending:parkingBridgeReadPropJson_(PARKING_BRIDGE_MAIL_QUEUE_PROP,[]).length},
    documents:{provider:'Google Drive / Docs',detail:'Documentos heredados ejecutados por la cuenta con permisos Drive mediante bridge seguro.',drive:drive,queue:{pending:docQueue.length,failed:docFailed.length},bridgeWorker:{lastHeartbeat:docHeartbeat,ageSec:parkingBridgeHeartbeatAgeSec_(docHeartbeat),ready:parkingBridgeHeartbeatAgeSec_(docHeartbeat)!==null&&parkingBridgeHeartbeatAgeSec_(docHeartbeat)<180},commandsPending:parkingBridgeReadPropJson_(PARKING_BRIDGE_DOC_QUEUE_PROP,[]).length}
  };
}

function parkingBridgeMailRunner_(command,args){
  if(command==='senderMode')return userWelcomeSenderStatus_();
  if(command==='emailStatus')return userWelcomeEmailStatus_();
  if(command==='workerStatus')return userWelcomeWorkerStatus_();
  if(command==='setNoReply'){
    const enabled=!!args.enabled,props=parkingBridgeProps_();if(enabled)props.setProperty(USER_WELCOME_REAL_NOREPLY_PROP,'1');else props.deleteProperty(USER_WELCOME_REAL_NOREPLY_PROP);return {ok:true,enabled:enabled,status:userWelcomeSenderStatus_()};
  }
  if(command==='installWorker')return installUserWelcomeWorker_();
  if(command==='uninstallWorker')return uninstallUserWelcomeWorker_();
  if(command==='retryFailed')return retryFailedUserWelcomeEmails_();
  if(command==='processQueue'){
    const auth=userWelcomeWorkerAuthorization_(null);if(!auth.authorized)throw new Error('La cuenta bridge no es propietaria del worker de correo autorizado. Activa el worker desde esta misma cuenta.');return processUserWelcomeEmailQueue_();
  }
  if(command==='testWelcome')return parkingBridgeTestWelcomeEmail_(parkingBridgeText_(args.email));
  throw new Error('Comando de correo no soportado.');
}

function parkingBridgeTestWelcomeEmail_(email){
  email=lower(email);if(!email||email.indexOf('@')<1)throw new Error('Email de prueba no válido.');
  const auth=userWelcomeWorkerAuthorization_(null);if(!auth.authorized)throw new Error('La cuenta bridge no es propietaria del worker de correo autorizado.');
  const settings=readParkingSettings(),name=settings.NombreOficial||'Parking Comunidad',url=USER_WELCOME_APP_URL,password='Parking12345678',contact=text(settings.EmailContacto),help=contact?'Para cualquier consulta, contactá con Administración: '+contact+'.':'Para cualquier consulta, contactá con Administración.';
  const msg={subject:'PRUEBA · Acceso a '+name,body:'Prueba de correo de acceso.\n\nUsuario: '+email+'\nContraseña de ejemplo: '+password+(url?'\nAcceso: '+url:'')+'\n\nEste es un mensaje automático. Por favor, no respondas a este correo.\n'+help,html:'<div style="font-family:Arial,sans-serif"><h2>'+userWelcomeEscapeHtml_(name)+'</h2><p>Prueba correcta del servicio de correos de acceso.</p><p><b>Usuario:</b> '+userWelcomeEscapeHtml_(email)+'<br><b>Contraseña de ejemplo:</b> '+password+'</p>'+(url?'<p><a href="'+userWelcomeEscapeHtml_(url)+'">Abrir aplicación</a></p>':'')+'<hr><p><b>Mensaje automático:</b> por favor, no respondas a este correo.</p><p>'+userWelcomeEscapeHtml_(help)+'</p></div>'};
  const delivery=sendParkingAccessEmail_(email,msg);return {ok:true,email:email,deliveryMode:delivery.mode,realNoReply:delivery.realNoReply};
}

function parkingBridgeDocumentRunner_(command,args){
  if(command==='workerStatus')return incidentDocumentWorkerStatus_();
  if(command==='installWorker')return installIncidentDocumentWorker_();
  if(command==='uninstallWorker')return uninstallIncidentDocumentWorker_();
  if(command==='configureFolder')return parkingBridgeConfigureDriveFolder_(parkingBridgeText_(args.folder));
  if(command==='verifyDrive'){ensureParkingDriveStructure_();return parkingDriveStructureStatus_()}
  if(command==='testDocs')return parkingBridgeTestDocs_();
  if(command==='generateMissing')return Object.assign({source:'LEGACY_SHEET'},generateMissingIncidentDocs_());
  if(command==='regenerateAll')return Object.assign({source:'LEGACY_SHEET'},queueAllIncidentDocs_());
  if(command==='processQueue')return processIncidentDocumentQueue();
  throw new Error('Comando documental no soportado.');
}

function parkingBridgeConfigureDriveFolder_(raw){
  const id=parkingFileIdFromReference_(raw)||raw;if(!id)throw new Error('Indica el ID o enlace de la carpeta principal.');
  const root=DriveApp.getFolderById(id);['Incidencias','Fotos','Logos'].forEach(function(name){parkingDriveChildFolder_(root,name)});parkingBridgeProps_().setProperty('DRIVE_FOLDER_ID',id);
  return {ok:true,rootId:id,rootName:root.getName(),structure:parkingDriveStructureStatus_()};
}

function parkingBridgeTestDocs_(){
  ensureParkingDriveStructure_();const folder=parkingDriveFolder_('INCIDENTS'),name='PRUEBA_DOCUMENTO_'+Utilities.formatDate(new Date(),'Europe/Madrid','yyyyMMdd_HHmmss'),doc=DocumentApp.create(name),idv=doc.getId();doc.getBody().appendParagraph('Prueba de Google Docs de Parking Comunidad.');doc.saveAndClose();const file=DriveApp.getFileById(idv);file.moveTo(folder);file.setDescription('ParkingComunidad|PruebaDocumento');const url=file.getUrl();file.setTrashed(true);return {ok:true,url:url,trashed:true};
}

function processParkingBridgeMailCommandsWorker(){
  const completed=parkingBridgeRunCommands_('mail',parkingBridgeMailRunner_);let status={};try{status=userWelcomeWorkerStatus_()}catch(e){status={error:String(e)}}parkingBridgeHeartbeat_('mail',{completed:completed.length,status:status});return {ok:true,completed:completed.length,status:status};
}
function processParkingBridgeDocumentCommandsWorker(){
  const completed=parkingBridgeRunCommands_('documents',parkingBridgeDocumentRunner_);let worker={},drive={};try{worker=incidentDocumentWorkerStatus_()}catch(e){worker={error:String(e)}}try{drive=parkingDriveStructureStatus_()}catch(e){drive={ok:false,error:String(e)}}parkingBridgeHeartbeat_('documents',{completed:completed.length,worker:worker,drive:drive});return {ok:true,completed:completed.length,worker:worker,drive:drive};
}

function parkingBridgeTriggers_(handler){try{return ScriptApp.getProjectTriggers().filter(function(t){return t.getHandlerFunction&&t.getHandlerFunction()===handler})}catch(e){return []}}
function parkingBridgeInstallTrigger_(handler){const existing=parkingBridgeTriggers_(handler);existing.forEach(function(t){try{ScriptApp.deleteTrigger(t)}catch(e){}});const trigger=ScriptApp.newTrigger(handler).timeBased().everyMinutes(1).create();return {ok:true,installed:true,removed:existing.length,triggerId:trigger&&trigger.getUniqueId?trigger.getUniqueId():''}}
function parkingBridgeUninstallTrigger_(handler){const existing=parkingBridgeTriggers_(handler);existing.forEach(function(t){try{ScriptApp.deleteTrigger(t)}catch(e){}});return {ok:true,removed:existing.length}}

function parkingBridgeExecutionIdentity_(){
  let email='';
  try{email=Session.getEffectiveUser().getEmail()||''}catch(e){}
  return {email:email||'No disponible',at:parkingBridgeNow_()};
}

function installParkingBridgeMailWorker(){
  const expected=userWelcomeExpectedSenderAccount_(),identity=parkingBridgeExecutionIdentity_(),out=parkingBridgeInstallTrigger_(PARKING_BRIDGE_MAIL_HANDLER);
  let warmup={};
  try{warmup=processParkingBridgeMailCommandsWorker()}catch(e){warmup={ok:false,error:String((e&&e.message)||e)}}
  const result=Object.assign({},out,{worker:'mail',expectedSender:expected,executionIdentity:identity,warmup:warmup});
  console.log(JSON.stringify(result));
  return result;
}

function installParkingBridgeDocumentWorker(){
  const identity=parkingBridgeExecutionIdentity_(),out=parkingBridgeInstallTrigger_(PARKING_BRIDGE_DOC_HANDLER);
  let warmup={};
  try{warmup=processParkingBridgeDocumentCommandsWorker()}catch(e){warmup={ok:false,error:String((e&&e.message)||e)}}
  const result=Object.assign({},out,{worker:'documents',executionIdentity:identity,warmup:warmup});
  console.log(JSON.stringify(result));
  return result;
}

function uninstallParkingBridgeMailWorker(){const out=parkingBridgeUninstallTrigger_(PARKING_BRIDGE_MAIL_HANDLER);console.log(JSON.stringify(out));return out}
function uninstallParkingBridgeDocumentWorker(){const out=parkingBridgeUninstallTrigger_(PARKING_BRIDGE_DOC_HANDLER);console.log(JSON.stringify(out));return out}

function parkingBridgeMailWorkerStatus(){
  const triggers=parkingBridgeTriggers_(PARKING_BRIDGE_MAIL_HANDLER),hb=parkingBridgeReadPropJson_(PARKING_BRIDGE_MAIL_HEARTBEAT_PROP,null),out={installed:triggers.length>0,count:triggers.length,heartbeat:hb,executionIdentity:parkingBridgeExecutionIdentity_()};
  console.log(JSON.stringify(out));return out;
}
function parkingBridgeDocumentWorkerStatus(){
  const triggers=parkingBridgeTriggers_(PARKING_BRIDGE_DOC_HANDLER),hb=parkingBridgeReadPropJson_(PARKING_BRIDGE_DOC_HEARTBEAT_PROP,null),out={installed:triggers.length>0,count:triggers.length,heartbeat:hb,executionIdentity:parkingBridgeExecutionIdentity_()};
  console.log(JSON.stringify(out));return out;
}

function parkingBridgeConfigurationStatus(){
  const configured=!!(parkingBridgeProps_().getProperty(PARKING_BRIDGE_SECRET_PROP)||'');
  const out={ok:true,bridgeVersion:PARKING_BRIDGE_VERSION,secretConfigured:configured,mailWorker:parkingBridgeMailWorkerStatus(),documentWorker:parkingBridgeDocumentWorkerStatus()};
  console.log(JSON.stringify(out));return out;
}

// Alias conservados para no romper instrucciones antiguas. Ya no usan Spreadsheet UI.
function installParkingBridgeMailWorkerUi(){return installParkingBridgeMailWorker()}
function installParkingBridgeDocumentWorkerUi(){return installParkingBridgeDocumentWorker()}
function parkingBridgeMailWorkerStatusUi(){return parkingBridgeMailWorkerStatus()}
function parkingBridgeDocumentWorkerStatusUi(){return parkingBridgeDocumentWorkerStatus()}
function configureParkingLegacyBridgeSecretUi(){
  const configured=!!(parkingBridgeProps_().getProperty(PARKING_BRIDGE_SECRET_PROP)||'');
  const out={ok:configured,secretConfigured:configured,instructions:'Configura PARKING_BRIDGE_SECRET en Configuracion del proyecto > Propiedades del script. El valor debe coincidir con LEGACY_BRIDGE_SECRET de Supabase.'};
  console.log(JSON.stringify(out));return out;
}

