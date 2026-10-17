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
  <div class="summary-grid"><article class="summary-card"><b>${esc(d.slotsUsed)}</b><span>Slots ocupados</span><small>${esc(d.slotsFree)} libres</small></article><article class="summary-card"><b>${vs.filter(v=>v.Estado==='Activo'&&v.Tipo==='Moto').length}</b><span>Motos activas</span></article><article class="summary-card"><b>${incs.filter(i=>(i.Estado||'Abierta')!=='Cerrada').length}</b><span>Incidencias abiertas</span></article><article class="summary-card"><b>${reqs.filter(r=>r.Estado==='Pendiente').length}</b><span>Solicitudes pendientes</span></article></div>
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
    if(p.stateChanges)lines.push(`${p.stateChanges} cambiarán de estado.`);if(p.slotsReleased)lines.push(`${p.slotsReleased} slot(s) serán liberados.`);if(p.qrRevoked)lines.push(`${p.qrRevoked} QR serán revocados.`);if(p.temporalsAnnulled)lines.push(`${p.temporalsAnnulled} temporal(es) vigente(s) serán anulados.`);if(p.qrSkippedMotos)lines.push(`${p.qrSkippedMotos} moto(s) se omitirán porque no usan QR.`);
    if(!confirm(`${label}\n\n${lines.join('\n')}\n\n¿Confirmar operación?`))return;
    const out=await call('bulkVehicleAction',{ids,action});invalidateClientParkingData();toast(`${out.changed} vehículo(s) actualizados.`);manager('vehicles')
  }catch(e){err(e)}
}

function exportRowsFromCurrent(kind,rows,format='xlsx'){const filtered=state.cache.currentFilteredRows||rows||[],date=new Date().toISOString().slice(0,10);if(format==='csv')downloadCsv(`parking_${kind}_${date}.csv`,filtered);else return downloadXlsx(`parking_${kind}_${date}.xlsx`,filtered,null,kind).catch(err)}


