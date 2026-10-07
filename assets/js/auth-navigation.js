
function userRoles(){return String(state.user?.Rol||'').split(',').map(x=>x.trim()).filter(Boolean)}
function hasUiRole(role){return userRoles().includes(role)}
async function init(){if(!state.token)return login();try{const data=await call('bootstrap');state.user=data.user;state.cache.bootstrap=data;shell();if(INITIAL_TOKEN&&(hasUiRole('ADMIN')||hasUiRole('CONTROL'))){state.view='control';renderNav();control(INITIAL_TOKEN)}else go(hasUiRole('ADMIN')?'dashboard':hasUiRole('CONTROL')?'control':'ownerHousing')}catch(e){login(e.message)}}
function login(message=''){
  $('#app').innerHTML=`<main class="login"><section class="card"><div class="mark">P</div><h1>Parking Comunidad</h1><p class="muted">Accede con tu email y contraseña.</p>${message?`<div class="message bad">${esc(message)}</div>`:''}<form id="login-form"><div class="field" style="text-align:left"><label>Email</label><input id="email" type="email" required autocomplete="username"></div><div class="field" style="text-align:left;margin-top:.8rem"><label>Contraseña</label><input id="password" type="password" required autocomplete="current-password"></div><button>Entrar</button></form><p class="muted" style="font-size:.8rem;margin-top:1rem">Si todavía no tienes contraseña, solicítala al administrador.</p></section></main>`;
  $('#login-form').onsubmit=async e=>{e.preventDefault();const b=e.submitter;busy(b);try{const out=await server('loginWithPassword',$('#email').value,$('#password').value);state.token=out.token;state.user=out.user;state.cache={};localStorage.setItem('parking_token',out.token);shell();if(INITIAL_TOKEN&&(hasUiRole('ADMIN')||hasUiRole('CONTROL'))){state.view='control';renderNav();await control(INITIAL_TOKEN)}else go(hasUiRole('ADMIN')?'dashboard':hasUiRole('CONTROL')?'control':'ownerHousing')}catch(x){toast(x.message,true);busy(b,false)}}
}
function shell(){$('#app').innerHTML=`<header class="top"><div class="brand">Parking Comunidad</div><nav class="nav" id="nav"></nav><div class="who"><b>${esc(state.user.Nombre)}</b><br>${esc(userRoles().join(" · "))}</div><button class="secondary" id="logout">Salir</button></header><main class="wrap" id="main"></main>`;$('#logout').onclick=async()=>{await server('logout',state.token);localStorage.removeItem('parking_token');state.token='';login()};renderNav()}
function renderNav(){const map={ADMIN:[['dashboard','Resumen'],['search','Buscar'],['users','Usuarios'],['housing','Viviendas'],['vehicles','Vehículos'],['incidents','Incidencias'],['requests','Solicitudes'],['audit','Auditoría'],['control','Control']],CONTROL:[['control','Control'],['search','Buscar'],['incidents','Incidencias']],PROPIETARIO:[['ownerHousing','Mis viviendas'],['ownerVehicles','Mis vehículos'],['ownerRequests','Mis solicitudes'],['profile','Mis datos']]};const items=[],seen=new Set();userRoles().forEach(role=>(map[role]||[]).forEach(item=>{if(!seen.has(item[0])){seen.add(item[0]);items.push(item)}}));$('#nav').innerHTML=items.map(([v,l])=>`<button data-view="${v}" class="${state.view===v?'active':''}">${l}</button>`).join('');$('#nav').querySelectorAll('button').forEach(b=>b.onclick=()=>go(b.dataset.view))}
function stopScanner(){if(state.scanner){try{state.scanner.stop().catch(()=>{})}catch(e){}state.scanner=null}}
function viewLabel(view){const labels={dashboard:'Resumen',search:'Buscar',users:'Usuarios',housing:'Viviendas',vehicles:'Vehículos',incidents:'Incidencias',requests:'Solicitudes',audit:'Auditoría',control:'Control',ownerHousing:'Mis viviendas',ownerVehicles:'Mis vehículos',ownerRequests:'Mis solicitudes',profile:'Mis datos'};return labels[view]||'Parking'}
function renderLoading(view){const main=$('#main');if(!main)return;main.innerHTML=`<section class="card loading-state"><div class="spinner"></div><h2>${esc(viewLabel(view))}</h2><p class="muted">Cargando datos…</p></section>`}
function go(view){stopScanner();state.view=view;state.navSeq++;renderNav();renderLoading(view);const fn=({dashboard,search:globalSearchView,users,housing,vehicles,incidents,requests,audit,control,ownerHousing,ownerVehicles,ownerRequests,profile}[view]||ownerHousing);Promise.resolve().then(fn).catch(err)}
function err(e){
  const message=(e&&e.message)||String(e)||'No se pudo cargar la información.';
  toast(message,true);
  const main=$('#main');if(!main)return;
  const stillLoading=!!main.querySelector('.loading-state,.spinner')||!main.textContent.trim();
  if(stillLoading){
    const view=state.view;
    main.innerHTML=`<section class="card retry-state"><h2>No se pudo cargar ${esc(viewLabel(view).toLowerCase())}</h2><p class="muted">${esc(message)}</p><div class="actions"><button id="retry-view">Reintentar</button><button class="secondary" id="retry-home">Ir al inicio</button></div></section>`;
    $('#retry-view').onclick=()=>go(view);
    $('#retry-home').onclick=()=>go(hasUiRole('ADMIN')?'dashboard':hasUiRole('CONTROL')?'control':'ownerHousing');
  }
}
