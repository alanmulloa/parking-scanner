import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import * as XLSX from 'xlsx';

export const IMPORTER_VERSION = '1.0.0';

export const SHEETS = [
  'Usuarios', 'Viviendas', 'Vehiculos', 'PeriodosTemporales', 'Solicitudes',
  'Incidencias', 'IncidenciaSeguimiento', 'Auditoria', 'ControlQR',
  'ControlMatricula', 'Configuracion'
];

const KNOWN = {
  roles: new Set(['ROOT', 'ADMIN', 'CONTROL', 'PROPIETARIO']),
  userStates: new Set(['Activo', 'Inactivo']),
  dwellingStates: new Set(['Activa', 'Inactiva', 'Activo', 'Inactivo']),
  vehicleStates: new Set(['Activo', 'Desasignado', 'Suspendido', 'Baja']),
  vehicleTypes: new Set(['Particular', 'Empresa', 'Alquiler', 'Moto', 'Otro']),
  qrStates: new Set(['', 'Activo', 'Revocado']),
  temporaryStates: new Set(['Activo', 'Anulado'])
};

export const text = (value) => value == null ? '' : String(value).trim();
export const lower = (value) => text(value).toLowerCase();
export const plate = (value) => text(value).toUpperCase().replace(/[^A-Z0-9]/g, '') || null;
export const asNumber = (value, fallback = 0) => {
  const parsed = Number(text(value));
  return Number.isFinite(parsed) ? parsed : fallback;
};

function excelDateToDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'number') {
    const parsed = new Date(Date.UTC(1899, 11, 30) + value * 86400000);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  const raw = text(value);
  if (!raw || raw === '-') return null;
  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime())) return direct;
  const match = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!match) return undefined;
  const [, day, month, year, hour = '0', minute = '0', second = '0'] = match;
  const parsed = new Date(Date.UTC(+year, +month - 1, +day, +hour, +minute, +second));
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function dateValue(value, context, issues, { dateOnly = false, required = false } = {}) {
  const parsed = excelDateToDate(value);
  if (parsed === null) {
    if (required) issues.errors.push(`${context}: fecha obligatoria vacía`);
    return null;
  }
  if (parsed === undefined) {
    issues.errors.push(`${context}: fecha inválida`);
    return null;
  }
  return dateOnly ? parsed.toISOString().slice(0, 10) : parsed.toISOString();
}

function boolValue(value) {
  if (typeof value === 'boolean') return value;
  return ['1', 'TRUE', 'SI', 'SÍ', 'YES', 'X'].includes(text(value).toUpperCase());
}

function duplicateValues(rows, field, normalize = (value) => text(value).toUpperCase()) {
  const counts = new Map();
  for (const row of rows) {
    const value = normalize(row[field]);
    if (!value) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([value, count]) => ({ value, count }));
}

function assertNoDuplicates(rows, field, label, issues, normalize) {
  for (const duplicate of duplicateValues(rows, field, normalize)) {
    issues.errors.push(`${label}: valor duplicado ${duplicate.value} (${duplicate.count} filas)`);
  }
}

function parseLegacyHash(row, issues) {
  const stored = text(row.PasswordHash);
  const salt = text(row.PasswordSalt);
  const v2 = stored.match(/^v2\$(\d+)\$([0-9a-fA-F]{64})$/);
  if (v2 && salt) return { hash: v2[2].toLowerCase(), salt, algorithm: 'PC_SHA256_ITERATED_V2', iterations: +v2[1] };
  if (/^[0-9a-fA-F]{64}$/.test(stored) && salt) {
    return { hash: stored.toLowerCase(), salt, algorithm: 'PC_SHA256_ITERATED_LEGACY', iterations: 6000 };
  }
  issues.errors.push(`Usuarios/${text(row.ID_Usuario) || '?'}: formato de credencial legacy no reconocido`);
  return { hash: null, salt: null, algorithm: 'UNKNOWN', iterations: 0 };
}

function rowId(row, field) {
  return text(row[field]) || '?';
}

