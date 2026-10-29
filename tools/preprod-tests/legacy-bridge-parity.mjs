import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const adapter = read('assets/js/supabase-final-adapter.js');
const advanced = read('assets/js/admin/advanced.js');
const admin = read('supabase/functions/parking-admin/index.ts');
const bridge = read('legacy-apps-script/LegacyBridge.gs');
const preprod = read('preproduccion.html');

const checks = [
  ['frontend bridge version', read('assets/js/core.js').includes("2.0.0-preprod.2")],
  ['preprod cache bust bridge', preprod.includes('system-v2-bridge')],
  ['frontend no contiene bridge secret', !adapter.includes('PARKING_BRIDGE_SECRET') && !advanced.includes('PARKING_BRIDGE_SECRET')],
  ['parking-admin usa secrets server-side', admin.includes("Deno.env.get('LEGACY_BRIDGE_SECRET')") && admin.includes("Deno.env.get('LEGACY_APPS_SCRIPT_URL')")],
  ['parking-admin firma HMAC', admin.includes("name: 'HMAC'") && admin.includes("hash: 'SHA-256'")],
  ['bridge ROOT-only', admin.includes("action === 'legacyBridgeCommand'") && admin.includes("Acceso exclusivo ROOT" )],
  ['bridge protege replay', bridge.includes('PARKING_BRIDGE_NONCE_') && bridge.includes('Solicitud bridge repetida')],
  ['bridge verifica HMAC', bridge.includes('computeHmacSha256Signature')],
  ['bridge allowlist mail/docs', bridge.includes("mail:['testWelcome'") && bridge.includes("documents:['configureFolder'")],
  ['bridge resultados separados por ID', bridge.includes('PARKING_BRIDGE_RESULT_PREFIX') && bridge.includes('parkingBridgeResultKey_') && !bridge.includes("PARKING_BRIDGE_RESULTS_PROP='PARKING_BRIDGE_RESULTS'")],
  ['bridge cola acotada', bridge.includes('PARKING_BRIDGE_QUEUE_LIMIT=20')],
  ['mail bridge worker separado', bridge.includes('processParkingBridgeMailCommandsWorker') && bridge.includes('installParkingBridgeMailWorkerUi')],
  ['docs bridge worker separado', bridge.includes('processParkingBridgeDocumentCommandsWorker') && bridge.includes('installParkingBridgeDocumentWorkerUi')],
  ['mail actions UI', advanced.includes("data-domain=\"${domain}\"") && advanced.includes("['testWelcome','Probar correo']") && advanced.includes("['processQueue','Procesar ahora']")],
  ['docs actions UI', advanced.includes("['verifyDrive','Verificar Drive']") && advanced.includes("['generateMissing','Generar faltantes']") && advanced.includes("['processQueue','Procesar pendientes']")],
  ['frontend polling de comando', advanced.includes('systemLegacyBridgeCommandStatus') && advanced.includes('Esperando al bridge worker')],
  ['adapter expone acciones bridge', adapter.includes("case 'systemLegacyBridgeAction'") && adapter.includes("case 'systemLegacyBridgeCommandStatus'")],
  ['bridge no reemplaza doGet', !bridge.includes('function doGet(')],
  ['docs legacy quedan marcados', bridge.includes("source:'LEGACY_SHEET'")]
];

let failed = 0;
for (const [label, ok] of checks) {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}`);
  if (!ok) failed += 1;
}
if (failed) process.exit(1);
console.log('Legacy Apps Script bridge parity static tests: OK');
