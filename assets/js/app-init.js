window.addEventListener('unhandledrejection',e=>{if(e&&e.reason)err(e.reason instanceof Error?e.reason:new Error(String(e.reason)))});
window.addEventListener('error',e=>{if(e&&e.error)err(e.error)});
init();
