import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

const adapter = read('assets/js/supabase-final-adapter.js');
const advanced = read('assets/js/admin/advanced.js');
const admin = read('supabase/functions/parking-admin/index.ts');
const bridge = read('legacy-apps-script/LegacyBridge.gs');
const preprod = read('index.html');

const checks = [
  ['frontend bridge version', read('assets/js/core.js').includes("2.0.0-preprod.4")],
  ['preprod cache bust bridge', preprod.includes('system-v2-bridge')],

  ['frontend no contiene bridge secret',
    !adapter.includes('PARKING_BRIDGE_SECRET') &&
    !advanced.includes('PARKING_BRIDGE_SECRET')],

  ['parking-admin usa secrets server-side',
    admin.includes("Deno.env.get('LEGACY_BRIDGE_SECRET')") &&
    admin.includes("Deno.env.get('LEGACY_APPS_SCRIPT_URL')")],

  ['parking-admin firma HMAC',
    admin.includes("name: 'HMAC'") &&
    admin.includes("hash: 'SHA-256'")],

  ['bridge ROOT-only',
    admin.includes("action === 'legacyBridgeCommand'") &&
    admin.includes("Acceso exclusivo ROOT")],

  ['bridge protege replay',
    bridge.includes('PARKING_BRIDGE_NONCE_') &&
    bridge.includes('Solicitud bridge repetida')],

  ['bridge verifica HMAC',
    bridge.includes('computeHmacSha256Signature')],

  ['bridge allowlist solo documentos',
    bridge.includes("documents:['configureFolder'") &&
    !bridge.includes("mail:['testWelcome'")],

  ['bridge no conserva cola mail',
    !bridge.includes('PARKING_BRIDGE_MAIL_QUEUE_PROP')],

  ['bridge no conserva heartbeat mail',
    !bridge.includes('PARKING_BRIDGE_MAIL_HEARTBEAT_PROP')],

  ['bridge no conserva worker mail',
    !bridge.includes('processParkingBridgeMailCommandsWorker') &&
    !bridge.includes('installParkingBridgeMailWorker') &&
    !bridge.includes('parkingBridgeMailWorkerStatus')],

  ['bridge no contiene testWelcome',
    !bridge.includes('parkingBridgeTestWelcomeEmail_')],

  ['parking-admin rechaza dominio mail',
    admin.includes("domain !== 'documents'") &&
    !admin.includes("['mail', 'documents']")],

  ['parking-admin auditoría solo documentos',
    admin.includes("entity: 'DOCUMENTOS'") &&
    !admin.includes("domain === 'mail' ? 'CORREO'")],

  ['docs bridge worker',
    bridge.includes('processParkingBridgeDocumentCommandsWorker') &&
    bridge.includes('installParkingBridgeDocumentWorkerUi')],

  ['docs actions UI',
    advanced.includes("['verifyDrive','Verificar Drive']") &&
    advanced.includes("['generateMissing','Generar faltantes']") &&
    advanced.includes("['processQueue','Procesar pendientes']")],

  ['frontend no contiene acciones mail legacy',
    !advanced.includes("['testWelcome','Probar correo']") &&
    !advanced.includes('mail:senderMode') &&
    !advanced.includes('mail:emailStatus') &&
    !advanced.includes("domain==='mail'")],

  ['frontend polling de comando',
    advanced.includes('systemLegacyBridgeCommandStatus') &&
    advanced.includes('Esperando al bridge worker')],

  ['confirmacion bridge persistente',
    advanced.includes('legacyBridgeLastResult') &&
    advanced.includes('Completado') &&
    advanced.includes('legacyCommandMessage')],

  ['consultas bridge directas solo docs',
    advanced.includes('DIRECT_LEGACY_COMMANDS') &&
    advanced.includes('documents:driveStatus') &&
    advanced.includes('documents:workerStatus')],

  ['bridge se refresca asincrono',
    advanced.includes('refreshBridgeStatus') &&
    advanced.includes("call('systemLegacyBridgeStatus')") &&
    advanced.includes('Comprobando en segundo plano')],

  ['systemStatus no bloquea por Apps Script',
    !adapter
      .slice(
        adapter.indexOf("case 'systemStatus'"),
        adapter.indexOf("case 'systemSetMaintenance'")
      )
      .includes('legacyBridgeStatus')],

  ['adapter expone acciones bridge',
    adapter.includes("case 'systemLegacyBridgeAction'") &&
    adapter.includes("case 'systemLegacyBridgeCommandStatus'")],

  ['bridge no reemplaza doGet',
    !bridge.includes('function doGet(')],

  ['backup bridge preservado',
    bridge.includes("action==='backup.status'") &&
    bridge.includes("action==='backup.runNow'")],

  ['docs legacy quedan marcados',
    bridge.includes("source:'LEGACY_SHEET'")]
];

let failed = 0;

for (const [label, ok] of checks) {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}`);
  if (!ok) failed += 1;
}

if (failed) process.exit(1);

console.log('Legacy Apps Script bridge parity static tests: OK');
