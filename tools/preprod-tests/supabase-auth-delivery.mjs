import fs from 'node:fs';
const admin=fs.readFileSync('supabase/functions/parking-admin/index.ts','utf8');
const adapter=fs.readFileSync('assets/js/supabase-final-adapter.js','utf8');
const ui=fs.readFileSync('assets/js/admin/management.js','utf8');
const saveBlock=admin.slice(admin.indexOf("action === 'saveUser'"),admin.indexOf('const targetId',admin.indexOf("action === 'saveUser'")));
const tests=[
['alta usa inviteUserByEmail',admin.includes('inviteUserByEmail')],
['alta no crea password aleatoria',!saveBlock.includes('passwordValue()')],
['invite usa redirectTo',admin.includes('AccessRedirectTo')],
['admin reset usa Supabase',admin.includes("action === 'sendPasswordReset'")&&admin.includes('resetPasswordForEmail')],
['reset auditado',admin.includes('PASSWORD_RESET_SENT')],
['adapter expone adminSendPasswordReset',adapter.includes("case 'adminSendPasswordReset'")],
['saveUser manda URL activacion',adapter.includes('AccessRedirectTo')&&adapter.includes('?resetPassword=1')],
['UI prioriza enlace seguro',ui.includes('Enviar enlace para crear/restablecer contraseña')],
['UI mantiene temporal asistida',ui.includes('Generar contraseña temporal')],
['UI no promete email temporal',ui.includes('no se enviará por correo')],
['nuevo usuario informa invitacion',ui.includes('Invitación enviada por correo')]
];
let failed=false;for(const [label,ok] of tests){console.log(`${ok?'OK  ':'FAIL'} ${label}`);if(!ok)failed=true;}if(failed)process.exit(1);console.log('Supabase auth delivery parity: OK');
