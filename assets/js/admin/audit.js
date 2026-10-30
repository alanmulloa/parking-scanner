function auditValue(value,name){if(!value)return '—';return name?`<b>${esc(name)}</b><span class="subtle">${esc(value)}</span>`:esc(value)}
function auditDateOnly(v){return String(v||'').slice(0,10)}
function auditPresetRange(preset){
  const now=new Date(),local=d=>{const x=new Date(d.getTime()-d.getTimezoneOffset()*60000);return x.toISOString().slice(0,10)},today=local(now);
  if(preset==='today')return [today,today];
  if(preset==='7'){const d=new Date(now);d.setDate(d.getDate()-6);return [local(d),today]}
  if(preset==='30'){const d=new Date(now);d.setDate(d.getDate()-29);return [local(d),today]}
  if(preset==='month'){return [local(new Date(now.getFullYear(),now.getMonth(),1)),today]}
  if(preset==='prevmonth'){const a=new Date(now.getFullYear(),now.getMonth()-1,1),b=new Date(now.getFullYear(),now.getMonth(),0);return [local(a),local(b)]}
  return ['',''];
}
async function audit(){
  try{
    const rows=await call('listAudit'),entities=[...new Set(rows.map(r=>r.Entidad).filter(Boolean))].sort(),actions=[...new Set(rows.map(r=>r.Accion).filter(Boolean))].sort(),users=[...new Map(rows.filter(r=>r.Usuario).map(r=>[r.Usuario,{email:r.Usuario,name:r.UsuarioNombre||r.Usuario}])).values()].sort((a,b)=>String(a.name).localeCompare(String(b.name),'es'));
    $('#main').innerHTML=`<div class="head"><h1>Auditoría</h1>${exportButtonsHtml('audit-export')}</div>
      <div class="filterbar">
        <div class="field"><label>Período</label><select id="audit-period"><option value="30" selected>Últimos 30 días</option><option value="today">Hoy</option><option value="7">Últimos 7 días</option><option value="month">Mes actual</option><option value="prevmonth">Mes anterior</option><option value="all">Todo</option><option value="custom">Personalizado</option></select></div>
        <div class="field"><label>Desde</label><input id="audit-from" type="date"></div>
        <div class="field"><label>Hasta</label><input id="audit-to" type="date"></div>
        <div class="field filter-search"><label>Buscar</label><input id="audit-search" class="search" placeholder="Nombre, email, acción, entidad o valor..."></div>
        <div class="field"><label>Usuario</label><select id="audit-user"><option value="">Todos</option>${users.map(u=>`<option value="${esc(u.email)}">${esc(u.name)}</option>`).join('')}</select></div>
        <div class="field"><label>Entidad</label><select id="audit-entity"><option value="">Todas</option>${entities.map(v=>`<option>${esc(v)}</option>`).join('')}</select></div>
        <div class="field"><label>Acción</label><select id="audit-action"><option value="">Todas</option>${actions.map(v=>`<option>${esc(v)}</option>`).join('')}</select></div>
        <button type="button" class="secondary" id="audit-clear">Limpiar</button><span class="count" id="audit-count"></span>
      </div>
      <div class="tablebox audit-tablebox"><table class="table audit-table responsive-data-table"><thead><tr><th class="sortable-th" id="audit-sort-date" data-dir="desc">Fecha</th><th>Usuario</th><th>Acción</th><th>Entidad</th><th>Campo</th><th>Antes</th><th>Después</th></tr></thead><tbody id="audit-body"></tbody></table><div id="audit-empty" class="empty hide">No hay registros para los filtros seleccionados.</div></div>`;
    const period=$('#audit-period'),from=$('#audit-from'),to=$('#audit-to');
    const applyPreset=()=>{if(period.value==='custom')return;const [a,b]=auditPresetRange(period.value);from.value=a;to.value=b;render()};
    const filteredRows=()=>{const q=$('#audit-search').value.trim().toLowerCase(),entity=$('#audit-entity').value,action=$('#audit-action').value,user=$('#audit-user').value,a=from.value,b=to.value;return rows.filter(r=>{const d=auditDateOnly(r.FechaHora);return (!a||d>=a)&&(!b||d<=b)&&(!entity||r.Entidad===entity)&&(!action||r.Accion===action)&&(!user||r.Usuario===user)&&Object.values(r).join(' ').toLowerCase().includes(q)})};
    let auditSortDir='desc';const render=()=>{const filtered=[...filteredRows()].sort((a,b)=>{const av=new Date(a.FechaHora||0).getTime(),bv=new Date(b.FechaHora||0).getTime();return auditSortDir==='asc'?av-bv:bv-av});$('#audit-count').textContent=`Mostrando ${filtered.length} de ${rows.length}`;$('#audit-body').innerHTML=filtered.map(r=>`<tr><td data-label="Fecha">${esc(shortDateTime(r.FechaHora))}</td><td data-label="Usuario"><b>${esc(r.UsuarioNombre||r.Usuario)}</b>${r.UsuarioNombre&&r.Usuario?`<span class="subtle">${esc(r.Usuario)}</span>`:''}</td><td data-label="Acción">${esc(r.Accion)}</td><td data-label="Entidad">${esc(r.Entidad)} · ${esc(r.ID_Entidad)}</td><td data-label="Campo">${esc(r.Campo)}</td><td data-label="Antes">${auditValue(r.ValorAnterior,r.ValorAnteriorNombre)}</td><td data-label="Después">${auditValue(r.ValorNuevo,r.ValorNuevoNombre)}</td></tr>`).join('');$('#audit-empty').classList.toggle('hide',!!filtered.length)};
    const sortDate=$('#audit-sort-date');if(sortDate){sortDate.onclick=()=>{auditSortDir=auditSortDir==='desc'?'asc':'desc';sortDate.dataset.dir=auditSortDir;render()}};period.onchange=applyPreset;from.onchange=()=>{period.value='custom';render()};to.onchange=()=>{period.value='custom';render()};['#audit-search','#audit-user','#audit-entity','#audit-action'].forEach(id=>{const el=$(id);el[el.tagName==='INPUT'?'oninput':'onchange']=render});
    $('#audit-clear').onclick=()=>{$('#audit-search').value='';$('#audit-user').value='';$('#audit-entity').value='';$('#audit-action').value='';period.value='30';applyPreset()};
    $('#audit-export-xlsx').onclick=()=>{const filtered=filteredRows();if(!filtered.length){toast('No hay registros para exportar.',true);return}const suffix=[from.value||'inicio',to.value||'hoy'].join('_'),cols=['FechaHora','UsuarioNombre','Usuario','Accion','Entidad','ID_Entidad','Campo','ValorAnterior','ValorNuevo','Observaciones'];downloadXlsx(`auditoria_${suffix}.xlsx`,filtered,cols,'Auditoria').catch(err)};$('#audit-export-csv').onclick=()=>{const filtered=filteredRows();if(!filtered.length){toast('No hay registros para exportar.',true);return}const suffix=[from.value||'inicio',to.value||'hoy'].join('_');downloadCsv(`auditoria_${suffix}.csv`,filtered,['FechaHora','UsuarioNombre','Usuario','Accion','Entidad','ID_Entidad','Campo','ValorAnterior','ValorNuevo','Observaciones'])};
    applyPreset();
  }catch(e){err(e)}
}
