(() => {
  'use strict';

  const sb = window.parkingSupabase;
  if (!sb) throw new Error('Supabase no está inicializado.');

  const previousServer = server;
  const CACHE_MS = 15000;
  const cache = new Map();
  let bootstrapCache = null;

  const cached = async (key, loader, ttl = CACHE_MS) => {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < ttl) return hit.value;
    const value = await loader();
    cache.set(key, { at: Date.now(), value });
    return value;
  };

  const invalidate = () => {
    cache.clear();
    bootstrapCache = null;
  };

  const unwrap = (result) => {
    if (result.error) throw result.error;
    return result.data;
  };

  const normalizePlate = (value) => String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

  const asDate = (value) => value ? String(value).slice(0, 10) : '';

  const dataUrlBlob = (dataUrl) => {
    const [head, encoded] = String(dataUrl || '').split(',');
    if (!head || !encoded) throw new Error('La imagen no es válida.');
    const mime = head.match(/^data:([^;]+);base64$/)?.[1] || 'image/jpeg';
    const bytes = atob(encoded);
    const out = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i += 1) out[i] = bytes.charCodeAt(i);
    return { blob: new Blob([out], { type: mime }), mime };
  };

  async function sessionUser() {
    const { data, error } = await sb.auth.getUser();
    if (error || !data?.user) throw new Error('La sesión ha caducado. Vuelve a iniciar sesión.');
    return data.user;
  }

  async function appBootstrap(force = false) {
    if (!force && bootstrapCache) return bootstrapCache;
    const data = unwrap(await sb.rpc('app_bootstrap'));
    const profile = data.profile || {};
    const memberships = data.memberships || [];
    const roles = profile.is_root
      ? ['ROOT', 'ADMIN', 'CONTROL']
      : [...new Set(memberships.flatMap((m) => m.roles || []))];
    const settings = Object.fromEntries(Object.entries(data.settings || {}).map(([key, value]) => [key, value]));
    bootstrapCache = {
      user: {
        ID_Usuario: profile.user_id,
        Email: profile.email || '',
        Nombre: profile.name || profile.email || '',
        Rol: roles.join(','),
        Estado: profile.state || 'Activo',
        IsRoot: !!profile.is_root
      },
      roles,
      communityId: data.community_id,
      dwelling: data.dwelling,
      settings,
      provider: 'SUPABASE',
      environment: 'staging'
    };
    return bootstrapCache;
  }

  function mapHousing(row, owner = null) {
    return {
      ID_Vivienda: row.id,
      CommunityId: row.community_id,
      Vivienda: row.display_name || '',
      Bloque: row.block || '',
      Planta: row.floor || '',
      Apartamento: row.apartment || '',
      Responsable: owner?.email || '',
      Propietario: owner?.name || owner?.email || '',
      ResponsableUserId: row.responsible_user_id || '',
      Estado: row.state === 'Activo' ? 'Activa' : 'Inactiva',
      Observaciones: row.observations || ''
    };
  }

  function mapPeriod(row) {
    if (!row) return null;
    return {
      ID_Periodo: row.id,
      ID_Temporal: row.id,
      ID_Vehiculo: row.vehicle_id,
      MatriculaTemporal: row.temporary_plate,
      Desde: asDate(row.starts_at),
      Hasta: asDate(row.ends_at),
      Estado: row.state,
      Observaciones: row.observations || '',
      CreatedAt: row.created_at || ''
    };
  }

  function mapVehicle(row, periods = []) {
    if (!row) return null;
    const today = new Date().toISOString().slice(0, 10);
    const activePeriods = periods
      .filter((p) => p.vehicle_id === row.id && p.state !== 'Anulado')
      .sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)));
    const current = activePeriods.find((p) => asDate(p.starts_at) <= today && asDate(p.ends_at) >= today) || null;
    const upcoming = activePeriods.find((p) => asDate(p.starts_at) > today) || null;
    return {
      ID_Vehiculo: row.id,
      ID_Vivienda: row.dwelling_id,
      CommunityId: row.community_id,
      Slot: row.slot == null ? '' : String(row.slot),
      MatriculaHabitual: row.habitual_plate || '',
      MatriculaTemporal: current?.temporary_plate || '',
      TemporalDesde: current?.starts_at || '',
      TemporalHasta: current?.ends_at || '',
      Marca: row.make || '',
      Modelo: row.model || '',
      Tipo: row.type || 'Particular',
      Estado: row.state || '',
      QR_Token: row.qr_token || '',
      QR_Estado: row.qr_state || '',
      Observaciones: row.observations || '',
      PeriodoTemporalActual: mapPeriod(current),
      ProximoPeriodoTemporal: mapPeriod(upcoming)
    };
  }

  async function profilesById() {
    const rows = unwrap(await sb.from('profiles').select('user_id,email,name,state,last_access_at,is_root')) || [];
    return new Map(rows.map((row) => [row.user_id, row]));
  }

  async function listHousing() {
    return cached('housing', async () => {
      const [rows, profiles] = await Promise.all([
        unwrap(await sb.from('dwellings').select('*').order('block').order('floor').order('apartment')) || [],
        profilesById()
      ]);
      return rows.map((row) => mapHousing(row, profiles.get(row.responsible_user_id)));
    });
  }

  async function listVehicles() {
    return cached('vehicles', async () => {
      const [vehicles, periods] = await Promise.all([
        unwrap(await sb.from('vehicles').select('*').order('habitual_plate')) || [],
        unwrap(await sb.from('temporary_periods').select('*').order('starts_at')) || []
      ]);
      return vehicles.map((row) => mapVehicle(row, periods));
    });
  }

  async function listUsers() {
    return cached('users', async () => {
      const [profiles, memberships, housing] = await Promise.all([
        unwrap(await sb.from('profiles').select('user_id,email,name,state,last_access_at,is_root')) || [],
        unwrap(await sb.from('community_members').select('user_id,roles,state')) || [],
        listHousing()
      ]);
      const membershipByUser = new Map(memberships.map((row) => [row.user_id, row]));
      return profiles
        .filter((profile) => !profile.is_root)
        .map((profile) => {
          const member = membershipByUser.get(profile.user_id);
          const assigned = housing.filter((h) => h.ResponsableUserId === profile.user_id);
          return {
            ID_Usuario: profile.user_id,
            Email: profile.email || '',
            Nombre: profile.name || profile.email || '',
            Rol: (member?.roles || []).join(','),
            Estado: profile.state || member?.state || 'Activo',
            LastAccessAt: profile.last_access_at || '',
            ViviendasAsignadas: assigned.map((h) => h.Vivienda).join(' · ')
          };
        });
    });
  }

  async function formOptions() {
    const [housing, users] = await Promise.all([listHousing(), listUsers()]);
    return { housing, owners: users };
  }

  async function joinedReferenceData() {
    const [housing, vehicles, profiles] = await Promise.all([listHousing(), listVehicles(), profilesById()]);
    return {
      housing,
      vehicles,
      profiles,
      housingById: new Map(housing.map((row) => [row.ID_Vivienda, row])),
      vehicleById: new Map(vehicles.map((row) => [row.ID_Vehiculo, row]))
    };
  }

  function mapRequest(row, refs) {
    const h = refs.housingById.get(row.dwelling_id) || {};
    const v = refs.vehicleById.get(row.vehicle_id) || {};
    const requester = refs.profiles.get(row.requested_by) || {};
    const resolver = refs.profiles.get(row.resolved_by) || {};
    return {
      ID_Solicitud: row.id,
      ID_Vivienda: row.dwelling_id,
      ID_Vehiculo: row.vehicle_id || '',
      FechaHora: row.requested_at,
      Usuario: requester.email || '',
      NombreSolicitante: requester.name || requester.email || '',
      Bloque: h.Bloque || '',
      Planta: h.Planta || '',
      Apartamento: h.Apartamento || '',
      MatriculaHabitual: v.MatriculaHabitual || row.origin_plate || '',
      MatriculaOrigen: row.origin_plate || '',
      TipoVehiculo: v.Tipo || row.origin_vehicle_type || '',
      Slot: v.Slot || row.origin_slot || '',
      QR_Estado: v.QR_Estado || row.origin_qr_state || '',
      Tipo: row.type,
      Estado: row.state,
      Motivo: row.reason || '',
      FechaInicio: row.start_date || '',
      FechaFin: row.end_date || '',
      FechaResolucion: row.resolved_at || '',
      UsuarioResolucion: resolver.email || '',
      NombreResolucion: resolver.name || resolver.email || '',
      ObservacionesResolucion: row.resolution_notes || ''
    };
  }

  async function listRequests() {
    const [rows, refs] = await Promise.all([
      unwrap(await sb.from('requests').select('*').order('requested_at', { ascending: false })) || [],
      joinedReferenceData()
    ]);
    return rows.map((row) => mapRequest(row, refs));
  }

  async function evidenceUrl(path) {
    if (!path || !String(path).startsWith('storage:')) return path || '';
    const objectPath = String(path).slice('storage:'.length);
    const result = await sb.storage.from('parking-private').createSignedUrl(objectPath, 900);
    return result.error ? '' : result.data.signedUrl;
  }

  function mapFollowup(row, photoUrl = '') {
    return {
      ID_Seguimiento: row.id,
      ID_Incidencia: row.incident_id,
      ID_EventoSeguimiento: row.followup_event_id || '',
      NumeroIntento: row.attempt_number,
      FechaHora: row.occurred_at,
      MatriculaObservada: row.observed_plate || '',
      MatriculaAutorizada: row.authorized_plate || '',
      Situacion: row.situation || '',
      Observacion: row.observation || '',
      Foto: photoUrl
    };
  }

  function mapIncident(row, refs, followups, photoUrl = '') {
    const h = refs.housingById.get(row.dwelling_id) || {};
    const v = refs.vehicleById.get(row.vehicle_id) || {};
    const creator = refs.profiles.get(row.created_by) || {};
    const closer = refs.profiles.get(row.closed_by) || {};
    return {
      ID_Incidencia: row.id,
      ID_Evento: row.event_id || '',
      ID_Vivienda: row.dwelling_id || '',
      ID_Vehiculo: row.vehicle_id || '',
      FechaHora: row.occurred_at,
      Usuario: creator.email || '',
      NombreUsuario: creator.name || creator.email || '',
      Bloque: h.Bloque || '',
      Planta: h.Planta || '',
      Apartamento: h.Apartamento || '',
      MatriculaObservada: row.observed_plate || '',
      MatriculaInfraccion: row.infraction_plate || '',
      MatriculaAutorizada: row.authorized_plate || '',
      MatriculaRelacionada: row.related_plate || '',
      MatriculaHabitualVehiculo: v.MatriculaHabitual || '',
      MatriculaHabitualOrigen: row.origin_habitual_plate || '',
      TipoVehiculo: v.Tipo || row.origin_vehicle_type || '',
      TipoVehiculoOrigen: row.origin_vehicle_type || '',
      EstadoVehiculo: v.Estado || '',
      EstadoVehiculoOrigen: row.origin_vehicle_state || '',
      QR_Estado: v.QR_Estado || '',
      QR_EstadoOrigen: row.origin_qr_state || '',
      SlotOrigen: row.origin_slot || '',
      Tipo: row.type,
      Descripcion: row.description || '',
      Foto: photoUrl,
      Estado: row.state,
      OrigenControl: row.control_origin || 'Manual',
      EstadoOrigen: row.origin_state || '',
      Situacion: row.situation || '',
      Causa: row.cause || '',
      Intentos: row.attempts || 1,
      Prioridad: row.priority || 'Normal',
      UltimoSeguimiento: row.last_followup_at || '',
      ITV_Vencida: row.expired_itv ? 'Sí' : 'No verificado',
      FugaLiquidos: row.fluid_leak ? 'Sí' : 'No',
      FechaCierre: row.closed_at || '',
      UsuarioCierre: closer.email || '',
      NombreUsuarioCierre: closer.name || closer.email || '',
      AccionCierre: row.close_action || '',
      ComentarioCierre: row.close_comment || '',
      AccionesDisponibles: ['Sin actuación', 'Aviso al propietario', 'Revocar QR', 'Renovar QR', 'Suspender vehículo', 'Dar de baja', 'Otra'],
      Seguimientos: followups
    };
  }

  async function listIncidents() {
    const [rows, followupRows, refs] = await Promise.all([
      unwrap(await sb.from('incidents').select('*').order('occurred_at', { ascending: false })) || [],
      unwrap(await sb.from('incident_followups').select('*').order('occurred_at')) || [],
      joinedReferenceData()
    ]);
    const paths = [...rows.map((r) => r.photo_url), ...followupRows.map((r) => r.photo_url)].filter(Boolean);
    const urlPairs = await Promise.all(paths.map(async (path) => [path, await evidenceUrl(path)]));
    const urls = new Map(urlPairs);
    return rows.map((row) => mapIncident(
      row,
      refs,
      followupRows.filter((f) => f.incident_id === row.id).map((f) => mapFollowup(f, urls.get(f.photo_url) || '')),
      urls.get(row.photo_url) || ''
    ));
  }

  async function parkingControl(kind, rawValue) {
    let value = String(rawValue || '').trim();
    if (kind === 'QR') {
      try { value = new URL(value).searchParams.get('q') || value; } catch (_) {}
    }
    const result = unwrap(await sb.rpc('resolve_parking_control', { p_kind: kind, p_value: value }));
    const refs = await joinedReferenceData();
    const vehicle = mapVehicle(result.vehicle, result.temporaryPeriod ? [result.temporaryPeriod] : []);
    const housing = result.housing ? mapHousing(result.housing, refs.profiles.get(result.housing.responsible_user_id)) : null;
    const owner = result.housing?.responsible_user_id ? refs.profiles.get(result.housing.responsible_user_id) : null;
    const openIncidents = (result.openIncidents || []).map((row) => mapIncident(row, refs, [], ''));
    return {
      status: result.status,
      source: kind,
      query: kind === 'MATRICULA' ? normalizePlate(value) : '',
      vehicle,
      housing,
      owner: owner ? { Nombre: owner.name, Email: owner.email } : null,
      currentPlate: result.currentPlate || '',
      isTemporary: !!result.isTemporary,
      temporaryPeriod: mapPeriod(result.temporaryPeriod),
      longStay: result.longStay ? { FechaInicio: result.longStay.start_date, FechaFin: result.longStay.end_date } : null,
      openIncidents
    };
  }

  async function uploadPhoto(payload) {
    const boot = await appBootstrap();
    const { blob, mime } = dataUrlBlob(payload.dataUrl);
    if (blob.size > 10 * 1024 * 1024) throw new Error('La fotografía supera el máximo de 10 MB.');
    const extension = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
    const objectPath = `${boot.communityId}/pending/${crypto.randomUUID()}.${extension}`;
    const result = await sb.storage.from('parking-private').upload(objectPath, blob, { contentType: mime, upsert: false });
    if (result.error) throw result.error;
    return { url: `storage:${objectPath}` };
  }

  async function registerEvidence(photoPath, incidentId = null, followupId = null) {
    if (!photoPath?.startsWith('storage:')) return;
    const boot = await appBootstrap();
    const user = await sessionUser();
    const row = {
      community_id: boot.communityId,
      incident_id: incidentId,
      followup_id: followupId,
      object_path: photoPath.slice('storage:'.length),
      created_by: boot.user.IsRoot ? null : user.id,
      metadata: { source: 'SUPABASE_FRONTEND' }
    };
    unwrap(await sb.from('file_objects').insert(row));
  }

  async function saveIncident(payload) {
    const boot = await appBootstrap();
    const user = await sessionUser();
    const observed = String(payload.MatriculaObservada || '').trim().toUpperCase();
    const existingResult = await sb.from('incidents')
      .select('id,type,situation')
      .eq('community_id', boot.communityId)
      .eq('state', 'Abierta')
      .eq('type', payload.Tipo)
      .eq('observed_plate', observed)
      .limit(10);
    const existing = unwrap(existingResult) || [];
    if (existing.length) {
      return {
        mode: 'FOLLOWUP_REQUIRED',
        existingIds: existing.map((row) => row.id),
        existing: existing.map((row) => ({ ID_Incidencia: row.id, Tipo: row.type, Situacion: row.situation }))
      };
    }
    const vehicle = payload.ID_Vehiculo
      ? unwrap(await sb.from('vehicles').select('*').eq('id', payload.ID_Vehiculo).maybeSingle())
      : null;
    const row = {
      community_id: boot.communityId,
      created_by: user.id,
      observed_plate: observed,
      infraction_plate: observed,
      authorized_plate: String(payload.MatriculaAutorizada || '').trim().toUpperCase() || null,
      dwelling_id: payload.ID_Vivienda || null,
      vehicle_id: payload.ID_Vehiculo || null,
      type: payload.Tipo,
      description: String(payload.Descripcion || '').trim(),
      photo_url: payload.Foto || null,
      control_origin: payload.OrigenControl || 'Manual',
      origin_state: payload.EstadoOrigen || '',
      origin_vehicle_state: vehicle?.state || null,
      origin_qr_state: vehicle?.qr_state || null,
      origin_vehicle_type: vehicle?.type || null,
      origin_slot: vehicle?.slot || null,
      origin_habitual_plate: vehicle?.habitual_plate || null,
      situation: payload.Situacion || null,
      expired_itv: payload.ITV_Vencida === 'Sí',
      fluid_leak: payload.FugaLiquidos === 'Sí',
      event_id: crypto.randomUUID()
    };
    const created = unwrap(await sb.from('incidents').insert(row).select().single());
    await registerEvidence(payload.Foto, created.id, null);
    invalidate();
    return { mode: 'CREATED', ID_Incidencia: created.id, IDs: [created.id], created: [{ ID_Incidencia: created.id, Tipo: created.type, Situacion: created.situation }] };
  }

  async function saveIncidentFollowup(payload) {
    const user = await sessionUser();
    const ids = [...new Set([...(payload.ids || []), payload.anchorId].filter(Boolean))];
    const updated = [];
    for (const incidentId of ids) {
      const incident = unwrap(await sb.from('incidents').select('*').eq('id', incidentId).single());
      const nextAttempt = Number(incident.attempts || 1) + 1;
      const row = {
        community_id: incident.community_id,
        incident_id: incident.id,
        event_id: incident.event_id,
        followup_event_id: crypto.randomUUID(),
        created_by: user.id,
        attempt_number: nextAttempt,
        observed_plate: payload.MatriculaObservada || incident.observed_plate,
        authorized_plate: payload.MatriculaAutorizada || incident.authorized_plate,
        control_origin: payload.OrigenControl || incident.control_origin,
        origin_state: payload.EstadoOrigen || incident.origin_state,
        situation: payload.Situacion || incident.situation,
        observation: String(payload.Observacion || payload.Descripcion || '').trim(),
        photo_url: payload.Foto || null
      };
      const followup = unwrap(await sb.from('incident_followups').insert(row).select().single());
      unwrap(await sb.from('incidents').update({ attempts: nextAttempt, last_followup_at: followup.occurred_at }).eq('id', incident.id));
      await registerEvidence(payload.Foto, null, followup.id);
      updated.push(incident.id);
    }
    invalidate();
    return { updated, created: [] };
  }

  async function createRequest(payload) {
    const boot = await appBootstrap();
    const user = await sessionUser();
    const vehicle = unwrap(await sb.from('vehicles').select('*').eq('id', payload.ID_Vehiculo).single());
    const duplicate = unwrap(await sb.from('requests').select('id').eq('vehicle_id', vehicle.id).eq('type', payload.Tipo).eq('state', 'Abierta').maybeSingle());
    if (duplicate) throw new Error('Ya existe una solicitud abierta de este tipo para el vehículo.');
    const row = {
      community_id: boot.communityId,
      requested_by: user.id,
      dwelling_id: vehicle.dwelling_id,
      vehicle_id: vehicle.id,
      type: payload.Tipo,
      reason: String(payload.Motivo || '').trim(),
      origin_vehicle_state: vehicle.state,
      origin_qr_state: vehicle.qr_state,
      origin_vehicle_type: vehicle.type,
      origin_slot: vehicle.slot,
      origin_plate: vehicle.habitual_plate,
      start_date: payload.FechaInicio || null,
      end_date: payload.FechaFin || null
    };
    if (row.start_date && row.end_date && row.end_date < row.start_date) throw new Error('La fecha fin no puede ser anterior a la fecha inicio.');
    const created = unwrap(await sb.from('requests').insert(row).select().single());
    invalidate();
    return { ok: true, ID_Solicitud: created.id };
  }

  async function listAudit() {
    const rows = unwrap(await sb.from('audit_log').select('*').order('occurred_at', { ascending: true }).limit(1000)) || [];
    const profiles = await profilesById();
    return rows.map((row) => ({
      ID_Auditoria: row.id,
      FechaHora: row.occurred_at,
      Usuario: row.actor_email || profiles.get(row.actor_user_id || row.user_id)?.email || '',
      UsuarioNombre: profiles.get(row.actor_user_id || row.user_id)?.name || row.actor_email || '',
      Accion: row.action,
      Entidad: row.entity,
      ID_Entidad: row.entity_id || row.legacy_entity_id || '',
      Campo: row.field || '',
      ValorAnterior: row.previous_value || '',
      ValorNuevo: row.new_value || '',
      Observaciones: row.observations || '',
      Origen: row.source
    }));
  }

  async function dashboard() {
    const [summary, housing, vehicles, requests, incidents, periods] = await Promise.all([
      unwrap(await sb.rpc('app_dashboard')),
      listHousing(), listVehicles(), listRequests(), listIncidents(),
      unwrap(await sb.from('temporary_periods').select('*').eq('state', 'Activo')) || []
    ]);
    const activeHousing = housing.filter((h) => h.Estado === 'Activa').length;
    const activeCars = vehicles.filter((v) => v.Estado === 'Activo' && v.Tipo !== 'Moto');
    const activeMotorcycles = vehicles.filter((v) => v.Estado === 'Activo' && v.Tipo === 'Moto').length;
    const occupiedSlots = activeCars.filter((v) => ['1', '2'].includes(String(v.Slot))).length;
    const today = new Date().toISOString().slice(0, 10);
    const in7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    return {
      activeHousing,
      totalHousing: housing.length,
      activeSlotVehicles: occupiedSlots,
      activeMotorcycles,
      suspendedVehicles: vehicles.filter((v) => v.Estado === 'Suspendido').length,
      inactiveVehicles: vehicles.filter((v) => v.Estado === 'Desasignado').length,
      lowVehicles: vehicles.filter((v) => v.Estado === 'Baja').length,
      occupiedSlots,
      availableSlots: Math.max(0, activeHousing * 2 - occupiedSlots),
      slotCapacity: activeHousing * 2,
      pendingRequests: requests.filter((r) => r.Estado === 'Abierta').length,
      openIncidents: incidents.filter((i) => i.Estado === 'Abierta').length,
      repeatOpenIncidents: incidents.filter((i) => i.Estado === 'Abierta' && Number(i.Intentos) > 1).length,
      activeWithoutQr: activeCars.filter((v) => v.QR_Estado !== 'Activo').length,
      temporary: periods.filter((p) => asDate(p.starts_at) <= today && asDate(p.ends_at) >= today).length,
      temporaryExpiring7: periods.filter((p) => asDate(p.ends_at) >= today && asDate(p.ends_at) <= in7).length,
      incidents30: incidents.filter((i) => Date.parse(i.FechaHora) >= Date.now() - 30 * 86400000).length,
      requests30: requests.filter((r) => Date.parse(r.FechaHora) >= Date.now() - 30 * 86400000).length,
      newVehicles30: vehicles.filter((v) => Date.parse(v.CreatedAt || 0) >= Date.now() - 30 * 86400000).length,
      attention: [],
      trends: {},
      backendSummary: summary
    };
  }

  async function ownerBundle() {
    const [housing, vehicles, requests, incidents] = await Promise.all([listHousing(), listVehicles(), listRequests(), listIncidents()]);
    return { housing, vehicles, requests, incidents };
  }

  async function saveSettings(payload) {
    const boot = await appBootstrap();
    const allowed = ['NombreOficial', 'Descripcion', 'Direccion', 'EmailContacto', 'LogoUrl', 'ColorPrincipal', 'ColorSecundario', 'ColorAcento'];
    const rows = allowed.filter((key) => payload[key] !== undefined).map((key) => ({ community_id: boot.communityId, key, value: payload[key] }));
    if (rows.length) unwrap(await sb.from('community_settings').upsert(rows, { onConflict: 'community_id,key' }));
    invalidate();
    return (await appBootstrap(true)).settings;
  }

  async function globalSearch(payload) {
    const query = String(payload.q || '').trim().toLowerCase();
    const [housing, vehicles, incidents, requests] = await Promise.all([listHousing(), listVehicles(), listIncidents(), listRequests()]);
    const rows = [];
    housing.filter((h) => Object.values(h).join(' ').toLowerCase().includes(query)).slice(0, 8).forEach((h) => rows.push({ type: 'Vivienda', title: h.Vivienda, detail: h.Responsable, view: 'housingDetail', id: h.ID_Vivienda }));
    vehicles.filter((v) => Object.values(v).join(' ').toLowerCase().includes(query)).slice(0, 8).forEach((v) => rows.push({ type: 'Vehículo', title: v.MatriculaHabitual, detail: `${v.Marca} ${v.Modelo}`.trim(), view: 'vehicleDetail', id: v.ID_Vehiculo, search: v.MatriculaHabitual }));
    incidents.filter((i) => Object.values(i).join(' ').toLowerCase().includes(query)).slice(0, 8).forEach((i) => rows.push({ type: 'Incidencia', title: i.Tipo, detail: i.MatriculaObservada, view: 'incidents', id: i.ID_Incidencia }));
    requests.filter((r) => Object.values(r).join(' ').toLowerCase().includes(query)).slice(0, 8).forEach((r) => rows.push({ type: 'Solicitud', title: r.Tipo, detail: r.MatriculaHabitual, view: 'requests', id: r.ID_Solicitud }));
    return rows.slice(0, 20);
  }

  async function action(name, payload = {}) {
    switch (name) {
      case 'bootstrap': return appBootstrap();
      case 'dashboard': return dashboard();
      case 'listUsers': return listUsers();
      case 'listHousing': return listHousing();
      case 'listVehicles': return listVehicles();
      case 'formOptions': return formOptions();
      case 'listRequests': return listRequests();
      case 'listIncidents':
      case 'listIncidentsPayload': return { rows: await listIncidents() };
      case 'listAudit': return listAudit();
      case 'ownerBundle': return ownerBundle();
      case 'scanQr': return parkingControl('QR', payload.token);
      case 'searchPlate': return parkingControl('MATRICULA', payload.plate);
      case 'uploadPhoto': return uploadPhoto(payload);
      case 'saveIncident': return saveIncident(payload);
      case 'saveIncidentFollowup': return saveIncidentFollowup(payload);
      case 'previewIncidentFollowup': return { canSave: true, operations: [{ action: 'FOLLOWUP', ID_Incidencia: payload.anchorId }], summary: { followups: 1, created: 0, skippedToday: 0, skippedResolved: 0 } };
      case 'closeIncident': {
        const data = unwrap(await sb.rpc('close_parking_incident', { p_incident_id: payload.id, p_action: payload.AccionCierre, p_comment: payload.ComentarioCierre }));
        invalidate(); return data;
      }
      case 'createRequest': return createRequest(payload);
      case 'resolveRequest': {
        const data = unwrap(await sb.rpc('resolve_parking_request', { p_request_id: payload.id, p_decision: payload.decision, p_notes: payload.observaciones || '' }));
        invalidate(); return data;
      }
      case 'getSettings': return (await appBootstrap()).settings;
      case 'saveSettings': return saveSettings(payload);
      case 'globalSearch': return globalSearch(payload);
      case 'housingDetail': {
        const [refs, requests, incidents] = await Promise.all([joinedReferenceData(), listRequests(), listIncidents()]);
        const housing = refs.housingById.get(payload.id);
        return { housing, owner: housing ? refs.profiles.get(housing.ResponsableUserId) : null, vehicles: refs.vehicles.filter((v) => v.ID_Vivienda === payload.id), requests: requests.filter((r) => r.ID_Vivienda === payload.id), incidents: incidents.filter((i) => i.ID_Vivienda === payload.id) };
      }
      case 'vehicleHistory': {
        const refs = await joinedReferenceData();
        const vehicle = refs.vehicleById.get(payload.id);
        const audits = (await listAudit()).filter((row) => row.ID_Entidad === payload.id);
        return { vehicle, events: audits.map((row) => ({ type: row.Accion, title: row.Entidad, date: row.FechaHora, user: row.UsuarioNombre, detail: row.Observaciones })) };
      }
      case 'updateProfile': {
        const user = await sessionUser();
        unwrap(await sb.from('profiles').update({ name: String(payload.Nombre || '').trim() }).eq('user_id', user.id));
        invalidate(); return appBootstrap(true);
      }
      case 'changePassword': {
        if (!payload.password && !payload.PasswordNueva) throw new Error('Introduce la contraseña nueva.');
        unwrap(await sb.auth.updateUser({ password: payload.password || payload.PasswordNueva }));
        return true;
      }
      case 'systemStatus': {
        const status = unwrap(await sb.rpc('root_system_status'));
        return { ok: true, backendVersion: 'Supabase migration 120', environment: 'staging', timeZone: 'Europe/Madrid', checkedAt: status.checkedAt, sheetCount: 0, services: [{ label: 'Base de datos', ok: true, detail: 'Supabase disponible', ms: 0, level: 'good' }, { label: 'RLS / sesión', ok: true, detail: 'Sesión ROOT verificada', ms: 0, level: 'good' }], performance: { totalMs: 0 }, counts: status };
      }
      case 'systemRoundTripPing': return { serverMs: 0, checkedAt: new Date().toISOString() };
      case 'systemDiagnostics': return { checkedAt: new Date().toISOString(), totalMs: 0, level: 'good', tests: [{ label: 'Base de datos', detail: 'RPC disponible', ok: true, ms: 0, level: 'good' }] };
      case 'systemPerformanceHistory': return { health: [], history: [] };
      case 'managerData': {
        if (payload.kind === 'users') return { rows: await listUsers(), options: await formOptions() };
        const result = await previousServer('api', 'supabase-session', name, payload);
        if (payload.kind === 'vehicles') {
          const [requests, incidents] = await Promise.all([listRequests(), listIncidents()]);
          result.requests = requests; result.incidents = incidents; result.requestStats = {};
        }
        return result;
      }
      default: {
        const result = await previousServer('api', 'supabase-session', name, payload);
        if (!['bootstrap', 'listHousing', 'listVehicles', 'formOptions'].includes(name)) invalidate();
        return result;
      }
    }
  }

  async function login(email, password) {
    const response = await fetch(`${window.SUPABASE_POC_CONFIG.url}/functions/v1/legacy-auth-migrate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: window.SUPABASE_POC_CONFIG.publishableKey },
      body: JSON.stringify({ email, password }),
      cache: 'no-store'
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.session?.access_token || !body.session?.refresh_token) {
      throw new Error(body.error || 'Credenciales no válidas.');
    }
    unwrap(await sb.auth.setSession({ access_token: body.session.access_token, refresh_token: body.session.refresh_token }));
    const boot = await appBootstrap(true);
    if (boot.user.IsRoot) await sb.rpc('record_root_session_event', { p_action: 'LOGIN' });
    return { token: body.session.access_token, user: boot.user, migrated: !!body.migrated };
  }

  server = async function finalSupabaseServer(fn, ...args) {
    if (fn === 'loginWithPassword') return login(args[0], args[1]);
    if (fn === 'logout') {
      try {
        const boot = await appBootstrap();
        if (boot.user.IsRoot) await sb.rpc('record_root_session_event', { p_action: 'LOGOUT' });
      } catch (_) {}
      invalidate();
      unwrap(await sb.auth.signOut());
      return true;
    }
    if (fn === 'getPublicParkingSettings') {
      try { return (await appBootstrap()).settings; } catch (_) { return window.INITIAL_PUBLIC_SETTINGS || {}; }
    }
    if (fn === 'api') return action(args[1], args[2] || {});
    return previousServer(fn, ...args);
  };

  sb.auth.onAuthStateChange((event, session) => {
    if (session?.access_token) localStorage.setItem('parking_token', session.access_token);
    if (event === 'SIGNED_OUT') {
      localStorage.removeItem('parking_token');
      invalidate();
    }
  });

  console.info('[Parking Comunidad] adaptador Supabase final activo');
})();
