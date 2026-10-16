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
    let page=1,pageSize=50,searchTimer=null,lastResponse=null;
    $('#main').innerHTML=`<div class="head"><h1>Auditoría</h1>${exportButtonsHtml('audit-export')}</div>
      <div class="filterbar">
        <div class="field"><label>Período</label><select id="audit-period"><option value="30" selected>Últimos 30 días</option><option value="today">Hoy</option><option value="7">Últimos 7 días</option><option value="month">Mes actual</option><option value="prevmonth">Mes anterior</option><option value="all">Todo</option><option value="custom">Personalizado</option></select></div>
        <div class="field"><label>Desde</label><input id="audit-from" type="date"></div>
        <div class="field"><label>Hasta</label><input id="audit-to" type="date"></div>
        <div class="field filter-search"><label>Buscar</label><input id="audit-search" class="search" placeholder="Nombre, email, acción, entidad o valor..."></div>
        <div class="field"><label>Usuario</label><select id="audit-user"><option value="">Todos</option></select></div>
        <div class="field"><label>Entidad</label><select id="audit-entity"><option value="">Todas</option></select></div>
        <div class="field"><label>Acción</label><select id="audit-action"><option value="">Todas</option></select></div>
        <div class="field audit-page-size"><label>Filas</label><select id="audit-page-size"><option>25</option><option selected>50</option><option>100</option></select></div>
        <button type="button" class="secondary" id="audit-clear">Limpiar</button><span class="count" id="audit-count"></span>
      </div>
      <div class="tablebox"><table class="table"><thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Entidad</th><th>Campo</th><th>Antes</th><th>Después</th></tr></thead><tbody id="audit-body"></tbody></table><div id="audit-empty" class="empty hide">No hay registros para los filtros seleccionados.</div></div><div id="audit-pager"></div>`;
    const period=$('#audit-period'),from=$('#audit-from'),to=$('#audit-to'),user=$('#audit-user'),entity=$('#audit-entity'),action=$('#audit-action'),search=$('#audit-search'),size=$('#audit-page-size');
    const payload=()=>({page,pageSize,q:search.value.trim(),user:user.value,entity:entity.value,action:action.value,from:from.value,to:to.value});
    const fillOptions=data=>{
      const keepUser=user.value,keepEntity=entity.value,keepAction=action.value;
      user.innerHTML='<option value="">Todos</option>'+((data.users||[]).map(u=>`<option value="${esc(u.email)}">${esc(u.name)}</option>`).join(''));
      entity.innerHTML='<option value="">Todas</option>'+((data.entities||[]).map(v=>`<option>${esc(v)}</option>`).join(''));
      action.innerHTML='<option value="">Todas</option>'+((data.actions||[]).map(v=>`<option>${esc(v)}</option>`).join(''));
      if([...user.options].some(o=>o.value===keepUser))user.value=keepUser;
      if([...entity.options].some(o=>o.value===keepEntity))entity.value=keepEntity;
      if([...action.options].some(o=>o.value===keepAction))action.value=keepAction;
    };
    const renderPage=data=>{
      lastResponse=data;page=data.page||1;pageSize=data.pageSize||pageSize;size.value=String(pageSize);fillOptions(data);
      const rows=data.rows||[],start=rows.length?((page-1)*pageSize+1):0,end=rows.length?start+rows.length-1:0;
      $('#audit-count').textContent=`Mostrando ${start}–${end} de ${data.total||0}`;
      $('#audit-body').innerHTML=rows.map(r=>`<tr><td>${esc(shortDateTime(r.FechaHora))}</td><td><b>${esc(r.UsuarioNombre||r.Usuario)}</b>${r.UsuarioNombre&&r.Usuario?`<span class="subtle">${esc(r.Usuario)}</span>`:''}</td><td>${esc(r.Accion)}</td><td>${esc(r.Entidad)} · ${esc(r.ID_Entidad)}</td><td>${esc(r.Campo)}</td><td>${auditValue(r.ValorAnterior,r.ValorAnteriorNombre)}</td><td>${auditValue(r.ValorNuevo,r.ValorNuevoNombre)}</td></tr>`).join('');
      $('#audit-empty').classList.toggle('hide',!!rows.length);
      $('#audit-pager').innerHTML=`<div class="pager"><span class="muted">Página ${data.page||1} de ${data.pages||1} · ${data.total||0} registros</span><div class="actions"><button class="secondary" id="audit-prev" ${(data.page||1)<=1?'disabled':''}>← Anterior</button><button class="secondary" id="audit-next" ${(data.page||1)>=(data.pages||1)?'disabled':''}>Siguiente →</button></div></div>`;
      $('#audit-prev').onclick=()=>{page=Math.max(1,page-1);load()};$('#audit-next').onclick=()=>{page=Math.min(data.pages||1,page+1);load()};
    };
    const load=async()=>{try{renderPage(await call('listAuditPage',payload()))}catch(e){err(e)}};
    const applyPreset=()=>{if(period.value==='custom')return;const [a,b]=auditPresetRange(period.value);from.value=a;to.value=b;page=1;load()};
    const clientFilteredExport=rows=>{const p=payload(),q=String(p.q||'').toLowerCase();return rows.filter(r=>{const d=auditDateOnly(r.FechaHora);return (!p.from||d>=p.from)&&(!p.to||d<=p.to)&&(!p.entity||r.Entidad===p.entity)&&(!p.action||r.Accion===p.action)&&(!p.user||r.Usuario===p.user)&&(!q||Object.values(r).join(' ').toLowerCase().includes(q))})};
    const exportRows=async()=>{const rows=(await call('listAudit')).reverse();return clientFilteredExport(rows)};
    period.onchange=applyPreset;from.onchange=()=>{period.value='custom';page=1;load()};to.onchange=()=>{period.value='custom';page=1;load()};
    search.oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{page=1;load()},320)};
    [user,entity,action].forEach(el=>el.onchange=()=>{page=1;load()});
    size.onchange=()=>{pageSize=Number(size.value)||50;page=1;load()};
    $('#audit-clear').onclick=()=>{search.value='';user.value='';entity.value='';action.value='';period.value='30';pageSize=50;size.value='50';applyPreset()};
    $('#audit-export-xlsx').onclick=async()=>{try{const filtered=await exportRows();if(!filtered.length){toast('No hay registros para exportar.',true);return}const suffix=[from.value||'inicio',to.value||'hoy'].join('_'),cols=['FechaHora','UsuarioNombre','Usuario','Accion','Entidad','ID_Entidad','Campo','ValorAnterior','ValorNuevo','Observaciones'];await downloadXlsx(`auditoria_${suffix}.xlsx`,filtered,cols,'Auditoria')}catch(e){err(e)}};
    $('#audit-export-csv').onclick=async()=>{try{const filtered=await exportRows();if(!filtered.length){toast('No hay registros para exportar.',true);return}const suffix=[from.value||'inicio',to.value||'hoy'].join('_');downloadCsv(`auditoria_${suffix}.csv`,filtered,['FechaHora','UsuarioNombre','Usuario','Accion','Entidad','ID_Entidad','Campo','ValorAnterior','ValorNuevo','Observaciones'])}catch(e){err(e)}};
    applyPreset();
  }catch(e){err(e)}
}
