function trendText(t){if(!t)return '';const d=(Number(t.current)||0)-(Number(t.previous)||0);return `${d===0?'=':d>0?'▲':'▼'} ${Math.abs(d)} vs. 30 días anteriores`}
async function globalSearchView(initial=''){
  $('#main').innerHTML=`<section class="hero"><h1>Búsqueda global</h1><p>Busca matrículas, viviendas, propietarios, incidencias y solicitudes.</p></section><section class="card"><form id="global-search-form" class="actions"><input id="global-search-input" class="search" placeholder="Matrícula, vivienda, propietario, incidencia..." value="${esc(initial)}" minlength="2" required><button>Buscar</button></form></section><div id="global-search-results" style="margin-top:1rem"></div>`;
  const run=async()=>{const q=$('#global-search-input').value.trim();if(q.length<2)return;$('#global-search-results').innerHTML='<div class="spinner"></div>';try{const rows=await call('globalSearch',{q});$('#global-search-results').innerHTML=rows.length?`<div class="grid">${rows.map((r,i)=>`<article class="card"><span class="status">${esc(r.type)}</span><h3>${esc(r.title)}</h3><p class="muted">${esc(r.detail||'')}</p><button class="secondary global-result" data-i="${i}">Abrir</button></article>`).join('')}</div>`:'<div class="card empty">No se encontraron resultados.</div>';document.querySelectorAll('.global-result').forEach(b=>b.onclick=()=>openGlobalResult(rows[Number(b.dataset.i)]))}catch(e){err(e)}};
  $('#global-search-form').onsubmit=e=>{e.preventDefault();run()};if(initial)run();
}
function openGlobalResult(r){if(!r)return;if(r.view==='housingDetail'){housingDetailView(r.id);return}if(r.view==='vehicleDetail'){vehicleDetailView(r.id,()=>globalSearchView(r.search||r.title));return}if(r.view==='vehicles'){state.cache.tablePreset={kind:'vehicles',search:r.search||r.title};go('vehicles');return}if(r.view==='incidents'){state.cache.incidentFocus=r.id;go('incidents');return}if(r.view==='requests'){state.cache.requestFocus=r.id;go('requests');return}go(r.view||'dashboard')}

async function housingDetailView(id){
  renderLoading('housing');try{const d=await call('housingDetail',{id}),h=d.housing,o=d.owner||{},vs=d.vehicles||[],incs=d.incidents||[],reqs=d.requests||[];
  $('#main').innerHTML=`<div class="head"><div><h1>${esc(housingShort(h))}</h1><div class="muted">Ficha completa de vivienda</div></div><div class="actions"><button class="secondary" id="hd-back">← Viviendas</button><button id="hd-add">＋ Vehículo</button></div></div>
  <div class="summary-grid"><article class="summary-card"><b>${esc(d.slotsUsed)}</b><span>Slots ocupados</span><small>${esc(d.slotsFree)} libres</small></article><article class="summary-card"><b>${vs.filter(v=>v.Estado==='Activo'&&v.Tipo==='Moto').length}</b><span>Motos activas</span></article><article class="summary-card"><b>${incs.filter(i=>(i.Estado||'Abierta')!=='Cerrada').length}</b><span>Incidencias abiertas</span></article><article class="summary-card"><b>${reqs.filter(r=>r.Estado==='Abierta').length}</b><span>Solicitudes abiertas</span></article></div>
  <section class="card" style="margin-top:1rem"><h2>Propietario</h2><div class="details"><div><small>Nombre</small>${esc(o.Nombre||'Sin responsable')}</div><div><small>Email</small>${esc(o.Email||h.Responsable||'—')}</div><div><small>Estado vivienda</small>${esc(h.Estado)}</div></div></section>
  <section class="card" style="margin-top:1rem"><div class="head"><h2>Vehículos</h2></div><div class="tablebox"><table class="table"><thead><tr><th>Matrícula</th><th>Clase</th><th>Estado</th><th>Slot</th><th>Temporal</th><th></th></tr></thead><tbody>${vs.map((v,i)=>`<tr><td><b>${esc(v.MatriculaHabitual)}</b></td><td>${esc(v.Tipo==='Moto'?'Moto':'Vehículo')}</td><td>${esc(v.Estado)}</td><td>${esc(v.Tipo==='Moto'?'No aplica':v.Slot||'Liberado')}</td><td>${esc(displayCell('vehicles',v,'MatriculaTemporal'))}</td><td><button class="secondary hd-history" data-i="${i}">Historial</button></td></tr>`).join('')}</tbody></table></div></section>
  <section class="grid" style="margin-top:1rem"><article class="card"><h2>Incidencias recientes</h2>${incs.slice(0,10).map(i=>`<div class="attention-item"><div><strong>${esc(i.Tipo)}</strong><span>${esc(i.MatriculaObservada||'')} · ${esc(shortDateTime(i.FechaHora))}</span></div></div>`).join('')||'<div class="empty">Sin incidencias.</div>'}</article><article class="card"><h2>Solicitudes recientes</h2>${reqs.slice(0,10).map(r=>`<div class="attention-item"><div><strong>${esc(requestTypeLabel(r.Tipo))}</strong><span>${esc(r.Estado)} · ${esc(shortDateTime(r.FechaHora))}</span></div></div>`).join('')||'<div class="empty">Sin solicitudes.</div>'}</article></section>`;
  $('#hd-back').onclick=()=>go('housing');$('#hd-add').onclick=()=>{state.cache.tablePreset={kind:'vehicles',filters:{__Vivienda:h.ID_Vivienda}};go('vehicles')};document.querySelectorAll('.hd-history').forEach(b=>b.onclick=()=>vehicleHistoryView(vs[Number(b.dataset.i)].ID_Vehiculo,()=>housingDetailView(id)));
  }catch(e){err(e)}
}

async function vehicleHistoryView(id,backFn=null){
  renderLoading('vehicles');try{const d=await call('vehicleHistory',{id}),v=d.vehicle,events=d.events||[];$('#main').innerHTML=`<div class="head"><div><h1>Historial · ${esc(v.MatriculaHabitual)}</h1><div class="muted">${esc(v.Marca||'')} ${esc(v.Modelo||'')} · ${esc(v.Estado)}</div></div><button class="secondary" id="vh-back">Volver</button></div><section class="card"><div class="details"><div><small>Clase</small>${esc(v.Tipo==='Moto'?'Moto':'Vehículo')}</div><div><small>Slot</small>${esc(v.Tipo==='Moto'?'No aplica':v.Slot||'Liberado')}</div><div><small>QR</small>${esc(v.Tipo==='Moto'?'No aplica':v.QR_Estado||'—')}</div><div><small>Temporal actual</small>${esc(v.PeriodoTemporalActual?.MatriculaTemporal||'—')}</div></div></section><section class="card" style="margin-top:1rem"><h2>Línea de tiempo</h2>${events.map(e=>`<div class="attention-item"><div><strong>${esc(e.type)} · ${esc(e.title)}</strong><span>${esc(shortDateTime(e.date))}${e.user?' · '+esc(e.user):''}<br>${esc(e.detail||'')}</span></div></div>`).join('')||'<div class="empty">No hay movimientos registrados.</div>'}</section>`;$('#vh-back').onclick=backFn||(()=>go('vehicles'))}catch(e){err(e)}
}