async function consistencyReviewView(){
  renderLoading('dataReview');try{const d=await call('consistencyReport'),items=d.items||[];
  $('#main').innerHTML=`<div class="head"><div><h1>Revisión de datos</h1><div class="muted">Solo muestra incoherencias de datos. Los pendientes operativos se gestionan desde Resumen.</div></div><button class="secondary" id="review-refresh">Revisar nuevamente</button></div><div class="summary-grid"><article class="summary-card ${d.errors?'alert':''}"><b>${esc(d.errors)}</b><span>Errores de integridad</span></article><article class="summary-card ${d.warnings?'alert':''}"><b>${esc(d.warnings)}</b><span>Inconsistencias</span></article><article class="summary-card"><b>${esc(items.length)}</b><span>Total detectado</span></article></div><section class="card" style="margin-top:1rem"><div class="tablebox compact-table"><table class="table"><thead><tr><th>Nivel</th><th>Comprobación</th><th>Detalle</th><th>Acción</th></tr></thead><tbody>${items.map((x,i)=>{const fix=['MOTO_CON_SLOT','MOTO_QR_ACTIVO','TEMPORAL_NO_ACTIVO'].includes(x.code);return `<tr><td><span class="status ${x.severity==='Error'?'bad':''}">${esc(x.severity)}</span></td><td><b>${esc(x.label)}</b><span class="subtle">${esc(x.code)}</span></td><td>${esc(x.detail||'—')}</td><td><div class="actions"><button class="secondary review-open" data-i="${i}">Ir al registro</button>${fix?`<button class="review-fix" data-i="${i}">Corregir</button>`:''}</div></td></tr>`}).join('')}</tbody></table>${items.length?'':'<div class="empty">No se detectaron inconsistencias.</div>'}</div></section>`;
  $('#review-refresh').onclick=consistencyReviewView;document.querySelectorAll('.review-open').forEach(b=>b.onclick=()=>openConsistencyItem(items[Number(b.dataset.i)]));document.querySelectorAll('.review-fix').forEach(b=>b.onclick=async()=>{const x=items[Number(b.dataset.i)],msg={MOTO_CON_SLOT:'Quitar el slot asignado a esta moto',MOTO_QR_ACTIVO:'Revocar el QR de esta moto',TEMPORAL_NO_ACTIVO:'Anular el temporal vigente'}[x.code]||'Aplicar corrección';if(!confirm(`${msg}.\n\nSe registrará en Auditoría. ¿Continuar?`))return;busy(b);try{const out=await call('consistencyFix',{code:x.code,vehicleId:x.vehicleId});invalidateClientParkingData();toast(out.message||'Corrección aplicada.');consistencyReviewView()}catch(e){err(e);busy(b,false)}});
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
    const h=(data.options?.housing||[]).find(x=>x.ID_Vivienda===v.ID_Vivienda),isMoto=v.Tipo==='Moto',temp=v.PeriodoTemporalActual;
    $('#main').innerHTML=`<div class="head"><div><h1>${esc(v.MatriculaHabitual)}</h1><div class="muted">Ficha del vehículo · ${esc(h?housingShort(h):v.ID_Vivienda||'')}</div></div><button class="secondary" id="vd-back">Volver</button></div>
      <section class="card"><div class="details"><div><small>Clase / tipo</small>${esc(isMoto?'Moto':v.Tipo||'Vehículo')}</div><div><small>Estado</small>${esc(v.Estado)}</div><div><small>Slot</small>${esc(isMoto?'No aplica':v.Slot||'Liberado')}</div><div><small>QR</small>${esc(isMoto?'No aplica':v.QR_Estado||'—')}</div><div><small>Marca/modelo</small>${esc([v.Marca,v.Modelo].filter(Boolean).join(' ')||'—')}</div><div><small>Temporal vigente</small>${temp?`${esc(temp.MatriculaTemporal)} · hasta ${esc(dateEs(temp.Hasta))}`:'—'}</div></div>
      <div class="actions" style="margin-top:1rem"><button id="vd-edit">Editar</button><button class="secondary" id="vd-temporals">Temporales</button>${!isMoto?`<button class="secondary" id="vd-qr">QR</button>`:''}<button class="secondary" id="vd-history">Historial</button>${v.Estado==='Activo'?`<button class="secondary" id="vd-suspend">Suspender</button><button class="danger" id="vd-low">Dar de baja</button>`:''}${v.Estado!=='Activo'?`<button class="secondary" id="vd-reactivate">Reactivar</button>`:''}<button class="secondary" id="vd-replace">Reemplazar</button></div></section><div id="editor" style="margin-top:1rem"></div>`;
    $('#vd-back').onclick=backFn||(()=>go('vehicles'));$('#vd-edit').onclick=()=>vehicleEditor(v);$('#vd-temporals').onclick=()=>temporaryPeriodsPanel(v,()=>vehicleDetailView(v.ID_Vehiculo,backFn));$('#vd-history').onclick=()=>vehicleHistoryView(v.ID_Vehiculo,()=>vehicleDetailView(v.ID_Vehiculo,backFn));$('#vd-replace').onclick=()=>replaceVehicleView(v);
    if($('#vd-qr'))$('#vd-qr').onclick=()=>showQr(v,()=>vehicleDetailView(v.ID_Vehiculo,backFn));
    if($('#vd-suspend'))$('#vd-suspend').onclick=()=>quickVehicleState(v,'Suspendido',backFn);if($('#vd-low'))$('#vd-low').onclick=()=>quickVehicleState(v,'Baja',backFn);
    if($('#vd-reactivate'))$('#vd-reactivate').onclick=()=>{vehicleEditor(v);toast('Selecciona Activo y, si corresponde, un slot libre.');};
  }catch(e){err(e)}
}
async function quickVehicleState(v,newState,backFn){const impact=[newState==='Suspendido'?'El vehículo quedará suspendido.':'El vehículo será dado de baja.',v.Tipo==='Moto'?'No ocupa slot.':v.Slot?`Se liberará el Slot ${v.Slot}.`:'',v.Tipo==='Moto'?'':'El QR quedará revocado.',v.PeriodoTemporalActual?`Se anulará el temporal ${v.PeriodoTemporalActual.MatriculaTemporal}.`:''].filter(Boolean).join('\n');if(!confirm(`${impact}\n\n¿Confirmar?`))return;try{await call('saveVehicle',Object.assign({},v,{Estado:newState}));invalidateClientParkingData();toast(`Vehículo ${newState.toLowerCase()}.`);vehicleDetailView(v.ID_Vehiculo,backFn)}catch(e){err(e)}}