export async function readLegacyWorkbook(filePath, options = {}) {
  const bytes = await readFile(filePath);
  const checksum = createHash('sha256').update(bytes).digest('hex');
  const workbook = XLSX.read(bytes, { type: 'buffer', cellDates: true, raw: true });
  const missingSheets = SHEETS.filter((name) => !workbook.SheetNames.includes(name));
  if (missingSheets.length) throw new Error(`Faltan pestañas obligatorias: ${missingSheets.join(', ')}`);

  const raw = Object.fromEntries(SHEETS.map((name) => [
    name,
    XLSX.utils.sheet_to_json(workbook.Sheets[name], { defval: null, raw: true, blankrows: false })
  ]));
  const issues = { errors: [], warnings: [] };
  const settings = Object.fromEntries(raw.Configuracion.map((row) => [text(row.Clave), row.Valor == null ? '' : String(row.Valor)]));

  const users = raw.Usuarios.map((row) => {
    const roles = text(row.Rol).split(',').map((role) => role.trim().toUpperCase()).filter(Boolean);
    for (const role of roles) if (!KNOWN.roles.has(role)) issues.errors.push(`Usuarios/${rowId(row, 'ID_Usuario')}: rol desconocido ${role}`);
    if (!KNOWN.userStates.has(text(row.Estado))) issues.errors.push(`Usuarios/${rowId(row, 'ID_Usuario')}: estado desconocido ${text(row.Estado)}`);
    return {
      legacy_id: text(row.ID_Usuario), email: lower(row.Email), name: text(row.Nombre), phone: text(row.Telefono),
      roles, state: text(row.Estado), credential: parseLegacyHash(row, issues),
      failed_attempts: asNumber(row.FailedAttempts), locked_until: dateValue(row.LockUntil, `Usuarios/${rowId(row, 'ID_Usuario')}/LockUntil`, issues),
      password_changed_at: dateValue(row.PasswordChangedAt, `Usuarios/${rowId(row, 'ID_Usuario')}/PasswordChangedAt`, issues),
      last_access_at: dateValue(row.LastAccessAt, `Usuarios/${rowId(row, 'ID_Usuario')}/LastAccessAt`, issues),
      session_version: Math.max(1, asNumber(row.SessionVersion, 1))
    };
  });

  const userEmails = new Set(users.map((row) => row.email));
  const userLegacyIds = new Set(users.map((row) => row.legacy_id));
  const dwellings = raw.Viviendas.map((row) => {
    const stateRaw = text(row.Estado);
    if (!KNOWN.dwellingStates.has(stateRaw)) issues.errors.push(`Viviendas/${rowId(row, 'ID_Vivienda')}: estado desconocido ${stateRaw}`);
    const responsibleEmail = lower(row.Responsable);
    if (!userEmails.has(responsibleEmail)) issues.errors.push(`Viviendas/${rowId(row, 'ID_Vivienda')}: responsable no resoluble`);
    return {
      legacy_id: text(row.ID_Vivienda), block: text(row.Bloque), floor: text(row.Planta), apartment: text(row.Apartamento),
      display_name: [text(row.Bloque), text(row.Planta), text(row.Apartamento)].filter(Boolean).join(' · '),
      responsible_email: responsibleEmail, state: stateRaw.startsWith('Activa') ? 'Activo' : stateRaw.startsWith('Inactiva') ? 'Inactivo' : stateRaw,
      observations: text(row.Observaciones), created_at: dateValue(row.FechaAlta, `Viviendas/${rowId(row, 'ID_Vivienda')}/FechaAlta`, issues, { required: true })
    };
  });
  const dwellingIds = new Set(dwellings.map((row) => row.legacy_id));

  const vehicles = raw.Vehiculos.map((row) => {
    const legacyId = text(row.ID_Vehiculo);
    const type = text(row.Tipo);
    const state = text(row.Estado);
    const qrState = text(row.QR_Estado);
    const slot = text(row.Slot) ? asNumber(row.Slot, NaN) : null;
    if (!dwellingIds.has(text(row.ID_Vivienda))) issues.errors.push(`Vehiculos/${legacyId}: vivienda inexistente`);
    if (!KNOWN.vehicleTypes.has(type)) issues.errors.push(`Vehiculos/${legacyId}: tipo desconocido ${type}`);
    if (!KNOWN.vehicleStates.has(state)) issues.errors.push(`Vehiculos/${legacyId}: estado desconocido ${state}`);
    if (!KNOWN.qrStates.has(qrState)) issues.errors.push(`Vehiculos/${legacyId}: estado QR desconocido ${qrState}`);
    if (slot != null && ![1, 2].includes(slot)) issues.errors.push(`Vehiculos/${legacyId}: slot inválido ${text(row.Slot)}`);
    if (type === 'Moto' && slot != null) issues.errors.push(`Vehiculos/${legacyId}: una moto no debe consumir slot`);
    if (type !== 'Moto' && slot == null) issues.errors.push(`Vehiculos/${legacyId}: vehículo no moto sin slot`);
    return {
      legacy_id: legacyId, dwelling_legacy_id: text(row.ID_Vivienda), slot,
      habitual_plate: text(row.MatriculaHabitual), normalized_habitual_plate: plate(row.MatriculaHabitual),
      make: text(row.Marca), model: text(row.Modelo), type, state, qr_token: text(row.QR_Token) || null,
      qr_state: qrState || null, observations: text(row.Observaciones),
      created_at: dateValue(row.FechaAlta, `Vehiculos/${legacyId}/FechaAlta`, issues, { required: true }),
      embedded_temporary: text(row.MatriculaTemporal) ? {
        legacy_id: `${legacyId}:LEGACY_TEMP`, temporary_plate: text(row.MatriculaTemporal),
        starts_at: dateValue(row.TemporalDesde, `Vehiculos/${legacyId}/TemporalDesde`, issues, { dateOnly: true, required: true }),
        ends_at: dateValue(row.TemporalHasta, `Vehiculos/${legacyId}/TemporalHasta`, issues, { dateOnly: true, required: true }),
        state: 'Activo', created_at: dateValue(row.FechaAlta, `Vehiculos/${legacyId}/FechaAlta`, issues), observations: 'Migrado desde columnas temporales de Vehiculos'
      } : null
    };
  });
  const vehicleIds = new Set(vehicles.map((row) => row.legacy_id));

  const temporaryPeriods = raw.PeriodosTemporales.map((row) => {
    const id = text(row.ID_Periodo);
    if (!vehicleIds.has(text(row.ID_Vehiculo))) issues.errors.push(`PeriodosTemporales/${id}: vehículo inexistente`);
    if (!KNOWN.temporaryStates.has(text(row.Estado))) issues.errors.push(`PeriodosTemporales/${id}: estado desconocido ${text(row.Estado)}`);
    return {
      legacy_id: id, vehicle_legacy_id: text(row.ID_Vehiculo), temporary_plate: text(row.MatriculaTemporal),
      starts_at: dateValue(row.Desde, `PeriodosTemporales/${id}/Desde`, issues, { dateOnly: true, required: true }),
      ends_at: dateValue(row.Hasta, `PeriodosTemporales/${id}/Hasta`, issues, { dateOnly: true, required: true }),
      state: text(row.Estado), created_at: dateValue(row.FechaAlta, `PeriodosTemporales/${id}/FechaAlta`, issues),
      created_by_email: lower(row.UsuarioAlta), observations: text(row.Observaciones)
    };
  });
  for (const vehicle of vehicles) if (vehicle.embedded_temporary) temporaryPeriods.push({ ...vehicle.embedded_temporary, vehicle_legacy_id: vehicle.legacy_id, created_by_email: null });

  const requests = raw.Solicitudes.map((row) => ({
    legacy_id: text(row.ID_Solicitud), requested_at: dateValue(row.FechaHora, `Solicitudes/${rowId(row, 'ID_Solicitud')}/FechaHora`, issues, { required: true }),
    requested_by_email: lower(row.Usuario), dwelling_legacy_id: text(row.ID_Vivienda), vehicle_legacy_id: text(row.ID_Vehiculo) || null,
    type: text(row.Tipo), state: text(row.Estado), reason: text(row.Motivo),
    resolved_at: dateValue(row.FechaResolucion, `Solicitudes/${rowId(row, 'ID_Solicitud')}/FechaResolucion`, issues),
    resolved_by_email: lower(row.UsuarioResolucion) || null, resolution_notes: text(row.ObservacionesResolucion),
    origin_vehicle_state: text(row.EstadoVehiculoOrigen) || null, origin_qr_state: text(row.QREstadoOrigen) || null,
    origin_vehicle_type: text(row.TipoVehiculoOrigen) || null, origin_slot: text(row.SlotOrigen) ? asNumber(row.SlotOrigen) : null,
    origin_plate: text(row.MatriculaOrigen) || null,
    start_date: dateValue(row.FechaInicio, `Solicitudes/${rowId(row, 'ID_Solicitud')}/FechaInicio`, issues, { dateOnly: true }),
    end_date: dateValue(row.FechaFin, `Solicitudes/${rowId(row, 'ID_Solicitud')}/FechaFin`, issues, { dateOnly: true })
  }));

  const incidents = raw.Incidencias.map((row) => ({
    legacy_id: text(row.ID_Incidencia), occurred_at: dateValue(row.FechaHora, `Incidencias/${rowId(row, 'ID_Incidencia')}/FechaHora`, issues, { required: true }),
    created_by_email: lower(row.Usuario), observed_plate: text(row.MatriculaObservada) || null,
    authorized_plate: text(row.MatriculaAutorizada) || null, infraction_plate: text(row.MatriculaInfraccion) || null,
    dwelling_legacy_id: text(row.ID_Vivienda) || null, vehicle_legacy_id: text(row.ID_Vehiculo) || null,
    type: text(row.Tipo), description: text(row.Descripcion), legacy_photo_url: text(row.Foto) || null,
    state: text(row.Estado), closed_at: dateValue(row.FechaCierre, `Incidencias/${rowId(row, 'ID_Incidencia')}/FechaCierre`, issues),
    closed_by_email: lower(row.UsuarioCierre) || null, control_origin: text(row.OrigenControl) || null,
    origin_state: text(row.EstadoOrigen) || null, close_action: text(row.AccionCierre) || null,
    close_comment: text(row.ComentarioCierre) || null, origin_vehicle_state: text(row.EstadoVehiculoOrigen) || null,
    origin_qr_state: text(row.QREstadoOrigen) || null, origin_vehicle_type: text(row.TipoVehiculoOrigen) || null,
    origin_slot: text(row.SlotOrigen) ? asNumber(row.SlotOrigen) : null, origin_habitual_plate: text(row.MatriculaHabitualOrigen) || null,
    expired_itv: boolValue(row.ITV_Vencida), event_id: text(row.ID_Evento) || null, situation: text(row.Situacion) || null,
    cause: text(row.Causa) || null, related_dwelling_legacy_id: text(row.ID_ViviendaRelacionada) || null,
    related_vehicle_legacy_id: text(row.ID_VehiculoRelacionado) || null, related_plate: text(row.MatriculaRelacionada) || null,
    attempts: Math.max(1, asNumber(row.Intentos, 1)), priority: text(row.Prioridad) || 'Normal',
    last_followup_at: dateValue(row.UltimoSeguimiento, `Incidencias/${rowId(row, 'ID_Incidencia')}/UltimoSeguimiento`, issues),
    fluid_leak: boolValue(row.FugaLiquidos)
  }));
  const incidentIds = new Set(incidents.map((row) => row.legacy_id));

  const followups = raw.IncidenciaSeguimiento.map((row) => ({
    legacy_id: text(row.ID_Seguimiento), incident_legacy_id: text(row.ID_Incidencia), event_id: text(row.ID_Evento) || null,
    followup_event_id: text(row.ID_EventoSeguimiento) || null,
    occurred_at: dateValue(row.FechaHora, `IncidenciaSeguimiento/${rowId(row, 'ID_Seguimiento')}/FechaHora`, issues, { required: true }),
    created_by_email: lower(row.Usuario), attempt_number: Math.max(1, asNumber(row.NumeroIntento, 1)),
    observed_plate: text(row.MatriculaObservada) || null, authorized_plate: text(row.MatriculaAutorizada) || null,
    control_origin: text(row.OrigenControl) || null, origin_state: text(row.EstadoOrigen) || null,
    situation: text(row.Situacion) || null, related_dwelling_legacy_id: text(row.ID_ViviendaRelacionada) || null,
    related_vehicle_legacy_id: text(row.ID_VehiculoRelacionado) || null, related_plate: text(row.MatriculaRelacionada) || null,
    observation: text(row.Observacion), legacy_photo_url: text(row.Foto) || null
  }));

  const audits = raw.Auditoria.map((row) => ({
    legacy_id: text(row.ID_Auditoria), occurred_at: dateValue(row.FechaHora, `Auditoria/${rowId(row, 'ID_Auditoria')}/FechaHora`, issues, { required: true }),
    actor_email: lower(row.Usuario) || null, action: text(row.Accion), entity: text(row.Entidad),
    legacy_entity_id: text(row.ID_Entidad) || null, field: text(row.Campo) || null,
    previous_value: row.ValorAnterior == null ? null : String(row.ValorAnterior),
    new_value: row.ValorNuevo == null ? null : String(row.ValorNuevo), observations: text(row.Observaciones), source: 'LEGACY_SHEET'
  }));

  const qrControls = raw.ControlQR.map((row) => ({
    legacy_id: text(row.ID_Control), user_email: lower(row.Usuario),
    occurred_at: dateValue(row.FechaHora, `ControlQR/${rowId(row, 'ID_Control')}/FechaHora`, issues, { required: true }),
    scanned_code: text(row.CodigoEscaneado), result: null, metadata: { source: 'LEGACY_SHEET' }
  }));
  const plateControls = raw.ControlMatricula.map((row) => ({
    legacy_id: text(row.ID_Control), user_email: lower(row.Usuario),
    occurred_at: dateValue(row.FechaHora, `ControlMatricula/${rowId(row, 'ID_Control')}/FechaHora`, issues, { required: true }),
    searched_plate: text(row.MatriculaBuscada), result: null, metadata: { source: 'LEGACY_SHEET' }
  }));

  assertNoDuplicates(raw.Usuarios, 'ID_Usuario', 'Usuarios/ID_Usuario', issues);
  assertNoDuplicates(raw.Usuarios, 'Email', 'Usuarios/Email', issues, lower);
  assertNoDuplicates(raw.Viviendas, 'ID_Vivienda', 'Viviendas/ID_Vivienda', issues);
  assertNoDuplicates(raw.Vehiculos, 'ID_Vehiculo', 'Vehiculos/ID_Vehiculo', issues);
  assertNoDuplicates(raw.Vehiculos, 'MatriculaHabitual', 'Vehiculos/MatriculaHabitual', issues, plate);
  assertNoDuplicates(raw.Vehiculos, 'QR_Token', 'Vehiculos/QR_Token', issues);
  assertNoDuplicates(raw.Auditoria, 'ID_Auditoria', 'Auditoria/ID_Auditoria', issues);
  const slotCounts = new Map();
  for (const row of vehicles.filter((item) => item.slot != null)) {
    const key = `${row.dwelling_legacy_id}:${row.slot}`;
    slotCounts.set(key, (slotCounts.get(key) || 0) + 1);
  }
  for (const [key, count] of slotCounts) if (count > 1) issues.errors.push(`Vehiculos/Slot: conflicto ${key} (${count} filas)`);

  for (const row of temporaryPeriods) {
    if (!vehicleIds.has(row.vehicle_legacy_id)) issues.errors.push(`PeriodosTemporales/${row.legacy_id}: vehículo inexistente`);
    if (row.created_by_email && !userEmails.has(row.created_by_email)) issues.errors.push(`PeriodosTemporales/${row.legacy_id}: usuario no resoluble`);
  }
  for (const row of requests) {
    if (!dwellingIds.has(row.dwelling_legacy_id)) issues.errors.push(`Solicitudes/${row.legacy_id}: vivienda inexistente`);
    if (row.vehicle_legacy_id && !vehicleIds.has(row.vehicle_legacy_id)) issues.errors.push(`Solicitudes/${row.legacy_id}: vehículo inexistente`);
    if (row.requested_by_email && !userEmails.has(row.requested_by_email)) issues.errors.push(`Solicitudes/${row.legacy_id}: usuario no resoluble`);
  }
  for (const row of incidents) {
    if (row.dwelling_legacy_id && !dwellingIds.has(row.dwelling_legacy_id)) issues.errors.push(`Incidencias/${row.legacy_id}: vivienda inexistente`);
    if (row.vehicle_legacy_id && !vehicleIds.has(row.vehicle_legacy_id)) issues.errors.push(`Incidencias/${row.legacy_id}: vehículo inexistente`);
  }
  for (const row of followups) if (!incidentIds.has(row.incident_legacy_id)) issues.errors.push(`IncidenciaSeguimiento/${row.legacy_id}: incidencia inexistente`);

  const auditResolvable = new Map([
    ['USUARIOS', userLegacyIds], ['VIVIENDAS', dwellingIds], ['VEHICULOS', vehicleIds], ['INCIDENCIAS', incidentIds]
  ]);
  const unresolvedAudit = audits.filter((row) => row.legacy_entity_id && !(auditResolvable.get(row.entity.toUpperCase()) || new Set()).has(row.legacy_entity_id));
  if (unresolvedAudit.length) issues.warnings.push(`Auditoria: ${unresolvedAudit.length} referencias históricas no resuelven; se conservarán solo como legacy_entity_id`);

  const model = {
    source: { file: filePath, sha256: checksum, importer_version: IMPORTER_VERSION },
    community: {
      legacy_id: options.communityLegacyId || 'LEGACY_COMMUNITY_DDBB_QR',
      slug: options.communitySlug || 'parking-comunidad', name: text(settings.NombreOficial) || 'Parking Comunidad',
      description: text(settings.Descripcion) || null, contact_email: text(settings.EmailContacto) || null,
      address: text(settings.Direccion) || null, state: 'Activo'
    },
    settings, users, dwellings, vehicles, temporaryPeriods, requests, incidents, followups, audits, qrControls, plateControls,
    issues,
    diagnostics: { unresolved_audit_references: unresolvedAudit.length }
  };
  return model;
}