function selectedVehicleIds(){return [...document.querySelectorAll('.bulk-vehicle:checked')].map(x=>x.value)}
async function runBulkVehicleAction(action){
  const ids=selectedVehicleIds();if(!ids.length){toast('Selecciona al menos un vehículo.',true);return}
  try{const p=await call('bulkVehiclePreview',{ids,action}),label={SUSPENDER:'Suspender',BAJA:'Dar de baja',REVOCAR_QR:'Revocar QR'}[action]||action;
    const lines=[`${p.selected} seleccionado(s): ${p.cars} vehículo(s) con slot y ${p.motos} moto(s).`];
    if(p.stateChanges)lines.push(`${p.stateChanges} cambiarán de estado.`);if(p.slotsReleased)lines.push(`${p.slotsReleased} slot(s) serán liberados.`);if(p.qrRevoked)lines.push(`${p.qrRevoked} QR serán revocados.`);if(p.qrRemoved)lines.push(`${p.qrRemoved} QR dejarán de estar asignados.`);if(p.temporalsAnnulled)lines.push(`${p.temporalsAnnulled} temporal(es) vigente(s) serán anulados.`);if(p.qrSkippedMotos)lines.push(`${p.qrSkippedMotos} moto(s) se omitirán porque no usan QR.`);
    if(!confirm(`${label}\n\n${lines.join('\n')}\n\n¿Confirmar operación?`))return;
    const out=await call('bulkVehicleAction',{ids,action});invalidateClientParkingData();toast(`${out.changed} vehículo(s) actualizados.`);manager('vehicles')
  }catch(e){err(e)}
}

function exportRowsFromCurrent(kind,rows,format='xlsx'){const filtered=state.cache.currentFilteredRows||rows||[],date=new Date().toISOString().slice(0,10);if(format==='csv')downloadCsv(`parking_${kind}_${date}.csv`,filtered);else return downloadXlsx(`parking_${kind}_${date}.xlsx`,filtered,null,kind).catch(err)}


async function consistencyReviewView(){
  renderLoading('dataReview');try{const d=await call('consistencyReport'),items=d.items||[];
  $('#main').innerHTML=`<div class="head"><div><h1>Revisión de datos</h1><div class="muted">Solo muestra incoherencias de datos. Los pendientes operativos se gestionan desde Resumen.</div></div><button class="secondary" id="review-refresh">Revisar nuevamente</button></div><div class="summary-grid"><article class="summary-card ${d.errors?'alert':''}"><b>${esc(d.errors)}</b><span>Errores de integridad</span></article><article class="summary-card ${d.warnings?'alert':''}"><b>${esc(d.warnings)}</b><span>Inconsistencias</span></article><article class="summary-card"><b>${esc(items.length)}</b><span>Total detectado</span></article></div><section class="card" style="margin-top:1rem"><div class="tablebox compact-table"><table class="table"><thead><tr><th>Nivel</th><th>Comprobación</th><th>Detalle</th><th>Acción</th></tr></thead><tbody>${items.map((x,i)=>{const fix=['MOTO_CON_SLOT','MOTO_QR_ACTIVO','TEMPORAL_NO_ACTIVO','MATRICULA_DUPLICADA'].includes(x.code);return `<tr><td><span class="status ${x.severity==='Error'?'bad':''}">${esc(x.severity)}</span></td><td><b>${esc(x.label)}</b><span class="subtle">${esc(x.code)}</span></td><td>${esc(x.detail||'—')}</td><td><div class="actions"><button class="secondary review-open" data-i="${i}">Ir al registro</button>${fix?`<button class="review-fix" data-i="${i}">Corregir</button>`:''}</div></td></tr>`}).join('')}</tbody></table>${items.length?'':'<div class="empty">No se detectaron inconsistencias.</div>'}</div></section>`;
  $('#review-refresh').onclick=consistencyReviewView;document.querySelectorAll('.review-open').forEach(b=>b.onclick=()=>openConsistencyItem(items[Number(b.dataset.i)]));document.querySelectorAll('.review-fix').forEach(b=>b.onclick=async()=>{const x=items[Number(b.dataset.i)],msg={MOTO_CON_SLOT:'Quitar el slot asignado a esta moto',MOTO_QR_ACTIVO:'Revocar el QR de esta moto',TEMPORAL_NO_ACTIVO:'Anular el temporal vigente',MATRICULA_DUPLICADA:'Consolidar los registros duplicados de esta matrícula (se creará backup)'}[x.code]||'Aplicar corrección';if(!confirm(`${msg}.\n\nSe registrará en Auditoría. ¿Continuar?`))return;busy(b);try{const out=await call('consistencyFix',{code:x.code,vehicleId:x.vehicleId});invalidateClientParkingData();toast(out.message||'Corrección aplicada.');consistencyReviewView()}catch(e){err(e);busy(b,false)}});
  }catch(e){err(e)}
}
function openConsistencyItem(x){if(!x)return;if(x.view==='requests'){go('requests');return}if(x.view==='incidents'){go('incidents');return}if(x.housingId&&x.view==='housing'){housingDetailView(x.housingId);return}if(x.vehicleId){state.cache.tablePreset={kind:'vehicles',search:''};go('vehicles');setTimeout(()=>{const input=$('#table-search');if(input){input.value=x.vehicleId;input.dispatchEvent(new Event('input'))}},50);return}go('vehicles')}

function replaceVehicleView(v){
  const host=$('#editor');if(!host)return;host.innerHTML=`<form class="card form" id="replace-vehicle-form"><h2 class="wide">Reemplazar vehículo · ${esc(v.MatriculaHabitual)}</h2><div class="message wide">El vehículo actual pasará a <b>Baja</b>, su QR quedará revocado y cualquier temporal vigente será anulado. El nuevo vehículo conservará la misma vivienda. Si corresponde, conservará el slot liberado.</div><div class="field"><label>Nueva matrícula habitual</label><input name="MatriculaHabitual" required></div><div class="field"><label>Tipo</label><select name="Tipo">${['Particular','Empresa','Alquiler','Moto','Otro'].map(x=>`<option ${x===v.Tipo?'selected':''}>${x}</option>`).join('')}</select></div><div class="field"><label>Marca</label><input name="Marca"></div><div class="field"><label>Modelo</label><input name="Modelo"></div><div class="field wide"><label>Observaciones</label><textarea name="Observaciones"></textarea></div><div class="wide actions"><button>Revisar y reemplazar</button><button type="button" class="secondary" id="replace-cancel">Cancelar</button></div></form>`;
  $('#replace-cancel').onclick=()=>host.innerHTML='';$('#replace-vehicle-form').onsubmit=async e=>{e.preventDefault();const data=Object.fromEntries(new FormData(e.target)),moto=data.Tipo==='Moto',slotText=v.Tipo==='Moto'&&!moto?'Se asignará el primer slot libre disponible.':v.Tipo!=='Moto'&&!moto?`El nuevo vehículo conservará el Slot ${v.Slot}.`:'No utilizará slot.';if(!confirm(`REEMPLAZO DE VEHÍCULO\n\nAnterior: ${v.MatriculaHabitual} → Baja\nNuevo: ${data.MatriculaHabitual}\n${slotText}\n${v.PeriodoTemporalActual?'El temporal vigente será anulado.\n':''}\n¿Confirmar?`))return;const b=e.submitter;busy(b);try{const out=await call('replaceVehicle',Object.assign({ID_Vehiculo:v.ID_Vehiculo},data));invalidateClientParkingData();toast(`Vehículo reemplazado por ${out.newVehicle.MatriculaHabitual}.`);manager('vehicles')}catch(x){toast(x.message,true);busy(b,false)}};host.scrollIntoView({behavior:'smooth'})
}


