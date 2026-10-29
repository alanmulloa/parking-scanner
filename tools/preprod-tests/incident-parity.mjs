import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const source = fs.readFileSync(new URL('../../assets/js/supabase-final-adapter.js', import.meta.url), 'utf8');
const fakeSb = {
  auth: { onAuthStateChange() {}, getUser: async () => ({ data: { user: { id: '00000000-0000-4000-8000-000000000001' } } }) },
  rpc: async () => ({ data: null, error: null }),
  from() { throw new Error('No DB access expected in pure incident tests'); },
  storage: { from() { throw new Error('No storage access expected'); } }
};
const ctx = {
  console,
  URL,
  Intl,
  Date,
  Map,
  Set,
  Blob,
  Uint8Array,
  crypto: webcrypto,
  atob: (v) => Buffer.from(v, 'base64').toString('binary'),
  performance: { now: () => 0 },
  localStorage: { setItem() {}, removeItem() {} },
  window: {
    parkingSupabase: fakeSb,
    PARKING_PREPROD_TEST_HOOKS: true,
    SUPABASE_POC_CONFIG: { url: 'https://example.supabase.co', publishableKey: 'anon' }
  },
  server: async () => null,
  defaultViewForRole: () => 'login'
};
ctx.window.window = ctx.window;
vm.createContext(ctx);
vm.runInContext(source, ctx, { filename: 'supabase-final-adapter.js' });
const h = ctx.window.__parkingPreprodTestHooks;
if (!h) throw new Error('Test hooks not exposed');

const ok = (condition, message) => { if (!condition) throw new Error(message); };
const test = (name, fn) => { try { fn(); console.log(`OK   ${name}`); } catch (e) { console.error(`FAIL ${name}\n${e.stack}`); process.exitCode = 1; } };

const mk = (bState = 'Activo', sameOwner = false) => {
  const vehicles = [
    { id:'VA', dwelling_id:'HA', habitual_plate:'AAA111', type:'Particular', state:'Activo', slot:1, qr_token:'QRA', qr_state:'Activo' },
    { id:'VB', dwelling_id:'HB', habitual_plate:'BBB222', type:'Particular', state:bState, slot:bState==='Activo'?1:null, qr_token:'QRB', qr_state:bState==='Activo'?'Activo':null },
    { id:'VC', dwelling_id:'HC', habitual_plate:'CCC333', type:'Particular', state:'Activo', slot:1, qr_token:'QRC', qr_state:'Activo' }
  ];
  const dwellings = [
    { id:'HA', responsible_user_id:'UA', state:'Activo' },
    { id:'HB', responsible_user_id:sameOwner?'UA':'UB', state:'Activo' },
    { id:'HC', responsible_user_id:'UC', state:'Activo' }
  ];
  return { vehicles, periods:[], dwellings, requests:[], vehiclesById:new Map(vehicles.map(v=>[v.id,v])), dwellingsById:new Map(dwellings.map(d=>[d.id,d])) };
};
const input = (observed='BBB222') => ({
  Tipo:'Uso indebido', Situacion:'Cesión de QR', OrigenControl:'QR', EstadoOrigen:'AUTORIZADO',
  ID_Vehiculo:'VA', ID_Vivienda:'HA', MatriculaAutorizada:'AAA111', MatriculaObservada:observed,
  Descripcion:'Uso QR ajeno', Foto:'storage:test/photo.jpg'
});

test('QR A+B distinto propietario crea Cesión + Uso ajeno con evento común', () => {
  const rows = h.buildIncidentCandidates(input(), mk());
  ok(rows.length === 2, 'deben existir dos patas');
  const giver = rows.find(r => r.situation === 'Cesión de QR');
  const user = rows.find(r => r.situation === 'Uso de QR ajeno');
  ok(giver?.vehicle_id === 'VA' && user?.vehicle_id === 'VB', 'asignación incorrecta');
  ok(giver.event_id === user.event_id, 'deben compartir evento QR');
  ok(giver.related_vehicle_id === 'VB' && user.related_vehicle_id === 'VA', 'relaciones cruzadas incorrectas');
});

test('QR A+B suspendido crea tercera pata de Acceso con evento independiente', () => {
  const rows = h.buildIncidentCandidates(input(), mk('Suspendido'));
  ok(rows.length === 3, 'deben existir tres patas');
  const giver = rows.find(r => r.situation === 'Cesión de QR');
  const user = rows.find(r => r.situation === 'Uso de QR ajeno');
  const access = rows.find(r => r.type === 'Acceso no autorizado');
  ok(giver && user && access, 'faltan patas');
  ok(giver.event_id === user.event_id, 'QR debe compartir evento');
  ok(access.event_id !== giver.event_id, 'Acceso debe tener evento separado');
  ok(access.vehicle_id === 'VB', 'Acceso debe imputarse al observado');
});

test('QR entre vehículos del mismo propietario crea mismatch sobre observado', () => {
  const rows = h.buildIncidentCandidates(input(), mk('Activo', true));
  ok(rows.length === 1, 'debe existir una única incidencia');
  ok(rows[0].type === 'QR no corresponde con matrícula', 'tipo incorrecto');
  ok(rows[0].vehicle_id === 'VB' && rows[0].related_vehicle_id === 'VA', 'asignación/relación incorrecta');
});

test('QR con matrícula desconocida crea Cesión + matrícula no registrada', () => {
  const rows = h.buildIncidentCandidates(input('ZZZ999'), mk());
  ok(rows.length === 2, 'deben existir dos patas');
  const unknown = rows.find(r => r.type === 'Matrícula no registrada');
  ok(unknown && !unknown.vehicle_id && !unknown.dwelling_id, 'no debe inventarse vehículo/vivienda');
  ok(unknown.related_vehicle_id === 'VA', 'debe conservar origen del QR');
});

test('Acciones mismatch revocan QR relacionado y suspenden observado', () => {
  const refs = { ...mk(), vehicleById: mk().vehiclesById };
  refs.vehicles = [...refs.vehiclesById.values()].map(v => ({ ID_Vehiculo:v.id, MatriculaHabitual:v.habitual_plate, MatriculaTemporal:'', Tipo:v.type, Estado:v.state, QR_Estado:v.qr_state }));
  refs.vehicleById = new Map(refs.vehicles.map(v => [v.ID_Vehiculo, v]));
  const actions = h.incidentAllowedActionsClient({ type:'QR no corresponde con matrícula', vehicle_id:'VB', related_vehicle_id:'VA', situation:'Vehículo del mismo propietario' }, refs);
  ok(actions.includes('Revocar QR'), 'debe permitir revocar QR origen');
  ok(actions.includes('Suspender vehículo'), 'debe permitir suspender observado');
  ok(!actions.includes('Dar de baja'), 'no debe ofrecer baja');
});

if (!process.exitCode) console.log('Incident parity pure tests: OK');