export function safeReport(model, mode = 'DRY_RUN') {
  const counts = {
    Usuarios: model.users.length, Viviendas: model.dwellings.length, Vehiculos: model.vehicles.length,
    PeriodosTemporales: model.temporaryPeriods.length, Solicitudes: model.requests.length,
    Incidencias: model.incidents.length, IncidenciaSeguimiento: model.followups.length,
    Auditoria: model.audits.length, ControlQR: model.qrControls.length,
    ControlMatricula: model.plateControls.length, Configuracion: Object.keys(model.settings).length
  };
  return {
    importer_version: IMPORTER_VERSION, mode, source_file: model.source.file.split('/').at(-1), source_sha256: model.source.sha256,
    valid: model.issues.errors.length === 0, counts,
    roles: Object.fromEntries([...new Set(model.users.flatMap((user) => user.roles))].sort().map((role) => [role, model.users.filter((user) => user.roles.includes(role)).length])),
    states: {
      users: Object.fromEntries([...new Set(model.users.map((row) => row.state))].sort().map((state) => [state, model.users.filter((row) => row.state === state).length])),
      dwellings: Object.fromEntries([...new Set(model.dwellings.map((row) => row.state))].sort().map((state) => [state, model.dwellings.filter((row) => row.state === state).length])),
      vehicles: Object.fromEntries([...new Set(model.vehicles.map((row) => row.state))].sort().map((state) => [state, model.vehicles.filter((row) => row.state === state).length]))
    },
    diagnostics: model.diagnostics, errors: model.issues.errors, warnings: model.issues.warnings,
    credential_profile: {
      total: model.users.length,
      algorithms: Object.fromEntries([...new Set(model.users.map((row) => row.credential.algorithm))].map((algorithm) => [algorithm, model.users.filter((row) => row.credential.algorithm === algorithm).length])),
      hashes_or_salts_exposed_in_report: false
    }
  };
}