async function vehicleDetailView(id,backFn=null){
  renderLoading('vehicles');
  try{
    const data=await call('managerData',{kind:'vehicles'}),v=(data.rows||[]).find(x=>x.ID_Vehiculo===id);if(!v)throw new Error('Vehículo no encontrado.');
    state.cache.vehicles=data.rows||[];if(data.options)state.cache.formOptions=data.options;state.cache.adminRequests=data.requests||[];state.cache.adminIncidents=data.incidents||[];
    const h=(data.options?.housing||[]).find(x=>x.ID_Vivienda===v.ID_Vivienda),isMoto=v.Tipo==='Moto',temp=v.PeriodoTemporalActual,requestStat=(data.requestStats&&data.requestStats[v.ID_Vehiculo])||{total:0,open:0,history:0,lastAt:'',lastType:'',lastState:''};
    $('#main').innerHTML=`<div class="head"><div><h1>${esc(v.MatriculaHabitual)}</h1><div class="muted">Ficha del vehículo · ${esc(h?housingShort(h):v.ID_Vivienda||'')}</div></div><button class="secondary" id="vd-back">Volver</button></div>
      <section class="card"><div class="details"><div><small>Clase / tipo</small>${esc(isMoto?'Moto':v.Tipo||'Vehículo')}</div><div><small>Estado</small>${esc(v.Estado)}</div><div><small>Slot</small>${esc(isMoto?'No aplica':v.Slot||'Liberado')}</div><div><small>QR</small>${esc(isMoto?'No aplica':v.QR_Estado||'—')}</div><div><small>Marca/modelo</small>${esc([v.Marca,v.Modelo].filter(Boolean).join(' ')||'—')}</div><div><small>Temporal vigente</small>${temp?`${esc(temp.MatriculaTemporal)} · hasta ${esc(dateEs(temp.Hasta))}`:'—'}</div></div>
      <div class="actions" style="margin-top:1rem"><button id="vd-edit">Editar</button><button class="secondary" id="vd-temporals">Temporales</button>${!isMoto?`<button class="secondary" id="vd-qr">QR</button>`:''}<button class="secondary" id="vd-history">Historial</button>${v.Estado==='Activo'?`<button class="secondary" id="vd-suspend">Suspender</button><button class="danger" id="vd-low">Dar de baja</button>`:''}<button class="secondary" id="vd-replace">Reemplazar</button></div></section>
      <section class="card vehicle-request-dossier-summary" style="margin-top:1rem"><div class="head"><div><h2>Solicitudes</h2><div class="muted">Expediente de solicitudes asociado a este vehículo.</div></div>${requestStat.total?'<button class="secondary" id="vd-requests">Ver expediente</button>':'<button class="secondary" id="vd-requests">Abrir Solicitudes</button>'}</div><div class="request-dossier-metrics vehicle-request-metrics"><div><b>${requestStat.open||0}</b><span>Abiertas</span></div><div><b>${requestStat.history||0}</b><span>Históricas</span></div><div><b>${requestStat.total||0}</b><span>Total</span></div><div><b>${requestStat.lastAt?esc(shortDateTime(requestStat.lastAt)):'—'}</b><span>Última actividad</span></div></div>${requestStat.total?`<div class="message"><b>Última solicitud:</b> ${esc(requestTypeLabel(requestStat.lastType))} · <span class="status ${['Abierta','Pendiente'].includes(requestStat.lastState)?'bad':''}">${esc(['Abierta','Pendiente'].includes(requestStat.lastState)?'Abierta':requestStat.lastState||'—')}</span></div>`:'<div class="empty compact">Este vehículo todavía no tiene solicitudes registradas.</div>'}</section><div id="editor" style="margin-top:1rem"></div>`;
    $('#vd-back').onclick=backFn||(()=>go('vehicles'));$('#vd-edit').onclick=()=>vehicleEditor(v);$('#vd-temporals').onclick=()=>temporaryPeriodsPanel(v,()=>vehicleDetailView(v.ID_Vehiculo,backFn));$('#vd-history').onclick=()=>vehicleHistoryView(v.ID_Vehiculo,()=>vehicleDetailView(v.ID_Vehiculo,backFn));$('#vd-replace').onclick=()=>replaceVehicleView(v);
    $('#vd-requests').onclick=()=>{if(requestStat.total){state.cache.requestViewMode='dossiers';state.cache.requestDossierFocus=`vehicle:${v.ID_Vehiculo}`}go('requests')};
    if($('#vd-qr'))$('#vd-qr').onclick=()=>showQr(v,()=>vehicleDetailView(v.ID_Vehiculo,backFn));
    if($('#vd-suspend'))$('#vd-suspend').onclick=()=>quickVehicleState(v,'Suspendido',backFn);if($('#vd-low'))$('#vd-low').onclick=()=>quickVehicleState(v,'Baja',backFn);
  }catch(e){err(e)}
}
async function quickVehicleState(v,newState,backFn){const impact=[newState==='Suspendido'?'El vehículo quedará suspendido.':'El vehículo será dado de baja.',v.Tipo==='Moto'?'No ocupa slot.':v.Slot?`Se liberará el Slot ${v.Slot}.`:'',v.Tipo==='Moto'?'':'El vehículo quedará sin QR asignado.',v.PeriodoTemporalActual?`Se anulará el temporal ${v.PeriodoTemporalActual.MatriculaTemporal}.`:''].filter(Boolean).join('\n');if(!confirm(`${impact}\n\n¿Confirmar?`))return;try{await call('saveVehicle',Object.assign({},v,{Estado:newState}));invalidateClientParkingData();toast(`Vehículo ${newState.toLowerCase()}.`);vehicleDetailView(v.ID_Vehiculo,backFn)}catch(e){err(e)}}