// 1.2.12 - ficha operativa de vivienda
async function housingDetailView(id){
  renderLoading('housing');try{const d=await call('housingDetail',{id}),h=d.housing,o=d.owner||{},vs=d.vehicles||[],incs=d.incidents||[],reqs=d.requests||[];
  const openInc=incs.filter(x=>(x.Estado||'Abierta')!=='Cerrada'),pendingReq=reqs.filter(x=>x.Estado==='Pendiente'),tmp=vs.filter(v=>v.PeriodoTemporalActual),slotVehicle=n=>vs.find(v=>v.Estado==='Activo'&&v.Tipo!=='Moto'&&String(v.Slot)===String(n));
  const slotCard=n=>{const v=slotVehicle(n);return `<article class="summary-card clickable hd-slot" data-plate="${esc(v?.MatriculaHabitual||'')}"><b>${v?esc(v.MatriculaHabitual):'Libre'}</b><span>Slot ${n}</span><small>${v?esc(v.Estado):'Disponible'}</small></article>`};
  $('#main').innerHTML=`<div class="head"><div><h1>${esc(housingShort(h))}</h1><div class="muted">Ficha operativa de vivienda</div></div><div class="actions"><button class="secondary" id="hd-back">← Viviendas</button><button id="hd-add">＋ Vehículo</button></div></div>
  <div class="summary-grid">${slotCard(1)}${slotCard(2)}<button class="summary-card clickable" id="hd-inc"><b>${openInc.length}</b><span>Incidencias abiertas</span><small>Ver incidencias</small></button><button class="summary-card clickable" id="hd-req"><b>${pendingReq.length}</b><span>Solicitudes pendientes</span><small>Ver solicitudes</small></button><article class="summary-card"><b>${tmp.length}</b><span>Temporales vigentes</span></article></div>
  <section class="card" style="margin-top:1rem"><h2>Vivienda y propietario</h2><div class="details"><div><small>Vivienda</small>${esc(housingShort(h))}</div><div><small>Estado</small>${esc(h.Estado||'—')}</div><div><small>Responsable</small>${esc(o.Nombre||'Sin responsable')}</div><div><small>Email</small>${esc(o.Email||h.Responsable||'—')}</div></div></section>
  <section class="card" style="margin-top:1rem"><div class="head"><h2>Vehículos registrados</h2><button class="secondary" id="hd-open-vehicles">Abrir en Vehículos</button></div><div class="tablebox compact-table"><table class="table responsive-data-table"><thead><tr><th>Habitual</th><th>Temporal</th><th>Vigencia</th><th>Clase</th><th>Estado</th><th>Slot</th><th>QR</th></tr></thead><tbody>${vs.map(v=>`<tr><td data-label="Habitual"><b>${esc(v.MatriculaHabitual||'—')}</b></td><td data-label="Temporal">${esc(v.PeriodoTemporalActual?.MatriculaTemporal||'—')}</td><td data-label="Vigencia">${v.PeriodoTemporalActual?`${esc(dateEs(v.PeriodoTemporalActual.Desde))} → ${esc(dateEs(v.PeriodoTemporalActual.Hasta))}`:'—'}</td><td data-label="Clase">${v.Tipo==='Moto'?'Moto':'Vehículo'}</td><td data-label="Estado">${esc(v.Estado||'—')}</td><td data-label="Slot">${esc(v.Tipo==='Moto'?'No aplica':v.Slot||'Sin slot')}</td><td data-label="QR">${esc(v.Tipo==='Moto'?'No aplica':v.QR_Estado||'—')}</td></tr>`).join('')}</tbody></table></div></section>`;
  $('#hd-back').onclick=()=>go('housing');$('#hd-add').onclick=()=>{state.cache.tablePreset={kind:'vehicles',filters:{__Vivienda:h.ID_Vivienda}};go('vehicles')};$('#hd-open-vehicles').onclick=$('#hd-add').onclick;
  $('#hd-inc').onclick=()=>{state.cache.incidentPreset={housingId:h.ID_Vivienda,status:'Abierta'};go('incidents')};$('#hd-req').onclick=()=>{state.cache.requestPreset={housingId:h.ID_Vivienda,status:'Pendiente'};go('requests')};
  document.querySelectorAll('.hd-slot').forEach(x=>x.onclick=()=>{if(!x.dataset.plate)return;state.cache.tablePreset={kind:'vehicles',search:x.dataset.plate};go('vehicles')});
  }catch(e){err(e)}
}


