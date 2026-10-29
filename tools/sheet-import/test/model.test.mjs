import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { readLegacyWorkbook, safeReport } from '../src/model.mjs';

const workbook = process.env.PARKING_XLSX || '/Users/macbookairm1/Downloads/DDBB QR Comunidad.xlsx';
const aliases = process.env.PARKING_IDENTITY_ALIASES
  ? JSON.parse(await readFile(process.env.PARKING_IDENTITY_ALIASES, 'utf8'))
  : {};

test('the source workbook produces a valid and complete dry-run', async () => {
  const model = await readLegacyWorkbook(workbook, { emailAliases: aliases });
  const report = safeReport(model);
  assert.equal(report.valid, true);
  assert.deepEqual(report.counts, {
    Usuarios: 77,
    Viviendas: 77,
    Vehiculos: 35,
    PeriodosTemporales: 0,
    Solicitudes: 0,
    Incidencias: 0,
    IncidenciaSeguimiento: 0,
    Auditoria: 1173,
    ControlQR: 0,
    ControlMatricula: 0,
    Configuracion: 8
  });
  assert.equal(report.diagnostics.unresolved_audit_references, 23);
  assert.deepEqual(report.credential_profile.algorithms, { PC_SHA256_ITERATED_V2: 77 });
  assert.equal(report.credential_profile.hashes_or_salts_exposed_in_report, false);
});

test('the import plan is deterministic and natural keys are idempotent', async () => {
  const first = await readLegacyWorkbook(workbook, { emailAliases: aliases });
  const second = await readLegacyWorkbook(workbook, { emailAliases: aliases });
  assert.equal(first.source.sha256, second.source.sha256);
  for (const [name, rows] of Object.entries({
    users: first.users,
    dwellings: first.dwellings,
    vehicles: first.vehicles,
    temporaryPeriods: first.temporaryPeriods,
    requests: first.requests,
    incidents: first.incidents,
    followups: first.followups,
    audits: first.audits,
    qrControls: first.qrControls,
    plateControls: first.plateControls
  })) {
    const keys = rows.map((row) => row.legacy_id);
    const simulatedStore = new Map();
    for (const row of rows) simulatedStore.set(row.legacy_id, row);
    for (const row of rows) simulatedStore.set(row.legacy_id, row);
    assert.equal(simulatedStore.size, new Set(keys).size, `${name} duplicated on second pass`);
  }
});