// 1.2.12 - ficha operativa de vivienda
async function housingDetailView(id){
  renderLoading('housing');try{const d=await call('housingDetail',{id}),h=d.housing,o=d.owner||{},vs=d.vehicles||[],incs=d.incidents||[],reqs=d.requests||[];
  const openInc=incs.filter(x=>(x.Estado||'Abierta')!=='Cerrada'),pendingReq=reqs.filter(x=>x.Estado==='Abierta'),tmp=vs.filter(v=>v.PeriodoTemporalActual),slotVehicle=n=>vs.find(v=>v.Estado==='Activo'&&v.Tipo!=='Moto'&&String(v.Slot)===String(n));
  const slotCard=n=>{const v=slotVehicle(n);return `<article class="summary-card clickable hd-slot" data-plate="${esc(v?.MatriculaHabitual||'')}"><b>${v?esc(v.MatriculaHabitual):'Libre'}</b><span>Slot ${n}</span><small>${v?esc(v.Estado):'Disponible'}</small></article>`};
  $('#main').innerHTML=`<div class="head"><div><h1>${esc(housingShort(h))}</h1><div class="muted">Ficha operativa de vivienda</div></div><div class="actions"><button class="secondary" id="hd-back">← Viviendas</button><button id="hd-add">＋ Vehículo</button></div></div>
  <div class="summary-grid">${slotCard(1)}${slotCard(2)}<button class="summary-card clickable" id="hd-inc"><b>${openInc.length}</b><span>Incidencias abiertas</span><small>Ver incidencias</small></button><button class="summary-card clickable" id="hd-req"><b>${pendingReq.length}</b><span>Solicitudes abiertas</span><small>Ver solicitudes</small></button><article class="summary-card"><b>${tmp.length}</b><span>Temporales vigentes</span></article></div>
  <section class="card" style="margin-top:1rem"><h2>Vivienda y propietario</h2><div class="details"><div><small>Vivienda</small>${esc(housingShort(h))}</div><div><small>Estado</small>${esc(h.Estado||'—')}</div><div><small>Responsable</small>${esc(o.Nombre||'Sin responsable')}</div><div><small>Email</small>${esc(o.Email||h.Responsable||'—')}</div></div></section>
  <section class="card" style="margin-top:1rem"><div class="head"><h2>Vehículos registrados</h2><button class="secondary" id="hd-open-vehicles">Abrir en Vehículos</button></div><div class="tablebox compact-table"><table class="table responsive-data-table"><thead><tr><th>Habitual</th><th>Temporal</th><th>Vigencia</th><th>Clase</th><th>Estado</th><th>Slot</th><th>QR</th></tr></thead><tbody>${vs.map(v=>`<tr><td data-label="Habitual"><b>${esc(v.MatriculaHabitual||'—')}</b></td><td data-label="Temporal">${esc(v.PeriodoTemporalActual?.MatriculaTemporal||'—')}</td><td data-label="Vigencia">${v.PeriodoTemporalActual?`${esc(dateEs(v.PeriodoTemporalActual.Desde))} → ${esc(dateEs(v.PeriodoTemporalActual.Hasta))}`:'—'}</td><td data-label="Clase">${v.Tipo==='Moto'?'Moto':'Vehículo'}</td><td data-label="Estado">${esc(v.Estado||'—')}</td><td data-label="Slot">${esc(v.Tipo==='Moto'?'No aplica':v.Slot||'Sin slot')}</td><td data-label="QR">${esc(v.Tipo==='Moto'?'No aplica':v.QR_Estado||'—')}</td></tr>`).join('')}</tbody></table></div></section>`;
  $('#hd-back').onclick=()=>go('housing');$('#hd-add').onclick=()=>{state.cache.tablePreset={kind:'vehicles',filters:{__Vivienda:h.ID_Vivienda}};go('vehicles')};$('#hd-open-vehicles').onclick=$('#hd-add').onclick;
  $('#hd-inc').onclick=()=>{state.cache.incidentPreset={housingId:h.ID_Vivienda,status:'Abierta'};go('incidents')};$('#hd-req').onclick=()=>{state.cache.requestPreset={housingId:h.ID_Vivienda,status:'Abierta'};go('requests')};
  document.querySelectorAll('.hd-slot').forEach(x=>x.onclick=()=>{if(!x.dataset.plate)return;state.cache.tablePreset={kind:'vehicles',search:x.dataset.plate};go('vehicles')});
  }catch(e){err(e)}
}


// 1.2.12.2 - ficha de vivienda unificada; Vehículos reutiliza la pantalla principal filtrada
async function housingDetailView(id){
  renderLoading('housing');
  try{
    const d=await call('housingDetail',{id}),h=d.housing,o=d.owner||{},vs=d.vehicles||[],incs=d.incidents||[],reqs=d.requests||[];
    const openInc=incs.filter(x=>(x.Estado||'Abierta')!=='Cerrada');
    const pendingReq=reqs.filter(x=>x.Estado==='Abierta');
    const tmp=vs.filter(v=>v.PeriodoTemporalActual);
    const activeSlots=vs.filter(v=>v.Estado==='Activo'&&v.Tipo!=='Moto'&&['1','2'].includes(String(v.Slot||'')));
    const motos=vs.filter(v=>v.Estado==='Activo'&&v.Tipo==='Moto');
    const slot=n=>activeSlots.find(v=>String(v.Slot)===String(n));
    const card=(value,label,detail='',action='',alert=false)=>`<article class="summary-card ${action?'clickable':''} ${alert?'alert':''}" ${action?`data-hd-action="${action}"`:''}><b>${esc(value)}</b><span>${esc(label)}</span>${detail?`<small>${esc(detail)}</small>`:''}</article>`;
    $('#main').innerHTML=`<div class="head"><div><h1>${esc(housingShort(h))}</h1><div class="muted">Ficha operativa de vivienda</div></div><div class="actions"><button class="secondary" id="hd-back">← Viviendas</button><button id="hd-add">＋ Vehículo</button></div></div>
      <section class="summary-section"><div class="head"><h2>Estado general</h2></div><div class="summary-grid">
        ${card(slot(1)?.MatriculaHabitual||'Libre','Slot 1',slot(1)?.Estado||'Disponible','slot1')}
        ${card(slot(2)?.MatriculaHabitual||'Libre','Slot 2',slot(2)?.Estado||'Disponible','slot2')}
        ${card(vs.length,'Vehículos registrados',`${activeSlots.length}/2 slots ocupados · ${motos.length} moto${motos.length===1?'':'s'}`,'vehicles')}
        ${card(tmp.length,'Temporales vigentes','Ver vehículos','vehicles')}
      </div></section>
      <section class="summary-section"><div class="head"><h2>Pendientes</h2></div><div class="summary-grid">
        ${card(openInc.length,'Incidencias abiertas','Pendientes de resolución','incidents',openInc.length>0)}
        ${card(pendingReq.length,'Solicitudes abiertas','Requieren revisión','requests',pendingReq.length>0)}
      </div></section>
      <section class="card housing-detail-card"><div class="head"><h2>Vivienda y propietario</h2></div><div class="details">
        <div><small>Vivienda</small>${esc(housingShort(h))}</div><div><small>Estado</small>${esc(h.Estado||'—')}</div><div><small>Responsable</small>${esc(o.Nombre||'Sin responsable')}</div><div><small>Email</small>${esc(o.Email||h.Responsable||'—')}</div>
      </div><div class="actions" style="margin-top:1rem"><button class="secondary" id="hd-open-vehicles">Abrir vehículos de esta vivienda</button></div></section>`;
    const openVehicles=()=>{state.cache.tablePreset={kind:'vehicles',filters:{__Vivienda:h.ID_Vivienda}};go('vehicles')};
    $('#hd-back').onclick=()=>go('housing');
    $('#hd-add').onclick=openVehicles;
    $('#hd-open-vehicles').onclick=openVehicles;
    document.querySelectorAll('[data-hd-action]').forEach(el=>el.onclick=()=>{
      const a=el.dataset.hdAction;
      if(a==='vehicles'){openVehicles();return}
      if(a==='incidents'){state.cache.incidentPreset={housingId:h.ID_Vivienda,status:'Abierta'};go('incidents');return}
      if(a==='requests'){state.cache.requestPreset={housingId:h.ID_Vivienda,status:'Abierta'};go('requests');return}
      if(a==='slot1'||a==='slot2'){const v=slot(a==='slot1'?1:2);if(v){state.cache.tablePreset={kind:'vehicles',filters:{__Vivienda:h.ID_Vivienda},search:v.MatriculaHabitual||''};go('vehicles')}}
    });
  }catch(e){err(e)}
}