// 1.2.12.2 - ficha de vivienda unificada; Vehículos reutiliza la pantalla principal filtrada
async function housingDetailView(id){
  renderLoading('housing');
  try{
    const d=await call('housingDetail',{id}),h=d.housing,o=d.owner||{},vs=d.vehicles||[],incs=d.incidents||[],reqs=d.requests||[];
    const openInc=incs.filter(x=>(x.Estado||'Abierta')!=='Cerrada');
    const pendingReq=reqs.filter(x=>x.Estado==='Pendiente');
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
        ${card(pendingReq.length,'Solicitudes pendientes','Requieren revisión','requests',pendingReq.length>0)}
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
      if(a==='requests'){state.cache.requestPreset={housingId:h.ID_Vivienda,status:'Pendiente'};go('requests');return}
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
async function configurationView(){
  renderLoading('config');
  try{
    const s=await call('getSettings');
    $('#main').innerHTML=`<div class="head"><div><div class="eyebrow">CONFIGURACIÓN</div><h1>Identidad de la comunidad</h1><div class="muted">Datos generales e identidad visual de la comunidad. Los cambios se aplican al login y a la cabecera.</div></div></div>
    <form id="configuration-form" class="settings-layout">
      <section class="card settings-main"><h2>Datos principales</h2><p class="muted">Información visible dentro de la aplicación.</p><div class="form">
        <div class="field"><label>Nombre oficial</label><input name="NombreOficial" value="${esc(s.NombreOficial||'Parking Comunidad')}" required></div>
        <div class="field"><label>Descripción</label><input name="Descripcion" value="${esc(s.Descripcion||s.NombreCorto||'Gestión de acceso y parking de la comunidad')}" placeholder="Gestión de acceso y parking de la comunidad"></div>
        <div class="field"><label>Correo de contacto</label><input type="email" name="EmailContacto" value="${esc(s.EmailContacto||'')}"></div>
        <div class="field"><label>Dirección</label><input name="Direccion" value="${esc(s.Direccion||'')}"></div>
        <div class="field wide"><label>URL del logo <span class="muted">(opcional)</span></label><input name="LogoUrl" id="settings-logo-url" type="url" value="${esc(s.LogoUrl||'')}" placeholder="Puedes pegar una URL o subir un archivo desde el panel de Logo"></div>
      </div><hr><h3>Incidencias</h3><p class="muted">La prioridad sube automáticamente según la cantidad de intentos diarios registrados. El intento inicial cuenta como 1.</p><div class="form incident-thresholds"><div class="field"><label>Atención desde</label><input type="number" min="2" name="IncidenciaAtencionDesde" value="${esc(s.IncidenciaAtencionDesde||3)}"></div><div class="field"><label>Alta desde</label><input type="number" min="3" name="IncidenciaAltaDesde" value="${esc(s.IncidenciaAltaDesde||5)}"></div><div class="field"><label>Crítica desde</label><input type="number" min="4" name="IncidenciaCriticaDesde" value="${esc(s.IncidenciaCriticaDesde||7)}"></div></div></section>
      <aside class="settings-side">
        <section class="card settings-logo"><h2>Logo</h2><p class="muted">Puedes subir una imagen desde tu equipo o utilizar una URL. Se usa en el login y en la cabecera.</p><div class="settings-logo-preview" id="settings-logo-preview">${s.LogoUrl?`<img src="${esc(s.LogoUrl)}" alt="Logo de la comunidad">`:'<span>Sin logo</span>'}</div><div class="settings-logo-actions"><label class="button-like secondary" for="settings-logo-file">Elegir logo</label><input id="settings-logo-file" type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden><button type="button" class="danger-link" id="settings-logo-remove">Quitar</button></div><div class="muted settings-logo-hint" id="settings-logo-hint">PNG, JPG, WEBP o GIF. Máximo 6 MB.</div></section>
        <section class="card settings-colors"><h2>Colores</h2><p class="muted">Puedes elegirlos manualmente o sugerirlos automáticamente a partir del logo.</p>${[['ColorPrincipal','Principal',s.ColorPrincipal||'#087f6b'],['ColorSecundario','Secundario',s.ColorSecundario||'#0d302f'],['ColorAcento','Acento',s.ColorAcento||'#e1f2ef']].map(([n,l,v])=>`<div class="color-setting"><label>${l}</label><div><input type="color" data-color-name="${n}" value="${esc(v)}"><input name="${n}" data-color-text="${n}" value="${esc(v)}" maxlength="7" pattern="#[0-9A-Fa-f]{6}"></div></div>`).join('')}<button type="button" class="secondary settings-color-suggest" id="settings-colors-suggest">Sugerir desde logo</button><div class="muted settings-color-hint" id="settings-color-hint">La sugerencia no se guarda hasta pulsar “Guardar configuración”.</div></section>
      </aside>
      <div class="settings-save"><button type="submit">Guardar configuración</button></div>
    </form>`;
    const form=$('#configuration-form'),logo=$('#settings-logo-url'),preview=$('#settings-logo-preview');
    logo.addEventListener('input',()=>{const u=logo.value.trim();preview.innerHTML=u?`<img src="${esc(u)}" alt="Logo de la comunidad" onerror="this.parentElement.innerHTML='<span>Logo no disponible</span>'">`:'<span>Sin logo</span>'});
    const logoFile=$('#settings-logo-file'),logoRemove=$('#settings-logo-remove'),logoHint=$('#settings-logo-hint');
    if(logoFile)logoFile.onchange=async e=>{const file=e.target.files&&e.target.files[0];if(!file)return;const choose=document.querySelector('label[for="settings-logo-file"]');busy(choose);try{if(logoHint)logoHint.textContent='Optimizando y subiendo logo…';const dataUrl=await logoFileData(file);preview.innerHTML=`<img src="${dataUrl}" alt="Vista previa del logo">`;const out=await call('uploadLogo',{dataUrl});logo.value=out.url||'';preview.innerHTML=`<img src="${esc(out.url||'')}" alt="Logo de la comunidad">`;if(logoHint)logoHint.textContent='Logo subido. Pulsa “Guardar configuración” para aplicarlo.';toast('Logo subido correctamente.');}catch(x){toast(x.message||x,true);if(logoHint)logoHint.textContent='No se pudo subir el logo.';}finally{busy(choose,false);logoFile.value=''}};
    if(logoRemove)logoRemove.onclick=()=>{logo.value='';preview.innerHTML='<span>Sin logo</span>';if(logoHint)logoHint.textContent='El logo se quitará al guardar la configuración.'};
    document.querySelectorAll('[data-color-name]').forEach(c=>{const n=c.dataset.colorName,t=document.querySelector(`[data-color-text="${n}"]`);c.oninput=()=>{t.value=c.value};t.oninput=()=>{if(/^#[0-9a-fA-F]{6}$/.test(t.value))c.value=t.value}});
    const suggest=$('#settings-colors-suggest');if(suggest)suggest.onclick=async()=>{busy(suggest);try{const colors=await suggestColorsFromLogo(logo.value.trim());Object.entries(colors).forEach(([n,v])=>{const c=document.querySelector(`[data-color-name="${n}"]`),t=document.querySelector(`[data-color-text="${n}"]`);if(c)c.value=v;if(t)t.value=v});const hint=$('#settings-color-hint');if(hint)hint.textContent='Colores sugeridos desde el logo. Revísalos y guarda para aplicarlos.';toast('Colores sugeridos desde el logo.');busy(suggest,false)}catch(x){toast(x.message||x,true);busy(suggest,false)}};
    form.onsubmit=async e=>{e.preventDefault();const b=e.submitter;busy(b);try{const fd=new FormData(form),payload=Object.fromEntries(fd.entries()),out=await call('saveSettings',payload);state.cache.bootstrap.settings=out;applyParkingSettings(out);toast('Configuración guardada.');shell();go('config')}catch(x){toast(x.message,true);busy(b,false)}};
  }catch(e){err(e)}
}
