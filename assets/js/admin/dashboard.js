async function dashboard(){
  try{
    const d=await call('dashboard'),pct=d.slotCapacity?Math.round((d.occupiedSlots/d.slotCapacity)*100):0,attentionRows=d.attention||[];
    const card=(value,label,detail='',action='',alert=false)=>`<article class="summary-card ${action?'clickable':''} ${alert?'alert':''}" ${action?`data-summary-action="${action}"`:''}><b>${esc(value)}</b><span>${esc(label)}</span>${detail?`<small>${esc(detail)}</small>`:''}</article>`;
    $('#main').innerHTML=`<section class="hero"><h1>Resumen del parking</h1><p>Estado operativo, pendientes y elementos que requieren atención.</p></section>
      <section class="summary-section"><div class="head"><h2>Estado general</h2></div><div class="summary-grid">
        ${card(d.activeHousing,'Viviendas activas',`${d.totalHousing} registradas`,'housing')}
        ${card(d.activeSlotVehicles,'Vehículos con slot activos','','vehicles-active-slot')}
        ${card(d.activeMotorcycles,'Motos activas','Control por matrícula','vehicles-motorcycles')}
        ${card(d.suspendedVehicles,'Suspendidos','','vehicles-suspended',d.suspendedVehicles>0)}
        ${card(d.lowVehicles,'De baja','','vehicles-low')}
        <article class="summary-card"><b>${esc(d.occupiedSlots)}</b><span>Slots ocupados</span><small>${esc(d.availableSlots)} libres de ${esc(d.slotCapacity)}</small><div class="slot-meter"><span style="width:${Math.max(0,Math.min(100,pct))}%"></span></div></article>
      </div></section>
      <section class="summary-section"><div class="head"><h2>Pendientes</h2></div><div class="summary-grid">
        ${card(d.pendingRequests,'Solicitudes abiertas','Requieren revisión','requests-pending',d.pendingRequests>0)}
        ${card(d.openIncidents,'Incidencias abiertas','Pendientes de resolución','incidents-open',d.openIncidents>0)}
        ${card(d.revoked,'QR revocados','Solo vehículos con QR','vehicles-revoked',d.revoked>0)}
        ${card(d.activeWithoutSlot||0,'Activos sin slot','No incluye motos','vehicles-active-noslot',(d.activeWithoutSlot||0)>0)}
        ${card(d.temporary,'Temporales vigentes','','vehicles-temporary')}
        ${card(d.temporaryExpiring7,'Temporales que vencen ≤ 7 días','Revisar próximos vencimientos','vehicles-temporary-expiring',d.temporaryExpiring7>0)}
      </div></section>
      <section class="summary-section"><div class="head"><h2>Actividad últimos 30 días</h2></div><div class="summary-grid">
        ${card(d.incidents30,'Incidencias registradas',trendText(d.trends?.incidents),'incidents-30')}
        ${card(d.requests30,'Solicitudes registradas',trendText(d.trends?.requests),'requests-30')}
        ${card(d.newVehicles30,'Altas de vehículos',trendText(d.trends?.vehicles),'vehicles-30')}
      </div></section>
      <section class="summary-section"><div class="head"><h2>Requiere atención</h2></div><div class="attention-list" id="summary-attention-list"></div><div id="summary-attention-pager"></div></section>`;
    let attentionPage=1;const ATTENTION_PAGE_SIZE=5;
    const renderAttention=()=>{const pages=Math.max(1,Math.ceil(attentionRows.length/ATTENTION_PAGE_SIZE));attentionPage=Math.min(Math.max(1,attentionPage),pages);const start=(attentionPage-1)*ATTENTION_PAGE_SIZE,slice=attentionRows.slice(start,start+ATTENTION_PAGE_SIZE);$('#summary-attention-list').innerHTML=slice.map((x,i)=>`<div class="attention-item"><div><strong>${esc(x.label)}</strong><span>${esc(x.detail||'')}</span></div><button class="secondary summary-attention" data-i="${start+i}">Ver</button></div>`).join('')||'<div class="card empty">No hay elementos que requieran atención especial.</div>';$('#summary-attention-pager').innerHTML=attentionRows.length>ATTENTION_PAGE_SIZE?`<div class="pager"><span class="muted">Página ${attentionPage} de ${pages} · ${attentionRows.length} elementos</span><div class="actions"><button class="secondary" id="attention-prev" ${attentionPage<=1?'disabled':''}>← Anterior</button><button class="secondary" id="attention-next" ${attentionPage>=pages?'disabled':''}>Siguiente →</button></div></div>`:'';document.querySelectorAll('.summary-attention').forEach(b=>b.onclick=()=>openSummaryAttention(attentionRows[Number(b.dataset.i)]));if($('#attention-prev'))$('#attention-prev').onclick=()=>{attentionPage--;renderAttention()};if($('#attention-next'))$('#attention-next').onclick=()=>{attentionPage++;renderAttention()}};
    renderAttention();
    document.querySelectorAll('[data-summary-action]').forEach(el=>el.onclick=()=>openSummaryAction(el.dataset.summaryAction));
  }catch(e){err(e)}
}
function resetSummaryDestination(view){replaceViewUiState(view,{})}
function openSummaryAction(action){
  if(action==='requests-pending'){resetSummaryDestination('requests');state.cache.requestPreset={search:'',status:'Abierta',type:'',period:'',from:'',to:'',group:'none'};go('requests');return}
  if(action==='requests-30'){resetSummaryDestination('requests');state.cache.requestPreset={search:'',status:'',type:'',period:'30',from:'',to:'',group:'none'};go('requests');return}
  if(action==='incidents-open'){resetSummaryDestination('incidents');state.cache.incidentPreset={search:'',status:'Abierta',type:'',origin:'',period:'',from:'',to:'',group:'none'};go('incidents');return}
  if(action==='incidents-30'){resetSummaryDestination('incidents');state.cache.incidentPreset={search:'',status:'',type:'',origin:'',period:'30',from:'',to:'',group:'none'};go('incidents');return}
  if(action==='housing'){resetSummaryDestination('housing');state.cache.tablePreset={kind:'housing',search:'',filters:{Estado:'Activa'}};go('housing');return}
  if(action==='vehicles-active-slot'){resetSummaryDestination('vehicles');state.cache.tablePreset={kind:'vehicles',search:'',filters:{Estado:'Activo',__Clase:'Vehículo',__Slot:'Con slot'}};go('vehicles');return}
  if(action==='vehicles-motorcycles'){resetSummaryDestination('vehicles');state.cache.tablePreset={kind:'vehicles',search:'',filters:{Estado:'Activo',__Clase:'Moto'}};go('vehicles');return}
  if(action==='vehicles-suspended'){resetSummaryDestination('vehicles');state.cache.tablePreset={kind:'vehicles',search:'',filters:{Estado:'Suspendido'}};go('vehicles');return}
  if(action==='vehicles-low'){resetSummaryDestination('vehicles');state.cache.tablePreset={kind:'vehicles',search:'',filters:{Estado:'Baja'}};go('vehicles');return}
  if(action==='vehicles-revoked'){resetSummaryDestination('vehicles');state.cache.tablePreset={kind:'vehicles',search:'',filters:{QR_Estado:'Revocado'}};go('vehicles');return}
  if(action==='vehicles-active-noslot'){resetSummaryDestination('vehicles');state.cache.tablePreset={kind:'vehicles',search:'',filters:{Estado:'Activo',__Clase:'Vehículo',__Slot:'Sin slot'}};go('vehicles');return}
  if(action==='vehicles-temporary'){resetSummaryDestination('vehicles');state.cache.tablePreset={kind:'vehicles',search:'',filters:{__Temporal:'Vigente'}};go('vehicles');return}
  if(action==='vehicles-temporary-expiring'){resetSummaryDestination('vehicles');state.cache.tablePreset={kind:'vehicles',search:'',filters:{__Temporal:'Vence en 7 días'}};go('vehicles');return}
  if(action==='vehicles-30'){resetSummaryDestination('vehicles');state.cache.tablePreset={kind:'vehicles',search:'',filters:{__AltaPeriodo:'Últimos 30 días'}};go('vehicles');return}
  if(action==='vehicles'){resetSummaryDestination('vehicles');state.cache.tablePreset={kind:'vehicles',search:'',filters:{}};go('vehicles')}
}
function openSummaryAttention(item){
  if(!item)return;
  if(item.requestId){resetSummaryDestination('requests');state.cache.requestPreset={search:'',status:'',type:'',period:'',from:'',to:'',group:'none'};state.cache.requestFocus=item.requestId;go('requests');return}
  if(item.incidentId){resetSummaryDestination('incidents');state.cache.incidentPreset={search:'',status:'',type:'',origin:'',period:'',from:'',to:'',group:'none'};state.cache.incidentFocus=item.incidentId;go('incidents');return}
  if(item.vehicleId){resetSummaryDestination('vehicles');state.cache.tablePreset={kind:'vehicles',search:item.label.split(' · ')[0],filters:{}};go('vehicles');return}
  if(item.housingId){resetSummaryDestination('housing');state.cache.tablePreset={kind:'housing',search:item.label,filters:{}};go('housing')}
}