// 1.2.12.4 - búsqueda global desde cabecera + configuración ADMIN
function closeGlobalSearchOverlay(){document.querySelector('#global-search-overlay')?.remove()}
async function openGlobalSearchOverlay(initial=''){
  closeGlobalSearchOverlay();
  const overlay=document.createElement('div');overlay.id='global-search-overlay';overlay.className='global-search-overlay';
  overlay.innerHTML=`<section class="global-search-dialog" role="dialog" aria-modal="true" aria-label="Búsqueda global"><div class="global-search-head"><div><h2>Buscar</h2><p class="muted">Matrículas, viviendas, propietarios, incidencias y solicitudes.</p></div><button type="button" class="secondary compact" id="global-search-close">Cerrar</button></div><form id="global-search-modal-form" class="global-search-form"><input id="global-search-modal-input" class="search" autocomplete="off" placeholder="Matrícula, vivienda, propietario, incidencia…" value="${esc(initial)}" minlength="2" required><button>Buscar</button></form><div id="global-search-modal-results" class="global-search-modal-results"><div class="empty">Escribe al menos 2 caracteres.</div></div></section>`;
  document.body.appendChild(overlay);
  const input=overlay.querySelector('#global-search-modal-input'),results=overlay.querySelector('#global-search-modal-results');
  const run=async()=>{const q=input.value.trim();if(q.length<2){results.innerHTML='<div class="empty">Escribe al menos 2 caracteres.</div>';return}results.innerHTML='<div class="spinner"></div>';try{const rows=await call('globalSearch',{q});results.innerHTML=rows.length?rows.map((r,i)=>`<button type="button" class="global-search-row" data-i="${i}"><span class="status">${esc(r.type)}</span><span class="global-search-row-main"><b>${esc(r.title)}</b><small>${esc(r.detail||'')}</small></span><span aria-hidden="true">›</span></button>`).join(''):'<div class="empty">No se encontraron resultados.</div>';results.querySelectorAll('.global-search-row').forEach(b=>b.onclick=()=>{const r=rows[Number(b.dataset.i)];closeGlobalSearchOverlay();openGlobalResult(r)})}catch(e){results.innerHTML=`<div class="message bad">${esc(e.message||e)}</div>`}};
  overlay.querySelector('#global-search-close').onclick=closeGlobalSearchOverlay;
  overlay.addEventListener('click',e=>{if(e.target===overlay)closeGlobalSearchOverlay()});
  overlay.querySelector('#global-search-modal-form').onsubmit=e=>{e.preventDefault();run()};
  document.addEventListener('keydown',function escClose(e){if(e.key==='Escape'){closeGlobalSearchOverlay();document.removeEventListener('keydown',escClose)}});
  requestAnimationFrame(()=>input.focus());if(initial)run();
}


function colorHex(r,g,b){return '#'+[r,g,b].map(v=>Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0')).join('')}
function colorMix(a,b,t){
  const p=x=>[parseInt(x.slice(1,3),16),parseInt(x.slice(3,5),16),parseInt(x.slice(5,7),16)],A=p(a),B=p(b);
  return colorHex(A[0]+(B[0]-A[0])*t,A[1]+(B[1]-A[1])*t,A[2]+(B[2]-A[2])*t)
}
function colorDistance(a,b){return Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2])}
async function suggestColorsFromLogo(url){
  if(!url)throw new Error('Primero indica la URL del logo.');
  const img=new Image();img.crossOrigin='anonymous';img.referrerPolicy='no-referrer';
  await new Promise((ok,ko)=>{img.onload=ok;img.onerror=()=>ko(new Error('No se pudo cargar el logo para analizar sus colores.'));img.src=url+(url.includes('?')?'&':'?')+'_color='+Date.now()});
  const c=document.createElement('canvas'),ctx=c.getContext('2d',{willReadFrequently:true}),size=96;c.width=size;c.height=size;
  const s=Math.min(size/img.naturalWidth,size/img.naturalHeight),w=img.naturalWidth*s,h=img.naturalHeight*s;
  ctx.clearRect(0,0,size,size);ctx.drawImage(img,(size-w)/2,(size-h)/2,w,h);
  let data;try{data=ctx.getImageData(0,0,size,size).data}catch(e){throw new Error('El servidor del logo no permite analizar sus colores. Prueba con otra URL de imagen.');}
  const bins=new Map();
  for(let i=0;i<data.length;i+=16){
    const a=data[i+3];if(a<100)continue;let r=data[i],g=data[i+1],b=data[i+2];
    const max=Math.max(r,g,b),min=Math.min(r,g,b),sat=max-min,lum=(r+g+b)/3;
    if(lum>242||lum<18||sat<16)continue;
    r=Math.round(r/24)*24;g=Math.round(g/24)*24;b=Math.round(b/24)*24;
    const k=`${r},${g},${b}`,v=bins.get(k)||{rgb:[r,g,b],count:0,sat:0};v.count++;v.sat+=sat;bins.set(k,v);
  }
  const ranked=[...bins.values()].map(v=>({...v,score:v.count*(1+Math.min(1,v.sat/Math.max(1,v.count)/90))})).sort((a,b)=>b.score-a.score);
  if(!ranked.length)throw new Error('No se detectaron colores suficientes en el logo.');
  const mainRgb=ranked[0].rgb,main=colorHex(...mainRgb);
  const alt=ranked.find(v=>colorDistance(v.rgb,mainRgb)>95);
  let secondary=alt?colorHex(...alt.rgb):colorMix(main,'#102f2d',0.68);
  const secRgb=[parseInt(secondary.slice(1,3),16),parseInt(secondary.slice(3,5),16),parseInt(secondary.slice(5,7),16)];
  const secLum=(secRgb[0]*299+secRgb[1]*587+secRgb[2]*114)/1000;
  if(secLum>145)secondary=colorMix(main,'#102f2d',0.72);
  const accent=colorMix(main,'#ffffff',0.86);
  return {ColorPrincipal:main,ColorSecundario:secondary,ColorAcento:accent};
}

