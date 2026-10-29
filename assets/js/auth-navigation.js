function userRoles(){const allowed=['ADMIN','CONTROL','PROPIETARIO'];const raw=String(state.user?.Rol||'').toUpperCase().split(/[,;|·]+/).map(x=>x.trim()).filter(Boolean);return [...new Set(raw.filter(x=>allowed.includes(x)))]}
function hasAssignedRole(role){return userRoles().includes(role)}
function hasUiRole(role){return activeUiRole()===role}
function canConfigure(){return !!state.user?.CanConfigure&&activeUiRole()==='ADMIN'}
function canViewSystem(){return !!state.user?.CanSystem&&activeUiRole()==='ADMIN'}
function preferredUiRole(roles=userRoles()){return roles.includes('ADMIN')?'ADMIN':roles.includes('CONTROL')?'CONTROL':roles[0]||'PROPIETARIO'}
function activeUiRole(){const roles=userRoles(),saved=loadUiState().activeRole;if(saved&&roles.includes(saved))return saved;return preferredUiRole(roles)}
function setActiveUiRole(role){if(!userRoles().includes(role))return;saveUiState({activeRole:role});state.activeRole=role;shell();go(defaultViewForRole(role))}
function restoredStartView(){const ui=loadUiState(),role=activeUiRole(),view=ui.view||'';const adminViews=['dashboard','search','dataReview','users','housing','vehicles','incidents','requests','audit','config','profile'];const allowed={ADMIN:adminViews,CONTROL:['control','search','incidents','profile'],PROPIETARIO:['ownerHome','ownerHousing','ownerVehicles','ownerIncidents','ownerRequests','profile']};return (allowed[role]||[]).includes(view)?view:defaultViewForRole(role)}
async function init(){
  applyParkingSettings(appSettings());
  let publicState={};
  try{
    publicState=await server('getPublicAppState');
    if(publicState?.settings){
      state.cache.bootstrap=Object.assign({},state.cache.bootstrap||{},{settings:Object.assign({},appSettings(),publicState.settings)});
      applyParkingSettings(state.cache.bootstrap.settings);
    }
  }catch(_e){}
  if(!state.token){
    if(publicState?.maintenance?.enabled)return renderMaintenanceScreen(publicState);
    return login();
  }
  try{
    const data=await call('bootstrap');state.user=data.user;state.cache.bootstrap=data;applyParkingSettings(data.settings);
    if(publicState?.maintenance?.enabled&&!state.user?.IsRoot)return renderMaintenanceScreen(publicState);
    state.activeRole=activeUiRole();shell();
    if(INITIAL_TOKEN&&activeUiRole()==='CONTROL'){state.view='control';rememberCurrentView('control');renderNav();control(INITIAL_TOKEN)}
    else go(restoredStartView());
  }catch(e){login(e.message)}
}
function login(message=''){
  const renderLogin=()=>{
    const logo=appLogoUrl(),name=appDisplayName(),description=appDescription();
    $('#app').innerHTML=`<main class="login"><section class="card"><div class="login-brand">${logo?`<img class="login-logo" src="${esc(logo)}" alt="Logo de ${esc(name)}" onerror="this.style.display='none';this.nextElementSibling.style.display='grid'">`:''}<div class="mark" style="${logo?'display:none':''}">P</div></div><h1>${esc(name)}</h1><p class="muted login-description">${esc(description)}</p><p class="muted">Accede con tu email y contraseña.</p>${message?`<div class="message bad">${esc(message)}</div>`:''}<form id="login-form"><div class="field" style="text-align:left"><label>Email</label><input id="email" type="email" required autocomplete="username"></div><div class="field" style="text-align:left;margin-top:.8rem"><label>Contraseña</label><input id="password" type="password" required autocomplete="current-password"></div><button>Entrar</button></form><p class="muted" style="font-size:.8rem;margin-top:1rem">Si todavía no tienes contraseña, solicítala al administrador.</p></section></main>`;
    $('#login-form').onsubmit=async e=>{e.preventDefault();const b=e.submitter;busy(b);try{const out=await server('loginWithPassword',$('#email').value,$('#password').value);state.token=out.token;state.user=out.user;state.cache={};localStorage.setItem('parking_token',out.token);try{const boot=await call('bootstrap');state.user=boot.user||state.user;state.cache.bootstrap=boot;applyParkingSettings(boot.settings)}catch(_e){}let publicState={};try{publicState=await server('getPublicAppState')}catch(_e){}if(publicState?.maintenance?.enabled&&!state.user?.IsRoot){renderMaintenanceScreen(publicState);return}const roles=userRoles(),startRole=preferredUiRole(roles);saveUiState({activeRole:startRole,view:defaultViewForRole(startRole)});state.activeRole=startRole;shell();if(INITIAL_TOKEN&&activeUiRole()==='CONTROL'){state.view='control';rememberCurrentView('control');renderNav();await control(INITIAL_TOKEN)}else go(defaultViewForRole(activeUiRole()))}catch(x){toast(x.message,true);busy(b,false)}};
  };
  renderLogin();
  if(!Object.keys(appSettings()).length){server('getPublicParkingSettings').then(settings=>{state.cache.bootstrap=Object.assign({},state.cache.bootstrap||{},{settings});applyParkingSettings(settings);if(!state.token)renderLogin()}).catch(e=>console.warn('No se pudo cargar la configuración pública',e))}
}
function isMobileViewport(){return window.matchMedia&&window.matchMedia('(max-width:720px)').matches}
function canViewConfiguration(){return activeUiRole()==='ADMIN'}
function navigationItemsForRole(role){
  return {
    ADMIN:[['dashboard','Resumen'],['dataReview','Revisión de datos'],['users','Usuarios'],['housing','Viviendas'],['vehicles','Vehículos'],['incidents','Incidencias'],['requests','Solicitudes'],['audit','Auditoría'],['config','Configuración']],
    CONTROL:[['control','Control'],['incidents','Incidencias']],
    PROPIETARIO:[['ownerHome','Inicio'],['ownerHousing','Mis viviendas'],['ownerVehicles','Mis vehículos'],['ownerIncidents','Mis incidencias'],['ownerRequests','Mis solicitudes']]
  }[role]||[];
}
function mobileNavigationForRole(role){
  if(role==='ADMIN')return {
    primary:[['dashboard','Inicio','⌂'],['housing','Viviendas','⌂'],['vehicles','Vehículos','▣']],
    more:[['dataReview','Revisión de datos'],['users','Usuarios'],['incidents','Incidencias'],['requests','Solicitudes'],['config','Configuración']]
  };
  if(role==='CONTROL')return {primary:[['control','Control','✓'],['incidents','Incidencias','!']],more:[]};
  return {primary:[['ownerHome','Inicio','⌂'],['ownerHousing','Viviendas','⌂'],['ownerVehicles','Vehículos','▣']],more:[['ownerIncidents','Mis incidencias'],['ownerRequests','Mis solicitudes']]};
}
function shell(){
  const roles=userRoles(),active=activeUiRole();
  const roleSelector=roles.length>1?`<label class="role-switch-wrap"><span>Perfil</span><select id="role-switch" class="role-switch" aria-label="Perfil activo">${roles.map(r=>`<option value="${esc(r)}" ${r===active?'selected':''}>${esc(r)}</option>`).join('')}</select></label>`:`<span class="role-single">${esc(active)}</span>`;
  const mobileRoleSelector=roles.length>1?`<div class="mobile-role-row"><span>Perfil</span><select id="mobile-role-switch" class="mobile-role-switch" aria-label="Perfil activo">${roles.map(r=>`<option value="${esc(r)}" ${r===active?'selected':''}>${esc(r)}</option>`).join('')}</select></div>`:`<div class="mobile-role-row"><span>Perfil</span><b>${esc(active)}</b></div>`;
  $('#app').innerHTML=`<header class="top"><div class="brand">${appBrandHtml(true)}</div><div class="mobile-header-actions"><button type="button" class="mobile-icon-btn mobile-user-trigger" id="mobile-user-trigger" aria-label="Abrir menú" aria-expanded="false" title="Menú">☰</button></div><div class="mobile-user-menu" id="mobile-user-menu" aria-hidden="true"><div class="mobile-user-summary"><b>${esc(state.user.Nombre)}</b><span>${esc(state.user.Email||'')}</span></div>${mobileRoleSelector}<button type="button" class="mobile-menu-action mobile-menu-search" id="mobile-menu-search"><span>⌕</span><span>Buscar</span></button><button type="button" class="mobile-menu-action" id="mobile-profile"><span>👤</span><span>Mis datos</span></button><button type="button" class="mobile-menu-action danger-text" id="mobile-logout"><span>↪</span><span>Salir</span></button></div><div class="who"><button type="button" class="who-name" id="profile-link" aria-label="Abrir Mis datos" title="Abrir Mis datos"><span class="who-name-text">${esc(state.user.Nombre)}</span><span class="who-profile-hint">Mis datos</span></button><div class="who-role">${roleSelector}</div></div><button class="secondary" id="logout">Salir</button></header><div class="section-nav"><nav class="nav" id="nav"></nav><button type="button" class="global-search-trigger global-search-trigger-desktop" id="global-search-trigger" aria-label="Buscar" title="Buscar">⌕<span>Buscar</span></button></div><nav class="mobile-dock" id="mobile-nav" data-role="${esc(active)}" aria-label="Navegación móvil"></nav><div class="mobile-more-sheet" id="mobile-more-sheet" aria-hidden="true"><button type="button" class="mobile-sheet-backdrop" id="mobile-more-backdrop" aria-label="Cerrar menú"></button><section class="mobile-sheet-panel" role="dialog" aria-modal="true" aria-labelledby="mobile-more-title"><div class="mobile-sheet-handle"></div><div class="mobile-sheet-head"><b id="mobile-more-title">Más secciones</b><button type="button" class="mobile-sheet-close" id="mobile-more-close" aria-label="Cerrar">×</button></div><div class="mobile-more-list" id="mobile-more-list"></div></section></div><main class="wrap" id="main"></main>`;
  const profileLink=$('#profile-link');if(profileLink)profileLink.addEventListener('click',e=>{e.preventDefault();go('profile')});
  document.querySelectorAll('.global-search-trigger').forEach(searchBtn=>searchBtn.addEventListener('click',()=>openGlobalSearchOverlay()));
  const menuSearch=$('#mobile-menu-search');if(menuSearch)menuSearch.onclick=()=>{closeMobileMenus();openGlobalSearchOverlay()};
  const mobileTrigger=$('#mobile-user-trigger');if(mobileTrigger)mobileTrigger.onclick=e=>{e.stopPropagation();toggleMobileUserMenu()};
  const mobileProfile=$('#mobile-profile');if(mobileProfile)mobileProfile.onclick=()=>{closeMobileMenus();go('profile')};
  const rs=$('#role-switch');if(rs)rs.addEventListener('change',()=>setActiveUiRole(rs.value));
  const mrs=$('#mobile-role-switch');if(mrs)mrs.addEventListener('change',()=>setActiveUiRole(mrs.value));
  const doLogout=async()=>{closeMobileMenus();await server('logout',state.token);localStorage.removeItem('parking_token');clearUiState();state.token='';login()};
  $('#logout').onclick=doLogout;const mobileLogout=$('#mobile-logout');if(mobileLogout)mobileLogout.onclick=doLogout;
  const moreClose=$('#mobile-more-close'),moreBackdrop=$('#mobile-more-backdrop');if(moreClose)moreClose.onclick=closeMobileMore;if(moreBackdrop)moreBackdrop.onclick=closeMobileMore;
  renderNav();
}
function renderMobileNavigation(){
  const role=activeUiRole(),model=mobileNavigationForRole(role),dock=$('#mobile-nav'),moreList=$('#mobile-more-list');if(!dock||!moreList)return;
  dock.dataset.role=role;
  const isMoreActive=model.more.some(([v])=>v===state.view),hasMore=model.more.length>0;
  const dockItems=model.primary.map(([v,l,icon])=>`<button type="button" class="mobile-dock-item ${state.view===v?'active':''}" data-mobile-view="${v}"><span class="mobile-dock-icon">${icon}</span><span>${esc(l)}</span></button>`);
  if(hasMore)dockItems.push(`<button type="button" class="mobile-dock-item ${isMoreActive?'active':''}" id="mobile-more-trigger"><span class="mobile-dock-icon">•••</span><span>Más</span></button>`);
  dock.dataset.count=String(dockItems.length);dock.innerHTML=dockItems.join('');
  moreList.innerHTML=model.more.map(([v,l])=>`<button type="button" class="mobile-more-item ${state.view===v?'active':''}" data-mobile-view="${v}"><span>${esc(l)}</span><span aria-hidden="true">›</span></button>`).join('');
  dock.querySelectorAll('[data-mobile-view]').forEach(b=>b.onclick=()=>{const view=b.dataset.mobileView;closeMobileMenus();go(view)});
  moreList.querySelectorAll('[data-mobile-view]').forEach(b=>b.onclick=()=>{const view=b.dataset.mobileView;closeMobileMenus();go(view)});
  const moreTrigger=$('#mobile-more-trigger');if(moreTrigger)moreTrigger.onclick=openMobileMore;
  const sheet=$('#mobile-more-sheet');if(sheet&&!hasMore){sheet.classList.remove('open');sheet.setAttribute('aria-hidden','true')}
}
function renderNav(){
  const role=activeUiRole(),items=navigationItemsForRole(role),nav=$('#nav');if(!nav)return;
  nav.innerHTML=items.map(([v,l])=>`<button data-view="${v}" class="${state.view===v?'active':''}">${l}</button>`).join('');
  nav.querySelectorAll('button[data-view]').forEach(b=>b.onclick=()=>go(b.dataset.view));
  renderMobileNavigation();
}
function mobileOutsideClick(e){const menu=$('#mobile-user-menu'),trigger=$('#mobile-user-trigger');if(menu&&menu.classList.contains('open')&&!menu.contains(e.target)&&!trigger?.contains(e.target))closeMobileUserMenu()}
function toggleMobileUserMenu(){const menu=$('#mobile-user-menu'),trigger=$('#mobile-user-trigger');if(!menu)return;const open=!menu.classList.contains('open');closeMobileMore();menu.classList.toggle('open',open);menu.setAttribute('aria-hidden',String(!open));if(trigger)trigger.setAttribute('aria-expanded',String(open));document.removeEventListener('click',mobileOutsideClick);if(open)setTimeout(()=>document.addEventListener('click',mobileOutsideClick),0)}
function closeMobileUserMenu(){const menu=$('#mobile-user-menu'),trigger=$('#mobile-user-trigger');document.removeEventListener('click',mobileOutsideClick);if(menu){menu.classList.remove('open');menu.setAttribute('aria-hidden','true')}if(trigger)trigger.setAttribute('aria-expanded','false')}
function openMobileMore(){const sheet=$('#mobile-more-sheet');if(!sheet||!$('#mobile-more-list')?.children.length)return;closeMobileUserMenu();sheet.classList.add('open');sheet.setAttribute('aria-hidden','false');document.body.classList.add('mobile-sheet-open')}
function closeMobileMore(){const sheet=$('#mobile-more-sheet');if(sheet){sheet.classList.remove('open');sheet.setAttribute('aria-hidden','true')}document.body.classList.remove('mobile-sheet-open')}
function closeMobileMenus(){closeMobileUserMenu();closeMobileMore()}
function stopScanner(){if(state.scanner){try{state.scanner.stop().catch(()=>{})}catch(e){}state.scanner=null}}
function viewLabel(view){const labels={dashboard:'Resumen',search:'Buscar',config:'Configuración',dataReview:'Revisión de datos',users:'Usuarios',housing:'Viviendas',vehicles:'Vehículos',incidents:'Incidencias',requests:'Solicitudes',audit:'Auditoría',control:'Control',ownerHome:'Inicio',ownerHousing:'Mis viviendas',ownerVehicles:'Mis vehículos',ownerRequests:'Mis solicitudes',ownerIncidents:'Mis incidencias',profile:'Mis datos'};return labels[view]||'Parking'}
function renderLoading(view){const main=$('#main');if(!main)return;main.innerHTML=`<section class="card loading-state"><div class="spinner"></div><h2>${esc(viewLabel(view))}</h2><p class="muted">Cargando datos…</p></section>`}
function go(view){if(view==='audit'&&activeUiRole()==='ADMIN'&&isMobileViewport())view='dashboard';if(view==='config'&&!canViewConfiguration()){view=defaultViewForRole(activeUiRole());toast('No tienes permisos para acceder a Configuración.',true)}if(view==='control'&&activeUiRole()!=='CONTROL'){view=defaultViewForRole(activeUiRole())}closeMobileMenus();stopScanner();state.view=view;rememberCurrentView(view);state.navSeq++;renderNav();renderLoading(view);const fn=({dashboard,search:globalSearchView,config:configurationView,dataReview:consistencyReviewView,users,housing,vehicles,incidents,requests,audit,control,ownerHome,ownerHousing,ownerVehicles,ownerIncidents,ownerRequests,profile}[view]||ownerHome);Promise.resolve().then(fn).then(()=>enhanceMobileFilterBars()).catch(err)}
function err(e){const message=(e&&e.message)||String(e)||'No se pudo cargar la información.';toast(message,true);const main=$('#main');if(!main)return;const stillLoading=!!main.querySelector('.loading-state,.spinner')||!main.textContent.trim();if(stillLoading){const view=state.view;main.innerHTML=`<section class="card retry-state"><h2>No se pudo cargar ${esc(viewLabel(view).toLowerCase())}</h2><p class="muted">${esc(message)}</p><div class="actions"><button id="retry-view">Reintentar</button><button class="secondary" id="retry-home">Ir al inicio</button></div></section>`;$('#retry-view').onclick=()=>go(view);$('#retry-home').onclick=()=>go(defaultViewForRole(activeUiRole()))}}
