
async function dashboard(){
  try{
    const d=await call('dashboard'),pct=d.slotCapacity?Math.round((d.occupiedSlots/d.slotCapacity)*100):0;
    const card=(value,label,detail='',action='',alert=false)=>`<article class="summary-card ${action?'clickable':''} ${alert?'alert':''}" ${action?`data-summary-action="${action}"`:''}><b>${esc(value)}</b><span>${esc(label)}</span>${detail?`<small>${esc(detail)}</small>`:''}</article>`;
    const attention=(d.attention||[]).map((x,i)=>`<div class="attention-item"><div><strong>${esc(x.label)}</strong><span>${esc(x.detail||'')}</span></div><button class="secondary summary-attention" data-i="${i}">Ver</button></div>`).join('')||'<div class="card empty">No hay elementos que requieran atención especial.</div>';
    $('#main').innerHTML=`<section class="hero"><h1>Resumen del parking</h1><p>Situación actual, pendientes y actividad reciente.</p></section>
      <section class="summary-section"><div class="head"><h2>Estado general</h2></div><div class="summary-grid">
        ${card(d.activeHousing,'Viviendas activas',`${d.totalHousing} registradas`,'housing')}
        ${card(d.activeVehicles,'Vehículos activos','','vehicles-active')}
        ${card(d.suspendedVehicles,'Suspendidos','','vehicles-suspended',d.suspendedVehicles>0)}
        ${card(d.lowVehicles,'De baja','','vehicles-low')}
        <article class="summary-card"><b>${esc(d.occupiedSlots)} / ${esc(d.slotCapacity)}</b><span>Slots ocupados</span><small>${esc(d.availableSlots)} disponibles</small><div class="slot-meter"><span style="width:${Math.max(0,Math.min(100,pct))}%"></span></div></article>
      </div></section>
      <section class="summary-section"><div class="head"><h2>Acciones pendientes</h2></div><div class="summary-grid">
        ${card(d.pendingRequests,'Solicitudes pendientes','Requieren revisión','requests',d.pendingRequests>0)}
        ${card(d.openIncidents,'Incidencias pendientes','Abiertas actualmente','incidents',d.openIncidents>0)}
        ${card(d.revoked,'QR revocados','Todos los estados','vehicles-revoked',d.revoked>0)}
        ${card(d.activeWithoutQr,'Activos sin QR válido','Requieren atención','vehicles-active-revoked',d.activeWithoutQr>0)}
      </div></section>
      <section class="summary-section"><div class="head"><h2>Actividad últimos 30 días</h2></div><div class="summary-grid">
        ${card(d.incidents30,'Incidencias registradas','','incidents')}
        ${card(d.requests30,'Solicitudes registradas','','requests')}
        ${card(d.temporary,'Temporales vigentes','','vehicles')}
        ${card(d.newVehicles30,'Altas de vehículos','','vehicles')}
      </div></section>
      <section class="summary-section"><div class="head"><h2>Requiere atención</h2></div><div class="attention-list">${attention}</div></section>`;
    document.querySelectorAll('[data-summary-action]').forEach(el=>el.onclick=()=>openSummaryAction(el.dataset.summaryAction));
    document.querySelectorAll('.summary-attention').forEach(b=>b.onclick=()=>openSummaryAttention((d.attention||[])[Number(b.dataset.i)]));
  }catch(e){err(e)}
}
function openSummaryAction(action){
  if(action==='requests'){go('requests');return}if(action==='incidents'){go('incidents');return}if(action==='housing'){state.cache.tablePreset={kind:'housing',filters:{Estado:'Activa'}};go('housing');return}
  if(action==='vehicles-active'){state.cache.tablePreset={kind:'vehicles',filters:{Estado:'Activo'}};go('vehicles');return}
  if(action==='vehicles-suspended'){state.cache.tablePreset={kind:'vehicles',filters:{Estado:'Suspendido'}};go('vehicles');return}
  if(action==='vehicles-low'){state.cache.tablePreset={kind:'vehicles',filters:{Estado:'Baja'}};go('vehicles');return}
  if(action==='vehicles-revoked'){state.cache.tablePreset={kind:'vehicles',filters:{QR_Estado:'Revocado'}};go('vehicles');return}
  if(action==='vehicles-active-revoked'){state.cache.tablePreset={kind:'vehicles',filters:{Estado:'Activo',QR_Estado:'Revocado'}};go('vehicles');return}
  if(action==='vehicles'){go('vehicles')}
}
function openSummaryAttention(item){if(!item)return;if(item.requestId){state.cache.requestFocus=item.requestId;go('requests');return}if(item.incidentId){state.cache.incidentFocus=item.incidentId;go('incidents');return}if(item.vehicleId){state.cache.tablePreset={kind:'vehicles',search:item.label.split(' · ')[0]};go('vehicles');return}if(item.housingId){state.cache.tablePreset={kind:'housing',search:item.label};go('housing')}}