async function logoFileData(file){
  if(!file)throw new Error('Selecciona una imagen.');
  if(!/^image\/(png|jpe?g|webp|gif)$/i.test(file.type||''))throw new Error('Usa un archivo PNG, JPG, WEBP o GIF.');
  if(file.size>6*1024*1024)throw new Error('El archivo original no puede superar 6 MB.');
  try{
    const bitmap=await createImageBitmap(file),max=1200,scale=Math.min(1,max/Math.max(bitmap.width,bitmap.height));
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
    const ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);if(bitmap.close)bitmap.close();
    let data=canvas.toDataURL('image/png');
    if(data.length>4*1024*1024)data=canvas.toDataURL('image/webp',.9);
    if(data.length>4*1024*1024)throw new Error('El logo sigue siendo demasiado grande después de optimizarlo.');
    return data;
  }catch(e){
    if(e&&/demasiado grande/.test(e.message||''))throw e;
    return fileData(file);
  }
}
async function configurationView(initialTab='identity'){
  renderLoading('config');
  try{
    const editable=canConfigure();
    const systemAccess=canViewSystem();
    if(!editable)initialTab='data';
    if(initialTab==='system'&&!systemAccess)initialTab=editable?'identity':'data';
    const s=editable?await call('getSettings'):appSettings();
    $('#main').innerHTML=`<div class="head"><div><div class="eyebrow">CONFIGURACIÓN</div><h1>Configuración</h1><div class="muted">${systemAccess?'Identidad, carga inicial de datos y estado técnico del sistema.':editable?'Identidad y carga inicial de viviendas y propietarios.':'Carga inicial de viviendas y propietarios.'}</div></div></div>
      <div class="config-tabs" role="tablist" aria-label="Configuración">
        ${editable?'<button type="button" class="config-tab" data-config-tab="identity">Identidad</button>':''}
        <button type="button" class="config-tab" data-config-tab="data">Datos</button>
        ${systemAccess?'<button type="button" class="config-tab" data-config-tab="system">Sistema</button>':''}
      </div>
      <div id="config-panel"></div>`;
    const panel=$('#config-panel'),tabs=[...document.querySelectorAll('[data-config-tab]')];
    const setActive=tab=>tabs.forEach(b=>b.classList.toggle('active',b.dataset.configTab===tab));

    async function renderIdentity(){
      if(!editable)return renderData();
      setActive('identity');
      panel.innerHTML=`<form id="configuration-form" class="settings-layout">
        <section class="card settings-main"><h2>Identidad de la comunidad</h2><p class="muted">Datos generales e identidad visual. Los cambios se aplican al login y a la cabecera.</p><div class="form">
          <div class="field"><label>Nombre oficial</label><input name="NombreOficial" value="${esc(s.NombreOficial||'Parking Comunidad')}" required></div>
          <div class="field"><label>Descripción</label><input name="Descripcion" value="${esc(s.Descripcion||s.NombreCorto||'Gestión de acceso y parking de la comunidad')}" placeholder="Gestión de acceso y parking de la comunidad"></div>
          <div class="field"><label>Correo de contacto</label><input type="email" name="EmailContacto" value="${esc(s.EmailContacto||'')}"></div>
          <div class="field"><label>Dirección</label><input name="Direccion" value="${esc(s.Direccion||'')}"></div>
          <div class="field wide"><label>URL del logo <span class="muted">(opcional)</span></label><input name="LogoUrl" id="settings-logo-url" type="url" value="${esc(s.LogoUrl||'')}" placeholder="Puedes pegar una URL o subir un archivo desde el panel de Logo"></div>
        </div><hr><h3>Incidencias</h3><p class="muted">La prioridad sube automáticamente según la cantidad de intentos diarios registrados. El intento inicial cuenta como 1.</p><div class="form incident-thresholds"><div class="field"><label>Atención desde</label><input type="number" min="2" name="IncidenciaAtencionDesde" value="${esc(s.IncidenciaAtencionDesde||3)}"></div><div class="field"><label>Alta desde</label><input type="number" min="3" name="IncidenciaAltaDesde" value="${esc(s.IncidenciaAltaDesde||5)}"></div><div class="field"><label>Crítica desde</label><input type="number" min="4" name="IncidenciaCriticaDesde" value="${esc(s.IncidenciaCriticaDesde||7)}"></div></div></section>
        <aside class="settings-side">
          <section class="card settings-logo"><h2>Logo</h2><p class="muted">Puedes subir una imagen desde tu equipo o utilizar una URL. Se usa en el login y en la cabecera.</p><div class="settings-logo-preview" id="settings-logo-preview">${s.LogoUrl?`<img src="${esc(s.LogoUrl)}" alt="Logo de la comunidad">`:'<span>Sin logo</span>'}</div><div class="settings-logo-actions"><label class="button-like secondary" for="settings-logo-file">Elegir logo</label><input id="settings-logo-file" type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden><button type="button" class="danger-link" id="settings-logo-remove">Quitar</button></div><div class="muted settings-logo-hint" id="settings-logo-hint">PNG, JPG, WEBP o GIF. Máximo 6 MB.</div></section>
          <section class="card settings-colors"><h2>Colores</h2><p class="muted">Puedes elegirlos manualmente o sugerirlos automáticamente a partir del logo.</p>${[['ColorPrincipal','Principal',s.ColorPrincipal||'#087f6b'],['ColorSecundario','Secundario',s.ColorSecundario||'#0d302f'],['ColorAcento','Acento',s.ColorAcento||'#e1f2ef']].map(([n,l,v])=>`<div class="color-setting"><label>${l}</label><div><input type="color" data-color-name="${n}" value="${esc(v)}"><input name="${n}" data-color-text="${n}" value="${esc(v)}" maxlength="7" pattern="#[0-9A-Fa-f]{6}"></div></div>`).join('')}<button type="button" class="secondary settings-color-suggest" id="settings-colors-suggest">Sugerir desde logo</button><div class="muted settings-color-hint" id="settings-color-hint">La sugerencia no se guarda hasta pulsar “Guardar configuración”.</div></section>
        </aside><div class="settings-save"><button type="submit">Guardar configuración</button></div>
      </form>`;
      const form=$('#configuration-form'),logo=$('#settings-logo-url'),preview=$('#settings-logo-preview');
      logo.addEventListener('input',()=>{const u=logo.value.trim();preview.innerHTML=u?`<img src="${esc(u)}" alt="Logo de la comunidad" onerror="this.parentElement.innerHTML='<span>Logo no disponible</span>'">`:'<span>Sin logo</span>'});
      const logoFile=$('#settings-logo-file'),logoRemove=$('#settings-logo-remove'),logoHint=$('#settings-logo-hint');
      if(logoFile)logoFile.onchange=async e=>{const file=e.target.files&&e.target.files[0];if(!file)return;const choose=document.querySelector('label[for="settings-logo-file"]');busy(choose);try{if(logoHint)logoHint.textContent='Optimizando y subiendo logo…';const dataUrl=await logoFileData(file);preview.innerHTML=`<img src="${dataUrl}" alt="Vista previa del logo">`;const out=await call('uploadLogo',{dataUrl});logo.value=out.url||'';preview.innerHTML=`<img src="${esc(out.url||'')}" alt="Logo de la comunidad">`;if(logoHint)logoHint.textContent='Logo subido. Pulsa “Guardar configuración” para aplicarlo.';toast('Logo subido correctamente.')}catch(x){toast(x.message||x,true);if(logoHint)logoHint.textContent='No se pudo subir el logo.'}finally{busy(choose,false);logoFile.value=''}};
      if(logoRemove)logoRemove.onclick=()=>{logo.value='';preview.innerHTML='<span>Sin logo</span>';if(logoHint)logoHint.textContent='El logo se quitará al guardar la configuración.'};
      document.querySelectorAll('[data-color-name]').forEach(c=>{const n=c.dataset.colorName,t=document.querySelector(`[data-color-text="${n}"]`);c.oninput=()=>{t.value=c.value};t.oninput=()=>{if(/^#[0-9a-fA-F]{6}$/.test(t.value))c.value=t.value}});
      const suggest=$('#settings-colors-suggest');if(suggest)suggest.onclick=async()=>{busy(suggest);try{const colors=await suggestColorsFromLogo(logo.value.trim());Object.entries(colors).forEach(([n,v])=>{const c=document.querySelector(`[data-color-name="${n}"]`),t=document.querySelector(`[data-color-text="${n}"]`);if(c)c.value=v;if(t)t.value=v});const hint=$('#settings-color-hint');if(hint)hint.textContent='Colores sugeridos desde el logo. Revísalos y guarda para aplicarlos.';toast('Colores sugeridos desde el logo.')}catch(x){toast(x.message||x,true)}finally{busy(suggest,false)}};
      form.onsubmit=async e=>{e.preventDefault();const b=e.submitter;busy(b);try{const fd=new FormData(form),payload=Object.fromEntries(fd.entries()),out=await call('saveSettings',payload);Object.assign(s,out||{});state.cache.bootstrap.settings=out;applyParkingSettings(out);toast('Configuración guardada.');shell();go('config')}catch(x){toast(x.message,true);busy(b,false)}};
    }

    async function renderData(){
      setActive('data');
      panel.innerHTML=`<section class="card"><div class="system-status-head"><div><h2>Importación de viviendas y propietarios</h2><p class="muted">Carga inicial o actualización controlada de viviendas, propietarios y correos. La importación siempre muestra una previsualización antes de aplicar cambios.</p></div></div><div class="actions"><button type="button" class="secondary" id="owner-template-config">Plantilla viviendas/propietarios</button><button type="button" id="owner-import-config">Importar viviendas/propietarios</button></div><p class="muted" style="margin-top:.8rem">La plantilla puede utilizar viviendas existentes o crear las que falten si activas esa opción durante la importación. Los cambios se registran en Auditoría.</p></section><div id="editor"></div>`;
      $('#owner-template-config').onclick=downloadOwnerImportTemplate;
      $('#owner-import-config').onclick=openOwnerImporter;
    }

    async function renderSystem(){
      if(!systemAccess)return editable?renderIdentity():renderData();
      setActive('system');
      panel.innerHTML=`<section class="card system-status-card"><div class="system-status-head"><div><h2>Sistema</h2><p class="muted">Comprobando plataforma, mantenimiento e integraciones.</p></div></div><div class="system-loading"><div class="spinner"></div><span>Comprobando sistema…</span></div></section>`;
      const resultBox=()=>$('#diag-result');
      const rowsHtml=r=>(r.tests||[]).map(x=>`<div class="diagnostic-row"><div><span class="system-dot"></span><b>${esc(x.label)}</b><small>${esc(x.detail||'')}</small></div><span class="perf-badge ${esc(x.level||'good')}">${Number(x.ms||0)} ms</span></div>`).join('');
      const integrationCard=(title,data,items)=>`<section class="card legacy-integration-card"><div class="system-status-head"><div><h2>${esc(title)}</h2><p class="muted">${esc(data?.detail||'Integración heredada temporal.')}</p></div><span class="system-pill legacy">${esc(data?.provider||'Apps Script')}</span></div><div class="legacy-function-list">${items.map(x=>`<span>${esc(x)}</span>`).join('')}</div><div class="system-legacy-note">Se mantiene sin cambios durante el primer cutover. La migración se hará en una fase separada.</div></section>`;
      async function loadStatus(){
        try{
          const st=await call('systemStatus'),counts=st.counts||{},maintenance=st.maintenance||{},integrations=st.integrations||{};
          const serviceCards=(st.services||[]).map(x=>`<div class="system-service ${x.ok?'ok':'bad'}"><span class="system-dot"></span><div><b>${esc(x.label)}</b><small>${esc(x.detail||'')}</small><span class="perf-badge ${esc(x.level||'good')}">${Number(x.ms||0)} ms</span></div></div>`).join('');
          const checked=st.checkedAt?shortDateTime(st.checkedAt):'—';
          panel.innerHTML=`
            <section class="card system-info"><div class="system-status-head"><div><div class="eyebrow">SISTEMA</div><h2>Plataforma</h2><p class="muted">Estado real de la aplicación Supabase publicada en GitHub Pages.</p></div><span class="system-pill ${st.ok?'ok':'bad'}">${st.ok?'Disponible':'Revisar'}</span></div><div class="system-meta-grid"><div><span>Frontend</span><b>${esc(APP_FRONTEND_VERSION)}</b></div><div><span>Backend</span><b>${esc(st.backendVersion||'—')}</b></div><div><span>Entorno</span><b>${esc(st.environment||'—')}</b></div><div><span>Hosting</span><b>${esc(st.hosting||'GitHub Pages')}</b></div><div><span>Repositorio</span><b>${esc(st.repository||'floresderiviera/parking-comunidad')}</b></div><div><span>Última comprobación</span><b>${esc(checked)}</b></div></div></section>
            <section class="card system-status-card"><div class="system-status-head"><div><h2>Estado técnico</h2><p class="muted">Base de datos, autenticación, RLS y Edge Functions.</p></div><button type="button" class="secondary" id="system-refresh">Actualizar estado</button></div><div class="system-service-grid">${serviceCards}</div><div class="system-summary ${st.ok?'ok':'bad'}">${st.ok?'Sistema disponible.':'Hay elementos que requieren revisión.'} · ${Number(st.performance?.totalMs||0)} ms</div></section>
            <section class="card system-data-card"><div class="system-status-head"><div><h2>Datos</h2><p class="muted">Conteos actuales de Supabase. No son valores hardcodeados.</p></div></div><div class="system-data-grid"><div><b>${Number(counts.profiles||0)}</b><span>Usuarios normales</span></div><div><b>${Number(counts.rootProfiles||0)}</b><span>ROOT técnico</span></div><div><b>${Number(counts.dwellings||0)}</b><span>Viviendas</span></div><div><b>${Number(counts.vehicles||0)}</b><span>Vehículos</span></div><div><b>${Number(counts.legacyAuditRows||0)}</b><span>Auditoría histórica</span></div><div><b>${Number(counts.auditRows||0)}</b><span>Auditoría total</span></div></div></section>
            <section class="card maintenance-admin-card ${maintenance.enabled?'is-active':''}"><div class="system-status-head"><div><h2>Modo mantenimiento</h2><p class="muted">Bloquea la aplicación y el escáner para usuarios normales durante el cutover. ROOT conserva el acceso.</p></div><span class="system-pill ${maintenance.enabled?'bad':'ok'}">${maintenance.enabled?'ACTIVADO':'DESACTIVADO'}</span></div><div class="field"><label>Mensaje visible</label><textarea id="maintenance-message">${esc(maintenance.message||'Sistema temporalmente en mantenimiento. Volveremos a estar disponibles en breve.')}</textarea></div><div class="actions" style="margin-top:.8rem"><button type="button" class="${maintenance.enabled?'secondary':''}" id="maintenance-toggle">${maintenance.enabled?'Desactivar mantenimiento':'Activar mantenimiento'}</button></div><p class="muted system-legacy-note">El cambio queda registrado en Auditoría.</p></section>
            <div class="system-integrations-grid">
              ${integrationCard('Correo',integrations.mail,['Prueba de bienvenida','Modo de remitente / no-reply','Worker de correos','Estado y procesamiento manual','Reintento de fallidos'])}
              ${integrationCard('Google Drive / Docs',integrations.documents,['Carpeta principal','Verificar estructura Drive','Probar Google Docs','Worker documental','Generar documentos faltantes','Regenerar diseño','Procesar pendientes'])}
            </div>
            <section class="card consistency-card"><div class="system-status-head"><div><h2>Consistencia</h2><p class="muted">Comprueba slots, QR, temporales y relaciones operativas protegidas por Supabase.</p></div><button type="button" class="secondary" id="system-consistency">Ejecutar diagnóstico</button></div><div id="consistency-result" class="diagnostic-empty"><span>Sin comprobación ejecutada.</span></div></section>
            <section class="card performance-card"><div class="system-status-head"><div><h2>Diagnóstico</h2><p class="muted">Pruebas de lectura sobre Supabase y las Edge Functions. No utiliza Google Sheets como backend.</p></div></div><div class="performance-actions"><button type="button" id="diag-quick">Prueba rápida</button><button type="button" class="secondary" id="diag-full">Diagnóstico completo</button><button type="button" class="secondary" id="diag-roundtrip">Rendimiento</button><button type="button" class="secondary" id="diag-concurrency">Concurrencia</button></div><div id="diag-result" class="diagnostic-empty"><b>Sin prueba ejecutada</b><span>Selecciona una comprobación.</span></div><div id="diag-calls" class="diagnostic-empty"><b>Llamadas de esta sesión</b><span>Resumen de llamadas realizadas por este navegador.</span></div></section>`;
          $('#system-refresh').onclick=loadStatus;
          $('#maintenance-toggle').onclick=async()=>{const btn=$('#maintenance-toggle'),enabled=!maintenance.enabled,message=$('#maintenance-message').value.trim();if(enabled&&!confirm('¿Activar modo mantenimiento? Los usuarios normales y el escáner quedarán bloqueados hasta que ROOT lo desactive.'))return;busy(btn);try{await call('systemSetMaintenance',{enabled,message});toast(enabled?'Modo mantenimiento activado.':'Modo mantenimiento desactivado.');await loadStatus()}catch(e){toast(e.message||String(e),true);busy(btn,false)}};
          $('#system-consistency').onclick=runConsistency;
          $('#diag-quick').onclick=()=>runDiagnostic('quick');$('#diag-full').onclick=()=>runDiagnostic('full');$('#diag-roundtrip').onclick=runRoundTrip;$('#diag-concurrency').onclick=runConcurrency;
          renderSessionCalls();
        }catch(e){panel.innerHTML=`<section class="card"><div class="message bad">${esc(e.message||String(e))}</div><button type="button" class="secondary" id="system-retry">Reintentar</button></section>`;$('#system-retry').onclick=loadStatus}
      }
      async function runDiagnostic(mode){const box=resultBox();box.className='diagnostic-running';box.innerHTML='<div class="spinner"></div><span>Ejecutando diagnóstico…</span>';try{const r=await call('systemDiagnostics',{mode});box.className='diagnostic-result';box.innerHTML=`<div class="diagnostic-summary"><div><b>${mode==='full'?'Diagnóstico completo':'Prueba rápida'}</b><span>${esc(r.checkedAt?shortDateTime(r.checkedAt):'')}</span></div><span class="perf-badge ${esc(r.level||'good')}">${Number(r.totalMs||0)} ms</span></div><div class="diagnostic-grid">${rowsHtml(r)}</div>`}catch(e){box.className='diagnostic-result';box.innerHTML=`<div class="message bad">${esc(e.message||String(e))}</div>`}finally{renderSessionCalls()}}
      async function runConsistency(){const box=$('#consistency-result');box.className='diagnostic-running';box.innerHTML='<div class="spinner"></div><span>Comprobando consistencia…</span>';try{const r=await call('consistencyReport'),items=Array.isArray(r?.items)?r.items:[],errors=Number(r?.errors||0),warnings=Number(r?.warnings||0);box.className='diagnostic-result';box.innerHTML=`<div class="diagnostic-summary"><div><b>${errors||warnings?'Requiere revisión':'Sin inconsistencias detectadas'}</b><span>${errors} error(es) · ${warnings} aviso(s)</span></div><span class="system-pill ${errors?'bad':'ok'}">${errors?'REVISAR':'OK'}</span></div>${items.length?`<div class="diagnostic-grid">${items.slice(0,12).map(x=>`<div class="diagnostic-row"><div><b>${esc(x.label||x.code||'Observación')}</b><small>${esc(x.detail||'')}</small></div><span class="status ${x.severity==='Error'?'bad':''}">${esc(x.severity||'Aviso')}</span></div>`).join('')}</div>`:'<div class="system-summary ok">Las reglas de consistencia no detectaron incidencias.</div>'}` }catch(e){box.className='diagnostic-result';box.innerHTML=`<div class="message bad">${esc(e.message||String(e))}</div>`}}
      async function runRoundTrip(){const box=resultBox();box.className='diagnostic-running';box.innerHTML='<div class="spinner"></div><span>Midiendo latencia…</span>';try{const samples=[];for(let i=0;i<3;i++){const t=performance.now(),r=await call('systemRoundTripPing',{seq:i+1}),total=Math.max(1,Math.round(performance.now()-t)),serverMs=Number(r.serverMs||0);samples.push({total,serverMs,overhead:Math.max(0,total-serverMs)})}const avg=k=>Math.round(samples.reduce((a,x)=>a+x[k],0)/samples.length),total=avg('total'),server=avg('serverMs'),over=avg('overhead');box.className='diagnostic-result';box.innerHTML=`<div class="diagnostic-summary"><div><b>Rendimiento</b><span>Promedio de 3 muestras</span></div><span class="perf-badge">${total} ms</span></div><div class="diagnostic-grid"><div class="diagnostic-row"><div><b>Respuesta total</b></div><span>${total} ms</span></div><div class="diagnostic-row"><div><b>RPC Supabase</b></div><span>${server} ms</span></div><div class="diagnostic-row"><div><b>Navegador / transporte</b></div><span>${over} ms</span></div></div>`}catch(e){box.className='diagnostic-result';box.innerHTML=`<div class="message bad">${esc(e.message||String(e))}</div>`}finally{renderSessionCalls()}}
      async function runConcurrency(){if(!confirm('Se ejecutarán lotes de 5, 10 y 20 lecturas simultáneas desde este navegador. ¿Continuar?'))return;const box=resultBox();box.className='diagnostic-running';box.innerHTML='<div class="spinner"></div><span>Ejecutando concurrencia controlada…</span>';try{const batches=[];for(const n of [5,10,20]){const started=performance.now(),jobs=Array.from({length:n},(_,i)=>call('systemRoundTripPing',{seq:i+1}).then(()=>({ok:true})).catch(()=>({ok:false}))),r=await Promise.all(jobs),ms=Math.max(1,Math.round(performance.now()-started));batches.push({n,ms,fails:r.filter(x=>!x.ok).length})}const ok=batches.every(x=>!x.fails);box.className='diagnostic-result';box.innerHTML=`<div class="diagnostic-summary"><div><b>Concurrencia controlada</b><span>Desde un único navegador</span></div><span class="system-pill ${ok?'ok':'bad'}">${ok?'Correcta':'Revisar'}</span></div><div class="diagnostic-grid">${batches.map(x=>`<div class="diagnostic-row"><div><b>${x.n} simultáneas</b><small>${x.fails?x.fails+' fallo(s)':'Sin fallos'}</small></div><span>${x.ms} ms</span></div>`).join('')}</div>`}catch(e){box.className='diagnostic-result';box.innerHTML=`<div class="message bad">${esc(e.message||String(e))}</div>`}finally{renderSessionCalls()}}
      function renderSessionCalls(){const box=$('#diag-calls');if(!box)return;const rows=clientCallSummary().slice(0,10);if(!rows.length){box.className='diagnostic-empty';box.innerHTML='<b>Llamadas de esta sesión</b><span>Todavía no hay llamadas registradas.</span>';return}box.className='diagnostic-result';box.innerHTML='<div class="diagnostic-summary"><div><b>Llamadas de esta sesión</b><span>Ordenadas por impacto acumulado</span></div></div><div class="call-stats-grid">'+rows.map(x=>`<div class="call-stat"><b>${esc(x.action)}</b><span>${x.count} llamada${x.count===1?'':'s'} · media ${x.avg} ms · máx. ${x.max} ms · total ${x.total} ms${x.errors?' · '+x.errors+' error(es)':''}</span></div>`).join('')+'</div>'}
      loadStatus();
    }
    tabs.forEach(b=>b.onclick=()=>{const tab=b.dataset.configTab;if(tab==='system')return renderSystem();if(tab==='data')return renderData();return renderIdentity()});
    if(initialTab==='system')await renderSystem();else if(initialTab==='data')await renderData();else await renderIdentity();
  }catch(e){err(e)}
}
