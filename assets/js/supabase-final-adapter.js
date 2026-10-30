(() => {
  'use strict';

  const sb = window.parkingSupabase;
  if (!sb) throw new Error('Supabase no está inicializado.');

  const previousServer = server;
  const CACHE_MS = 15000;
  const cache = new Map();
  let bootstrapCache = null;
  let publicStateCache = null;
  let publicStateCachedAt = 0;

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

  async function parkingAdmin(action, payload = {}) {
    const { data: sessionData, error: sessionError } = await sb.auth.getSession();
    const accessToken = sessionData?.session?.access_token;
    if (sessionError || !accessToken) throw new Error('La sesión ha caducado. Vuelve a iniciar sesión.');

    const response = await fetch(`${window.SUPABASE_POC_CONFIG.url}/functions/v1/parking-admin`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: window.SUPABASE_POC_CONFIG.publishableKey,
        authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify({ action, payload }),
      cache: 'no-store'
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'No se pudo completar la operación administrativa.');
    return body;
  }

  async function publicAppState(force = false) {
    if (!force && publicStateCache && Date.now() - publicStateCachedAt < 5000) return publicStateCache;
    try {
      const data = unwrap(await sb.rpc('parking_public_state')) || {};
      publicStateCache = data;
      publicStateCachedAt = Date.now();
      return data;
    } catch (_) {
      return { maintenance: { enabled: false, message: '' }, settings: window.INITIAL_PUBLIC_SETTINGS || {} };
    }
  }

  function perfLevel(ms) {
    if (ms > 1800) return 'slow';
    if (ms > 800) return 'warn';
    return 'good';
  }

  async function timed(label, loader) {
    const started = performance.now();
    try {
      const value = await loader();
      const ms = Math.max(1, Math.round(performance.now() - started));
      return { label, ok: true, ms, level: perfLevel(ms), value };
    } catch (error) {
      const ms = Math.max(1, Math.round(performance.now() - started));
      return { label, ok: false, ms, level: 'slow', error };
    }
  }

  async function edgeOptions(functionName) {
    const response = await fetch(`${window.SUPABASE_POC_CONFIG.url}/functions/v1/${functionName}`, {
      method: 'OPTIONS',
      cache: 'no-store'
    });
    if (!response.ok && response.status !== 204) throw new Error(`${functionName}: HTTP ${response.status}`);
    return true;
  }

  async function appBootstrap(force = false) {
    if (!force && bootstrapCache) return bootstrapCache;
    const data = unwrap(await sb.rpc('app_bootstrap'));
    const profile = data.profile || {};
    const memberships = data.memberships || [];
    const roles = profile.is_root
      ? [...new Set(['ROOT', 'ADMIN', ...(data.technical_functional_roles || []).filter((role) => role !== 'ADMIN')])]
      : [...new Set(memberships.flatMap((m) => m.roles || []))];
    const settings = Object.fromEntries(Object.entries(data.settings || {}).map(([key, value]) => [key, value]));
    bootstrapCache = {
      user: {
        ID_Usuario: profile.user_id,
        Email: profile.email || '',
        Nombre: profile.name || profile.email || '',
        Rol: roles.join(','),
        Estado: profile.state || 'Activo',
        IsRoot: !!profile.is_root,
        CanConfigure: !!profile.is_root || roles.includes('ADMIN'),
        CanSystem: !!profile.is_root
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
      CreatedAt: row.created_at || '',
      FechaAlta: row.created_at || '',
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

  function incidentAllowedActionsClient(row, refs) {
    const actions = ['Sin actuación', 'Aviso al propietario'];
    const add = (value) => { if (!actions.includes(value)) actions.push(value); };
    const vehicle = refs.vehicleById.get(row.vehicle_id) || null;
    const state = vehicle?.Estado || row.origin_vehicle_state || '';
    const type = row.type || '';
    const situation = row.situation || '';
    const moto = (vehicle?.Tipo || row.origin_vehicle_type) === 'Moto';
    if (type === 'Uso indebido') {
      if (situation === 'Cesión de QR') {
        if (vehicle && state === 'Activo') {
          if (!moto && vehicle.QR_Estado !== 'Revocado') add('Revocar QR');
          add('Suspender vehículo');
        } else if (vehicle && state === 'Suspendido') add('Mantener suspensión');
        add('Otra');
      } else if (situation === 'Uso de QR ajeno') {
        if (vehicle && state === 'Activo') add('Suspender vehículo');
        else if (vehicle && state === 'Suspendido') add('Mantener suspensión');
        add('Otra');
      } else {
        if (vehicle && state === 'Activo') add('Suspender vehículo');
        else if (vehicle && state === 'Suspendido') add('Mantener suspensión');
        add('Otra');
      }
    } else if (type === 'QR no corresponde con matrícula') {
      let qrVehicle = row.related_vehicle_id ? refs.vehicleById.get(row.related_vehicle_id) : null;
      if (!qrVehicle) {
        const relatedPlate = normalizePlate(row.authorized_plate || row.related_plate);
        qrVehicle = refs.vehicles.find((v) => normalizePlate(v.MatriculaHabitual) === relatedPlate || normalizePlate(v.MatriculaTemporal) === relatedPlate) || null;
      }
      if (qrVehicle && qrVehicle.Tipo !== 'Moto' && qrVehicle.Estado === 'Activo' && qrVehicle.QR_Estado !== 'Revocado') add('Revocar QR');
      if (vehicle && state === 'Activo') add('Suspender vehículo');
      else if (vehicle && state === 'Suspendido') add('Mantener suspensión');
      add('Otra');
    } else if (type === 'Acceso no autorizado') {
      if (vehicle && state === 'Suspendido') add('Mantener suspensión');
      if (vehicle && state === 'Activo' && !moto && (situation === 'QR revocado' || vehicle.QR_Estado === 'Revocado')) add('Renovar QR');
      add('Datos corregidos'); add('Otra');
    } else if (type === 'QR no presentado') {
      add('Otra');
    } else if (type === 'Matrícula no registrada') {
      add('Datos corregidos'); add('Otra');
    } else {
      add('Datos corregidos'); add('Otra');
    }
    return actions;
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
      ID_ViviendaRelacionada: row.related_dwelling_id || '',
      ID_VehiculoRelacionado: row.related_vehicle_id || '',
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
      AccionesDisponibles: incidentAllowedActionsClient(row, refs),
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

  function controlOpenIncidentsFromList(vehicle, plate, incidents) {
    const today = madridDay();
    const query = normalizePlate(plate);
    const open = incidents.filter((row) => row.Estado === 'Abierta');
    const isLinkedQr = (row) => row.OrigenControl === 'QR' && ((row.Tipo === 'Uso indebido' && ['Cesión de QR', 'Uso de QR ajeno'].includes(row.Situacion)) || row.Tipo === 'Matrícula no registrada');
    const eventIds = (row) => new Set([row.ID_Evento, ...(row.Seguimientos || []).map((f) => f.ID_EventoSeguimiento)].filter(Boolean));
    const events = new Map(open.map((row) => [row.ID_Incidencia, eventIds(row)]));
    const shares = (a, b) => {
      const aa = events.get(a.ID_Incidencia) || new Set();
      const bb = events.get(b.ID_Incidencia) || new Set();
      for (const id of aa) if (bb.has(id)) return true;
      return false;
    };
    const brief = (row) => {
      const createdToday = asDate(row.FechaHora) === today;
      const followedToday = (row.Seguimientos || []).some((f) => asDate(f.FechaHora) === today);
      const linkedQr = isLinkedQr(row);
      return {
        ...row,
        canFollowup: linkedQr || (!createdToday && !followedToday),
        createdToday,
        followedToday,
        relationAware: linkedQr
      };
    };
    return open
      .filter((row) => (vehicle && row.ID_Vehiculo === vehicle.ID_Vehiculo) || (!vehicle && query && normalizePlate(row.MatriculaObservada) === query))
      .map((row) => {
        const own = brief(row);
        const qrLinked = isLinkedQr(row);
        const linked = row.ID_Evento
          ? open.filter((other) => shares(row, other) && (qrLinked ? isLinkedQr(other) : !isLinkedQr(other))).map(brief)
          : [own];
        own.linkedOpenIncidents = linked;
        own.linkedCount = linked.length;
        own.canFollowup = linked.some((item) => item.canFollowup);
        return own;
      })
      .sort((a, b) => String(b.FechaHora).localeCompare(String(a.FechaHora)));
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
    const allIncidents = await listIncidents();
    const openIncidents = controlOpenIncidentsFromList(vehicle, result.currentPlate || (kind === 'MATRICULA' ? value : vehicle?.MatriculaHabitual || ''), allIncidents);
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

  const INCIDENT_TYPES = [
    'Matrícula no registrada', 'Acceso no autorizado', 'QR no presentado',
    'QR no corresponde con matrícula', 'Uso indebido',
    'Vehículo inmovilizado / posible abandono', 'Estacionamiento o ubicación indebida',
    'Fuga / pérdida de líquidos', 'Otro'
  ];

  const madridDay = () => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());

  const incidentDerivedFromStatus = (status, source, vehicle) => {
    const map = {
      'MATRICULA NO REGISTRADA': { type: 'Matrícula no registrada', situation: 'Matrícula no registrada', cause: '' },
      'VEHICULO DESASIGNADO': { type: 'Acceso no autorizado', situation: 'Vehículo desasignado', cause: 'Vehículo desasignado' },
      'VEHICULO INACTIVO': { type: 'Acceso no autorizado', situation: 'Vehículo desasignado', cause: 'Vehículo desasignado' },
      'VEHICULO SUSPENDIDO': { type: 'Acceso no autorizado', situation: 'Vehículo suspendido', cause: 'Vehículo suspendido' },
      'VEHICULO DE BAJA': { type: 'Acceso no autorizado', situation: 'Vehículo de baja', cause: 'Vehículo de baja' },
      'QR REVOCADO': { type: 'Acceso no autorizado', situation: 'QR revocado', cause: 'QR revocado' },
      'MATRICULA TEMPORAL NO VIGENTE': { type: 'Acceso no autorizado', situation: 'Matrícula no vigente', cause: 'Matrícula temporal no vigente' },
      'MATRICULA HABITUAL NO VIGENTE': { type: 'Acceso no autorizado', situation: 'Matrícula no vigente', cause: 'Matrícula habitual no vigente' },
      'NO AUTORIZADO': { type: 'Acceso no autorizado', situation: 'Otra condición de autorización', cause: 'No autorizado' }
    };
    if (map[String(status || '')]) return map[String(status || '')];
    if (String(status || '') === 'AUTORIZADO' && String(source || '') === 'MATRICULA' && vehicle && vehicle.type !== 'Moto' && vehicle.qr_state === 'Activo') {
      return { type: 'QR no presentado', situation: 'QR activo no presentado', cause: 'Identificación realizada por matrícula' };
    }
    return null;
  };

  async function incidentContext() {
    const [vehicles, periods, dwellings, requests] = await Promise.all([
      unwrap(await sb.from('vehicles').select('*')) || [],
      unwrap(await sb.from('temporary_periods').select('*')) || [],
      unwrap(await sb.from('dwellings').select('*')) || [],
      unwrap(await sb.from('requests').select('*').eq('type', 'PERMANENCIA_PROLONGADA').eq('state', 'Aprobada')) || []
    ]);
    return {
      vehicles, periods, dwellings, requests,
      vehiclesById: new Map(vehicles.map((v) => [v.id, v])),
      dwellingsById: new Map(dwellings.map((d) => [d.id, d]))
    };
  }

  function currentTemporaryRaw(vehicleId, ctx) {
    const today = madridDay();
    return ctx.periods
      .filter((p) => p.vehicle_id === vehicleId && p.state !== 'Anulado' && asDate(p.starts_at) <= today && asDate(p.ends_at) >= today)
      .sort((a, b) => String(b.starts_at).localeCompare(String(a.starts_at)))[0] || null;
  }

  function resolveIncidentPlate(value, ctx) {
    const plate = normalizePlate(value);
    if (!plate) return { plate: '', vehicle: null, kind: '', period: null, valid: false, status: '' };
    const vehicle = ctx.vehicles.find((v) => normalizePlate(v.habitual_plate) === plate) || null;
    if (vehicle) {
      const current = vehicle.state === 'Activo' ? currentTemporaryRaw(vehicle.id, ctx) : null;
      if (current && normalizePlate(current.temporary_plate) !== plate) {
        return { plate, vehicle, kind: 'HABITUAL_NO_VIGENTE', period: current, valid: false, status: 'MATRICULA HABITUAL NO VIGENTE' };
      }
      return { plate, vehicle, kind: 'HABITUAL', period: null, valid: true, status: '' };
    }
    const matching = ctx.periods
      .filter((p) => normalizePlate(p.temporary_plate) === plate)
      .sort((a, b) => String(b.starts_at).localeCompare(String(a.starts_at)));
    if (!matching.length) return { plate, vehicle: null, kind: 'NO_REGISTRADA', period: null, valid: false, status: 'MATRICULA NO REGISTRADA' };
    const today = madridDay();
    const validPeriod = matching.find((p) => p.state !== 'Anulado' && asDate(p.starts_at) <= today && asDate(p.ends_at) >= today) || null;
    const period = validPeriod || matching[0];
    const related = ctx.vehiclesById.get(period.vehicle_id) || null;
    if (!related) return { plate, vehicle: null, kind: 'NO_REGISTRADA', period, valid: false, status: 'MATRICULA NO REGISTRADA' };
    if (validPeriod && related.state === 'Activo') return { plate, vehicle: related, kind: 'TEMPORAL_VIGENTE', period: validPeriod, valid: true, status: '' };
    return { plate, vehicle: related, kind: 'TEMPORAL_NO_VIGENTE', period, valid: false, status: 'MATRICULA TEMPORAL NO VIGENTE' };
  }

  function approvedLongStay(vehicleId, ctx) {
    const today = madridDay();
    return ctx.requests.find((r) => r.vehicle_id === vehicleId && asDate(r.start_date) <= today && asDate(r.end_date) >= today) || null;
  }

  function incidentObservedAccess(identity, ctx) {
    const v = identity?.vehicle || null;
    if (!v) return { authorized: false, status: 'MATRICULA NO REGISTRADA', situation: 'Matrícula no registrada', cause: 'Matrícula no registrada' };
    if (identity.status === 'MATRICULA TEMPORAL NO VIGENTE') return { authorized: false, status: identity.status, situation: 'Matrícula no vigente', cause: 'Matrícula temporal no vigente' };
    if (identity.status === 'MATRICULA HABITUAL NO VIGENTE') return { authorized: false, status: identity.status, situation: 'Matrícula no vigente', cause: 'Matrícula habitual no vigente' };
    if (v.state === 'Desasignado') return { authorized: false, status: 'VEHICULO DESASIGNADO', situation: 'Vehículo desasignado', cause: 'Vehículo desasignado' };
    if (v.state === 'Suspendido') return { authorized: false, status: 'VEHICULO SUSPENDIDO', situation: 'Vehículo suspendido', cause: 'Vehículo suspendido' };
    if (v.state === 'Baja') return { authorized: false, status: 'VEHICULO DE BAJA', situation: 'Vehículo de baja', cause: 'Vehículo de baja' };
    const h = ctx.dwellingsById.get(v.dwelling_id) || null;
    if (v.state !== 'Activo' || !h || h.state !== 'Activo') return { authorized: false, status: 'NO AUTORIZADO', situation: 'Otra condición de autorización', cause: 'Vehículo o vivienda no activa' };
    if (approvedLongStay(v.id, ctx)) return { authorized: true, status: 'AUTORIZADO', situation: '', cause: 'Permanencia prolongada aprobada' };
    if (v.type !== 'Moto' && ![1, 2, '1', '2'].includes(v.slot)) return { authorized: false, status: 'NO AUTORIZADO', situation: 'Otra condición de autorización', cause: 'Vehículo sin slot autorizado' };
    if (v.type !== 'Moto' && v.qr_token && v.qr_state === 'Revocado') return { authorized: false, status: 'QR REVOCADO', situation: 'QR revocado', cause: 'QR revocado' };
    return { authorized: true, status: 'AUTORIZADO', situation: '', cause: '' };
  }

  function normalizeLegacyIncidentType(type, status) {
    const legacy = {
      'QR revocado': ['Acceso no autorizado', 'QR revocado'],
      'Vehículo suspendido': ['Acceso no autorizado', 'Vehículo suspendido'],
      'Vehículo de baja': ['Acceso no autorizado', 'Vehículo de baja'],
      'Vehículo sin QR': ['QR no presentado', 'QR activo no presentado']
    };
    if (legacy[type]) return { type: legacy[type][0], situation: legacy[type][1] };
    const d = incidentDerivedFromStatus(status, '', null);
    return { type: type || d?.type || 'Otro', situation: d?.situation || '' };
  }

  function incidentBaseCandidate(payload, vehicle, eventId) {
    const normalized = normalizeLegacyIncidentType(String(payload.Tipo || '').trim(), String(payload.EstadoOrigen || '').trim());
    const derived = incidentDerivedFromStatus(payload.EstadoOrigen, payload.OrigenControl, vehicle);
    let type = String(payload.Tipo || '').trim();
    if (!INCIDENT_TYPES.includes(type)) type = (derived && derived.type) || normalized.type;
    if (!INCIDENT_TYPES.includes(type)) type = 'Otro';
    const situation = String(payload.Situacion || '').trim() || ((derived && derived.type === type) ? derived.situation : normalized.situation);
    const cause = String(payload.Causa || '').trim() || ((derived && derived.type === type) ? derived.cause : '');
    const observed = normalizePlate(payload.MatriculaObservada);
    return {
      observed_plate: observed || null,
      infraction_plate: normalizePlate(payload.MatriculaInfraccion) || observed || normalizePlate(vehicle?.habitual_plate) || null,
      authorized_plate: normalizePlate(payload.MatriculaAutorizada) || null,
      dwelling_id: vehicle?.dwelling_id || payload.ID_Vivienda || null,
      vehicle_id: vehicle?.id || payload.ID_Vehiculo || null,
      type,
      description: String(payload.Descripcion || payload.Observacion || '').trim(),
      photo_url: payload.Foto || null,
      control_origin: String(payload.OrigenControl || 'Manual'),
      origin_state: String(payload.EstadoOrigen || 'Registro manual'),
      origin_vehicle_state: vehicle?.state || null,
      origin_qr_state: vehicle ? (vehicle.type === 'Moto' ? 'No aplica' : vehicle.qr_state || null) : null,
      origin_vehicle_type: vehicle?.type || null,
      origin_slot: vehicle && vehicle.type !== 'Moto' ? vehicle.slot : null,
      origin_habitual_plate: normalizePlate(vehicle?.habitual_plate) || null,
      expired_itv: String(payload.ITV_Vencida || '') === 'Sí',
      event_id: eventId || crypto.randomUUID(),
      situation: situation || null,
      cause: cause || null,
      related_dwelling_id: null,
      related_vehicle_id: null,
      related_plate: null,
      fluid_leak: type === 'Fuga / pérdida de líquidos' || String(payload.FugaLiquidos || '') === 'Sí'
    };
  }

  function validateIncidentCandidate(row, vehicle) {
    const type = row.type;
    if (type === 'Matrícula no registrada' && vehicle) throw new Error('La matrícula indicada está registrada. Revisa el tipo de incidencia.');
    if (['QR no presentado', 'QR no corresponde con matrícula'].includes(type) && !vehicle) throw new Error('Este tipo de incidencia requiere vincular un vehículo registrado.');
    if (['QR no presentado', 'QR no corresponde con matrícula'].includes(type) && vehicle?.type === 'Moto') throw new Error('Este tipo no aplica a motos, que se controlan por matrícula.');
    if (type === 'QR no corresponde con matrícula') {
      if (!row.observed_plate || !row.authorized_plate) throw new Error('Indica la matrícula observada y la matrícula asociada al QR.');
      if (row.observed_plate === row.authorized_plate) throw new Error('La matrícula observada coincide con la asociada al QR.');
    }
    if (type === 'Vehículo inmovilizado / posible abandono' && !row.situation) throw new Error('Selecciona la situación observada.');
    if (type === 'Estacionamiento o ubicación indebida' && !row.situation) throw new Error('Selecciona la situación de estacionamiento o ubicación.');
    if (type === 'Uso indebido' && !row.situation) throw new Error('Selecciona la situación de uso indebido.');
  }

  function accessCandidate(payload, identity, ctx, eventId) {
    const access = incidentObservedAccess(identity, ctx);
    if (access.authorized || !identity.vehicle) return null;
    const row = incidentBaseCandidate({ ...payload, Tipo: 'Acceso no autorizado', Situacion: access.situation, Causa: access.cause, EstadoOrigen: access.status, ID_Vehiculo: identity.vehicle.id, ID_Vivienda: identity.vehicle.dwelling_id, MatriculaObservada: identity.plate }, identity.vehicle, eventId);
    row.observed_plate = identity.plate;
    row.infraction_plate = identity.plate;
    return row;
  }

  function sameIncidentOwner(a, b, ctx) {
    if (!a || !b) return false;
    const ah = ctx.dwellingsById.get(a.dwelling_id);
    const bh = ctx.dwellingsById.get(b.dwelling_id);
    return !!(ah?.responsible_user_id && bh?.responsible_user_id && ah.responsible_user_id === bh.responsible_user_id);
  }

  function buildIncidentCandidates(payload, ctx) {
    const authorized = normalizePlate(payload.MatriculaAutorizada);
    const observed = normalizePlate(payload.MatriculaObservada);
    const origin = String(payload.OrigenControl || 'Manual');
    let primary = payload.ID_Vehiculo ? ctx.vehiclesById.get(payload.ID_Vehiculo) || null : null;
    if (!primary && authorized) primary = resolveIncidentPlate(authorized, ctx).vehicle;
    if (!primary && observed) primary = resolveIncidentPlate(observed, ctx).vehicle;

    if (origin === 'QR' && primary && observed) {
      const qrVehicle = primary;
      const observedIdentity = resolveIncidentPlate(observed, ctx);
      const observedVehicle = observedIdentity.vehicle;
      const sameVehicle = !!(observedVehicle && observedVehicle.id === qrVehicle.id);
      if (!sameVehicle) {
        const commonEvent = crypto.randomUUID();
        const candidates = [];
        const access = observedVehicle ? incidentObservedAccess(observedIdentity, ctx) : null;
        if (observedVehicle && sameIncidentOwner(qrVehicle, observedVehicle, ctx)) {
          const mismatch = incidentBaseCandidate({ ...payload, Tipo: 'QR no corresponde con matrícula', Situacion: 'Vehículo del mismo propietario', Causa: 'Se utilizó el QR de otro vehículo del mismo propietario', EstadoOrigen: access?.status || payload.EstadoOrigen, MatriculaAutorizada: authorized || qrVehicle.habitual_plate, MatriculaObservada: observed, ID_Vehiculo: observedVehicle.id, ID_Vivienda: observedVehicle.dwelling_id }, observedVehicle, commonEvent);
          mismatch.infraction_plate = observed;
          mismatch.related_dwelling_id = qrVehicle.dwelling_id;
          mismatch.related_vehicle_id = qrVehicle.id;
          mismatch.related_plate = normalizePlate(qrVehicle.habitual_plate);
          candidates.push(mismatch);
        } else {
          const giver = incidentBaseCandidate({ ...payload, Tipo: 'Uso indebido', Situacion: 'Cesión de QR', Causa: 'QR utilizado por otro vehículo', MatriculaAutorizada: authorized || qrVehicle.habitual_plate, MatriculaObservada: observed, ID_Vehiculo: qrVehicle.id, ID_Vivienda: qrVehicle.dwelling_id }, qrVehicle, commonEvent);
          giver.infraction_plate = normalizePlate(qrVehicle.habitual_plate) || authorized;
          giver.related_dwelling_id = observedVehicle?.dwelling_id || null;
          giver.related_vehicle_id = observedVehicle?.id || null;
          giver.related_plate = observed;
          candidates.push(giver);
          if (observedVehicle) {
            const userRow = incidentBaseCandidate({ ...payload, Tipo: 'Uso indebido', Situacion: 'Uso de QR ajeno', Causa: 'QR perteneciente a otro propietario', EstadoOrigen: access?.status || payload.EstadoOrigen, MatriculaAutorizada: authorized || qrVehicle.habitual_plate, MatriculaObservada: observed, ID_Vehiculo: observedVehicle.id, ID_Vivienda: observedVehicle.dwelling_id }, observedVehicle, commonEvent);
            userRow.infraction_plate = observed;
            userRow.related_dwelling_id = qrVehicle.dwelling_id;
            userRow.related_vehicle_id = qrVehicle.id;
            userRow.related_plate = normalizePlate(qrVehicle.habitual_plate);
            candidates.push(userRow);
          } else {
            const unknown = incidentBaseCandidate({ ...payload, Tipo: 'Matrícula no registrada', Situacion: 'Matrícula no registrada', Causa: 'Vehículo observado usando QR ajeno', MatriculaAutorizada: authorized || qrVehicle.habitual_plate, MatriculaObservada: observed, ID_Vehiculo: '', ID_Vivienda: '' }, null, commonEvent);
            unknown.vehicle_id = null;
            unknown.dwelling_id = null;
            unknown.infraction_plate = observed;
            unknown.related_dwelling_id = qrVehicle.dwelling_id;
            unknown.related_vehicle_id = qrVehicle.id;
            unknown.related_plate = normalizePlate(qrVehicle.habitual_plate);
            candidates.push(unknown);
          }
        }
        if (observedVehicle) {
          const blockedAccess = accessCandidate(payload, observedIdentity, ctx, crypto.randomUUID());
          if (blockedAccess) candidates.push(blockedAccess);
        }
        candidates.forEach((row) => validateIncidentCandidate(row, row.vehicle_id ? ctx.vehiclesById.get(row.vehicle_id) : null));
        return candidates;
      }
      const observedAccess = incidentObservedAccess(observedIdentity, ctx);
      if (!observedAccess.authorized) {
        const row = accessCandidate(payload, observedIdentity, ctx, crypto.randomUUID());
        if (row) return [row];
      }
      if (['QR no corresponde con matrícula', 'Uso indebido'].includes(String(payload.Tipo || ''))) {
        throw new Error('La matrícula observada corresponde al mismo vehículo (matrícula habitual o temporal vigente). Selecciona otra incidencia si corresponde.');
      }
    }

    const row = incidentBaseCandidate(payload, primary, crypto.randomUUID());
    validateIncidentCandidate(row, primary);
    return [row];
  }

  async function buildFollowupCandidates(payload, ctx) {
    const anchor = unwrap(await sb.from('incidents').select('*').eq('id', payload.anchorId).single());
    if (anchor.state !== 'Abierta') throw new Error(`La incidencia ${anchor.id} ya no está abierta.`);
    const eventRows = anchor.event_id
      ? (unwrap(await sb.from('incidents').select('*').eq('community_id', anchor.community_id).eq('event_id', anchor.event_id)) || [])
      : [anchor];
    const dynamicQr = eventRows.some((r) => r.control_origin === 'QR') || anchor.control_origin === 'QR';
    if (!dynamicQr) return [];
    let primaryId = anchor.vehicle_id;
    let primaryDwelling = anchor.dwelling_id;
    let type = anchor.type;
    let situation = anchor.situation;
    let cause = anchor.cause;
    let authorized = normalizePlate(anchor.authorized_plate);
    const giver = eventRows.find((r) => r.type === 'Uso indebido' && r.situation === 'Cesión de QR' && r.vehicle_id);
    const mismatch = eventRows.find((r) => r.type === 'QR no corresponde con matrícula' && r.related_vehicle_id);
    const qrUser = eventRows.find((r) => r.type === 'Uso indebido' && r.situation === 'Uso de QR ajeno' && r.related_vehicle_id);
    if (giver) {
      primaryId = giver.vehicle_id; primaryDwelling = giver.dwelling_id; type = 'Uso indebido'; situation = 'Cesión de QR'; cause = giver.cause || 'QR utilizado por otro vehículo';
      authorized = normalizePlate(giver.authorized_plate || giver.infraction_plate || giver.origin_habitual_plate);
    } else if (mismatch) {
      primaryId = mismatch.related_vehicle_id; primaryDwelling = mismatch.related_dwelling_id; type = 'QR no corresponde con matrícula'; situation = mismatch.situation; cause = mismatch.cause;
      authorized = normalizePlate(mismatch.authorized_plate || mismatch.related_plate);
    } else if (qrUser) {
      primaryId = qrUser.related_vehicle_id; primaryDwelling = qrUser.related_dwelling_id; type = 'Uso indebido'; situation = 'Cesión de QR'; cause = 'QR utilizado por otro vehículo';
      authorized = normalizePlate(qrUser.authorized_plate || qrUser.related_plate);
    }
    const observed = normalizePlate(payload.MatriculaObservada) || normalizePlate(anchor.observed_plate) || normalizePlate(anchor.infraction_plate);
    return buildIncidentCandidates({
      ...payload,
      Tipo: type, Situacion: situation, Causa: cause, OrigenControl: anchor.control_origin || 'Manual',
      EstadoOrigen: payload.EstadoOrigen || anchor.origin_state || '', ID_Vehiculo: primaryId, ID_Vivienda: primaryDwelling,
      MatriculaAutorizada: authorized, MatriculaObservada: observed,
      Descripcion: payload.Observacion || payload.Descripcion || anchor.description, Foto: payload.Foto || anchor.photo_url
    }, ctx);
  }

  function publicFollowupPlan(raw) {
    const label = (row = {}) => ({
      ID_Incidencia: row.id || '', ID_Evento: row.event_id || '', Tipo: row.type || '', Situacion: row.situation || '', Causa: row.cause || '',
      ID_Vehiculo: row.vehicle_id || '', ID_Vivienda: row.dwelling_id || '', Matricula: normalizePlate(row.infraction_plate || row.observed_plate || row.origin_habitual_plate),
      MatriculaObservada: normalizePlate(row.observed_plate), MatriculaAutorizada: normalizePlate(row.authorized_plate),
      ID_VehiculoRelacionado: row.related_vehicle_id || '', MatriculaRelacionada: normalizePlate(row.related_plate)
    });
    return {
      ok: true, canSave: !!raw.canSave, anchor: label(raw.anchor || {}), occurrenceEventId: raw.occurrenceEventId || '',
      linkedOriginal: (raw.linkedOriginal || []).map(label), summary: raw.summary || {},
      operations: (raw.operations || []).map((op) => ({ action: op.action, reason: op.reason || '', ...label(op.action === 'CREATE' ? (op.candidate || {}) : (op.existing || {})) }))
    };
  }

  async function saveIncident(payload) {
    const boot = await appBootstrap();
    if (!String(payload.Descripcion || '').trim()) throw new Error('Completa la observación / descripción.');
    if (!String(payload.Foto || '').trim()) throw new Error('Debes adjuntar una fotografía antes de registrar la incidencia.');
    const ctx = await incidentContext();
    const candidates = buildIncidentCandidates(payload, ctx);
    const result = unwrap(await sb.rpc('save_parking_incident_candidates', { p_community_id: boot.communityId, p_candidates: candidates }));
    const createdRows = result.created || [];
    for (const row of createdRows) await registerEvidence(payload.Foto, row.id, null);
    invalidate();
    if (result.mode === 'CREATED') {
      return {
        mode: 'CREATED',
        ID_Incidencia: createdRows[0]?.id || '',
        IDs: createdRows.map((row) => row.id),
        ID_Evento: createdRows[0]?.event_id || '',
        created: createdRows.map((row) => ({ ID_Incidencia: row.id, Tipo: row.type, Situacion: row.situation || '', ID_Vehiculo: row.vehicle_id || '' })),
        reused: result.reused || [], message: result.message || ''
      };
    }
    const existing = result.existing || [];
    return {
      mode: result.mode,
      existingIds: existing.map((row) => row.id),
      existing: existing.map((row) => ({ ID_Incidencia: row.id, Tipo: row.type, Situacion: row.situation || '', FechaHora: row.occurred_at, Intentos: row.attempts || 1, Prioridad: row.priority || 'Normal' })),
      blockedIds: (result.blocked || []).map((row) => row.id),
      message: result.message || ''
    };
  }

  async function previewIncidentFollowup(payload) {
    const ctx = await incidentContext();
    const anchorId = payload.anchorId || (Array.isArray(payload.ids) ? payload.ids[0] : '') || payload.id;
    if (!anchorId) throw new Error('No se indicó la incidencia a seguir.');
    const candidates = payload.anchorId ? await buildFollowupCandidates(payload, ctx) : buildIncidentCandidates(payload, ctx);
    const raw = unwrap(await sb.rpc('preview_parking_incident_followup', { p_anchor_id: anchorId, p_candidates: candidates }));
    return publicFollowupPlan(raw);
  }

  async function saveIncidentFollowup(payload) {
    const ctx = await incidentContext();
    const anchorId = payload.anchorId || (Array.isArray(payload.ids) ? payload.ids[0] : '') || payload.id;
    if (!anchorId) throw new Error('No se indicó la incidencia a seguir.');
    const candidates = payload.anchorId ? await buildFollowupCandidates(payload, ctx) : buildIncidentCandidates(payload, ctx);
    const out = unwrap(await sb.rpc('save_parking_incident_followup', {
      p_anchor_id: anchorId,
      p_candidates: candidates,
      p_observation: String(payload.Observacion || payload.Descripcion || '').trim(),
      p_photo_url: payload.Foto || ''
    }));
    for (const followupId of (out.followupIds || [])) await registerEvidence(payload.Foto, null, followupId);
    for (const row of (out.created || [])) await registerEvidence(payload.Foto, row.id, null);
    invalidate();
    return { updated: out.updated || [], created: (out.created || []).map((row) => ({ ID_Incidencia: row.id, Tipo: row.type, Situacion: row.situation || '', ID_Vehiculo: row.vehicle_id || '' })), skipped: out.skipped || [], plan: publicFollowupPlan(out.plan || {}) };
  }

  async function renewQr(payload) {
    const vehicleId = payload.id || payload.ID_Vehiculo || payload.vehicleId || payload.vehicle_id;
    if (!vehicleId) throw new Error('Vehículo no encontrado.');
    const result = unwrap(await sb.rpc('renew_parking_qr', { p_vehicle_id: vehicleId }));
    invalidate();
    return mapVehicle(result.vehicle || result, []);
  }

  async function replaceVehicle(payload) {
    const vehicleId = payload.ID_Vehiculo || payload.id || payload.vehicleId || payload.vehicle_id;
    if (!vehicleId) throw new Error('Vehículo a reemplazar no encontrado.');
    const result = unwrap(await sb.rpc('replace_parking_vehicle', {
      p_vehicle_id: vehicleId,
      p_habitual_plate: String(payload.MatriculaHabitual || '').trim(),
      p_type: payload.Tipo || 'Particular',
      p_make: payload.Marca || '',
      p_model: payload.Modelo || '',
      p_observations: payload.Observaciones || ''
    }));
    invalidate();
    const vehicles = await listVehicles();
    const oldVehicle = vehicles.find((v) => v.ID_Vehiculo === result.oldVehicleId) || null;
    const newVehicle = vehicles.find((v) => v.ID_Vehiculo === result.newVehicleId) || null;
    if (!newVehicle) throw new Error('El reemplazo se realizó pero no se pudo recargar el nuevo vehículo.');
    return { oldVehicle, newVehicle };
  }

  async function saveVehicle(payload) {
    try {
      const row = unwrap(await sb.rpc('save_parking_vehicle', { p_payload: payload || {} }));
      invalidate();
      return mapVehicle(row, []);
    } catch (error) {
      const text = `${error?.message || ''} ${error?.details || ''}`;
      if (text.includes('vehicles_plate_unique_per_community') || text.includes('normalized_habitual_plate')) {
        throw new Error('La matrícula ya está registrada en otro vehículo. Edita o consolida el registro existente.');
      }
      if (text.includes('vehicles_slot_unique') || text.includes('dwelling_id, slot')) {
        throw new Error('Ese slot ya está ocupado por otro vehículo activo.');
      }
      throw error;
    }
  }

  async function createRequest(payload) {
    const created = unwrap(await sb.rpc('create_parking_request', {
      p_vehicle_id: payload.ID_Vehiculo,
      p_type: payload.Tipo,
      p_reason: String(payload.Motivo || '').trim(),
      p_start_date: payload.FechaInicio || null,
      p_end_date: payload.FechaFin || null
    }));
    invalidate();
    return { ok: true, ID_Solicitud: created.id };
  }

  async function listAudit() {
    const rows = [];
    const pageSize = 1000;
    for (let offset = 0; offset < 20000; offset += pageSize) {
      const page = unwrap(await sb.from('audit_log').select('*').order('occurred_at', { ascending: false }).range(offset, offset + pageSize - 1)) || [];
      rows.push(...page);
      if (page.length < pageSize) break;
    }
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
      unwrap(await sb.from('temporary_periods').select('*').neq('state', 'Anulado')) || []
    ]);

    const activeHousingRows = housing.filter((h) => h.Estado === 'Activa');
    const activeHousingIds = new Set(activeHousingRows.map((h) => h.ID_Vivienda));
    const housingById = new Map(housing.map((h) => [h.ID_Vivienda, h]));
    const vehicleById = new Map(vehicles.map((v) => [v.ID_Vehiculo, v]));
    const activeVehicles = vehicles.filter((v) => v.Estado === 'Activo');
    const activeCars = activeVehicles.filter((v) => v.Tipo !== 'Moto');
    const activeMotorcycles = activeVehicles.filter((v) => v.Tipo === 'Moto').length;
    const activeSlotVehicles = activeCars.filter((v) => ['1', '2'].includes(String(v.Slot)));
    const occupiedSlots = activeSlotVehicles.filter((v) => activeHousingIds.has(v.ID_Vivienda)).length;
    const slotCapacity = activeHousingRows.length * 2;
    const openIncidents = incidents.filter((i) => i.Estado !== 'Cerrada');
    const pendingRequests = requests.filter((r) => ['Abierta', 'Pendiente'].includes(r.Estado));
    const activeWithoutQrRows = activeSlotVehicles.filter((v) => v.QR_Estado !== 'Activo');
    const qrVehicles = vehicles.filter((v) => v.Tipo !== 'Moto' && ['1', '2'].includes(String(v.Slot)));
    const revoked = qrVehicles.filter((v) => v.QR_Estado === 'Revocado').length;

    const now = Date.now();
    const cutoff = now - 30 * 86400000;
    const previousCutoff = now - 60 * 86400000;
    const timestamp = (value) => {
      const parsed = Date.parse(String(value || ''));
      return Number.isFinite(parsed) ? parsed : 0;
    };
    const isRecent = (value) => timestamp(value) >= cutoff;
    const isPrevious = (value) => timestamp(value) >= previousCutoff && timestamp(value) < cutoff;
    const incidents30 = incidents.filter((row) => isRecent(row.FechaHora)).length;
    const requests30 = requests.filter((row) => isRecent(row.FechaHora)).length;
    const newVehicles30 = vehicles.filter((row) => isRecent(row.CreatedAt)).length;
    const incidentsPrev30 = incidents.filter((row) => isPrevious(row.FechaHora)).length;
    const requestsPrev30 = requests.filter((row) => isPrevious(row.FechaHora)).length;
    const newVehiclesPrev30 = vehicles.filter((row) => isPrevious(row.CreatedAt)).length;

    const today = new Date().toISOString().slice(0, 10);
    const in7 = new Date(now + 7 * 86400000).toISOString().slice(0, 10);
    const temporaryCurrent = periods.filter((period) => {
      const vehicle = vehicleById.get(period.vehicle_id);
      return vehicle?.Estado === 'Activo' && asDate(period.starts_at) <= today && asDate(period.ends_at) >= today;
    });
    const temporaryExpiring7Rows = temporaryCurrent.filter((period) => asDate(period.ends_at) >= today && asDate(period.ends_at) <= in7);

    const formatShortDate = (value) => {
      const date = new Date(String(value || ''));
      return Number.isNaN(date.getTime()) ? String(value || '') : new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
    };
    const housingLabel = (h) => h ? `Bloque ${h.Bloque}, ${h.Planta} ${h.Apartamento}` : 'Sin vivienda';
    const attention = [];

    activeWithoutQrRows.slice(0, 3).forEach((vehicle) => {
      attention.push({
        type: 'vehicle',
        label: `${vehicle.MatriculaHabitual || 'Vehículo'} · QR no válido`,
        detail: housingLabel(housingById.get(vehicle.ID_Vivienda)),
        vehicleId: vehicle.ID_Vehiculo
      });
    });

    temporaryExpiring7Rows
      .slice()
      .sort((a, b) => String(a.ends_at).localeCompare(String(b.ends_at)))
      .slice(0, 3)
      .forEach((period) => {
        const vehicle = vehicleById.get(period.vehicle_id);
        attention.push({
          type: 'temporary',
          label: `${period.temporary_plate || 'Temporal'} · vence ${formatShortDate(period.ends_at)}`,
          detail: `${vehicle?.MatriculaHabitual || 'Vehículo'} · ${housingLabel(housingById.get(vehicle?.ID_Vivienda))}`,
          vehicleId: vehicle?.ID_Vehiculo || ''
        });
      });

    const openByHousing = new Map();
    openIncidents.forEach((incident) => {
      const vehicle = incident.ID_Vehiculo ? vehicleById.get(incident.ID_Vehiculo) : null;
      const housingId = incident.ID_Vivienda || vehicle?.ID_Vivienda || '';
      if (housingId) openByHousing.set(housingId, (openByHousing.get(housingId) || 0) + 1);
    });
    [...openByHousing.entries()]
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .forEach(([housingId, count]) => attention.push({
        type: 'housing',
        label: housingLabel(housingById.get(housingId)),
        detail: `${count} incidencias pendientes`,
        housingId
      }));

    const oldestRequest = pendingRequests.slice().sort((a, b) => String(a.FechaHora).localeCompare(String(b.FechaHora)))[0];
    if (oldestRequest) {
      const vehicle = vehicleById.get(oldestRequest.ID_Vehiculo);
      const requestLabel = oldestRequest.Tipo === 'REACTIVACION_VEHICULO' ? 'Activación' : oldestRequest.Tipo === 'RENOVACION_QR' ? 'Renovación QR' : 'Permanencia';
      attention.push({ type: 'request', label: `${requestLabel} · ${vehicle?.MatriculaHabitual || oldestRequest.MatriculaHabitual || 'Vehículo'}`, detail: `Abierta desde ${formatShortDate(oldestRequest.FechaHora)}`, requestId: oldestRequest.ID_Solicitud });
    }

    const oldestIncident = openIncidents.slice().sort((a, b) => String(a.FechaHora).localeCompare(String(b.FechaHora)))[0];
    if (oldestIncident) attention.push({ type: 'incident', label: `${oldestIncident.Tipo || 'Incidencia'} · ${oldestIncident.MatriculaObservada || 'Sin matrícula'}`, detail: `Pendiente desde ${formatShortDate(oldestIncident.FechaHora)}`, incidentId: oldestIncident.ID_Incidencia });

    const ageDays = (value) => {
      const valueTs = timestamp(value);
      return valueTs ? Math.floor((now - valueTs) / 86400000) : 0;
    };
    pendingRequests.filter((row) => ageDays(row.FechaHora) > 3).slice(0, 3).forEach((row) => {
      const vehicle = vehicleById.get(row.ID_Vehiculo);
      attention.push({ type: 'request', label: `Solicitud > 3 días · ${vehicle?.MatriculaHabitual || row.MatriculaHabitual || 'Vehículo'}`, detail: `Abierta ${ageDays(row.FechaHora)} días`, requestId: row.ID_Solicitud });
    });
    openIncidents.filter((row) => ageDays(row.FechaHora) > 7).slice(0, 3).forEach((row) => {
      attention.push({ type: 'incident', label: `Incidencia > 7 días · ${row.MatriculaObservada || 'Sin matrícula'}`, detail: `${row.Tipo || ''} · ${ageDays(row.FechaHora)} días`, incidentId: row.ID_Incidencia });
    });
    activeSlotVehicles.filter((vehicle) => !activeHousingIds.has(vehicle.ID_Vivienda)).slice(0, 3).forEach((vehicle) => attention.push({ type: 'vehicle', label: `${vehicle.MatriculaHabitual || 'Vehículo'} · vivienda no válida`, detail: 'Vehículo activo asociado a vivienda inactiva/inexistente', vehicleId: vehicle.ID_Vehiculo }));

    const slotSeen = new Set();
    activeSlotVehicles.forEach((vehicle) => {
      const key = `${vehicle.ID_Vivienda}|${vehicle.Slot}`;
      if (slotSeen.has(key)) attention.push({ type: 'vehicle', label: `${vehicle.MatriculaHabitual || 'Vehículo'} · slot duplicado`, detail: `Slot ${vehicle.Slot} duplicado en la vivienda`, vehicleId: vehicle.ID_Vehiculo });
      slotSeen.add(key);
    });

    return {
      activeHousing: activeHousingRows.length,
      totalHousing: housing.length,
      activeVehicles: activeVehicles.length,
      activeSlotVehicles: activeSlotVehicles.length,
      activeMotorcycles,
      suspendedVehicles: vehicles.filter((v) => v.Estado === 'Suspendido').length,
      inactiveVehicles: vehicles.filter((v) => v.Estado === 'Desasignado').length,
      lowVehicles: vehicles.filter((v) => v.Estado === 'Baja').length,
      occupiedSlots,
      availableSlots: Math.max(0, slotCapacity - occupiedSlots),
      slotCapacity,
      pendingRequests: pendingRequests.length,
      openIncidents: openIncidents.length,
      repeatOpenIncidents: openIncidents.filter((i) => Number(i.Intentos) > 1).length,
      revoked,
      activeWithoutQr: activeWithoutQrRows.length,
      temporary: temporaryCurrent.length,
      temporaryExpiring7: temporaryExpiring7Rows.length,
      incidents30,
      requests30,
      newVehicles30,
      trends: {
        incidents: { current: incidents30, previous: incidentsPrev30 },
        requests: { current: requests30, previous: requestsPrev30 },
        vehicles: { current: newVehicles30, previous: newVehiclesPrev30 }
      },
      attention: attention.slice(0, 20),
      backendSummary: summary
    };
  }

  async function ownerScopeUserId() {
    const boot = await appBootstrap();
    if (!boot.user.IsRoot) return boot.user.ID_Usuario;

    const visibleEmail = String(boot.user.Email || '').trim().toLowerCase();
    if (!visibleEmail) return '';

    const result = await sb
      .from('profiles')
      .select('user_id,email,is_root')
      .eq('is_root', false)
      .ilike('email', visibleEmail)
      .limit(1);
    const rows = unwrap(result) || [];
    return rows[0]?.user_id || '';
  }

  async function ownerBundle() {
    const ownerUserId = await ownerScopeUserId();
    if (!ownerUserId) return { housing: [], vehicles: [], requests: [], incidents: [] };

    const [allHousing, allVehicles, allRequests, allIncidents] = await Promise.all([
      listHousing(), listVehicles(), listRequests(), listIncidents()
    ]);

    // Filtrado explícito: no confiar en que RLS reduzca el dataset cuando la
    // misma sesión también posee ADMIN/ROOT. Al entrar en contexto PROPIETARIO
    // solo se muestran entidades de sus viviendas.
    const housing = allHousing.filter((row) => row.ResponsableUserId === ownerUserId);
    const housingIds = new Set(housing.map((row) => row.ID_Vivienda));
    const vehicles = allVehicles.filter((row) => housingIds.has(row.ID_Vivienda));
    const vehicleIds = new Set(vehicles.map((row) => row.ID_Vehiculo));
    const requests = allRequests.filter((row) => housingIds.has(row.ID_Vivienda) || vehicleIds.has(row.ID_Vehiculo));
    const incidents = allIncidents.filter((row) => housingIds.has(row.ID_Vivienda) || vehicleIds.has(row.ID_Vehiculo));

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
    const boot = await appBootstrap();
    const canAdmin = boot.user.IsRoot || boot.roles.includes('ADMIN');
    const [housing, vehicles, incidents, requests] = await Promise.all([
      canAdmin ? listHousing() : Promise.resolve([]),
      listVehicles(),
      listIncidents(),
      canAdmin ? listRequests() : Promise.resolve([])
    ]);
    const rows = [];
    if (canAdmin) housing.filter((h) => Object.values(h).join(' ').toLowerCase().includes(query)).slice(0, 8).forEach((h) => rows.push({ type: 'Vivienda', title: h.Vivienda, detail: h.Responsable, view: 'housingDetail', id: h.ID_Vivienda }));
    vehicles.filter((v) => Object.values(v).join(' ').toLowerCase().includes(query)).slice(0, 8).forEach((v) => rows.push({ type: 'Vehículo', title: v.MatriculaHabitual, detail: `${v.Marca} ${v.Modelo}`.trim(), view: 'vehicleDetail', id: v.ID_Vehiculo, search: v.MatriculaHabitual }));
    incidents.filter((i) => Object.values(i).join(' ').toLowerCase().includes(query)).slice(0, 8).forEach((i) => rows.push({ type: 'Incidencia', title: i.Tipo, detail: i.MatriculaObservada, view: 'incidents', id: i.ID_Incidencia }));
    if (canAdmin) requests.filter((r) => Object.values(r).join(' ').toLowerCase().includes(query)).slice(0, 8).forEach((r) => rows.push({ type: 'Solicitud', title: r.Tipo, detail: r.MatriculaHabitual, view: 'requests', id: r.ID_Solicitud }));
    return rows.slice(0, 20);
  }

  async function ownerImportTemplate() {
    const rows = await listHousing();
    const sorted = rows.slice().sort((a, b) => String(a.Vivienda || '').localeCompare(String(b.Vivienda || ''), 'es', { numeric: true, sensitivity: 'base' }));
    if (!sorted.length) return [{ Vivienda: 'Bloque 1, 1º A', Propietario: '', Email: '' }];
    return sorted.map((row) => ({ Vivienda: row.Vivienda, Propietario: row.Propietario || '', Email: row.Responsable || '' }));
  }

  async function uploadLogo(payload) {
    const boot = await appBootstrap();
    const { blob, mime } = dataUrlBlob(payload.dataUrl);
    if (!/^image\/(png|jpeg|jpg|webp|gif)$/i.test(mime)) throw new Error('El archivo de logo no es una imagen válida. Usa PNG, JPG, WEBP o GIF.');
    if (blob.size > 3 * 1024 * 1024) throw new Error('El logo no puede superar 3 MB una vez optimizado.');
    const normalizedMime = mime.toLowerCase() === 'image/jpg' ? 'image/jpeg' : mime.toLowerCase();
    const extension = normalizedMime === 'image/jpeg' ? 'jpg' : normalizedMime.split('/')[1];
    const objectPath = `${boot.communityId}/logos/logo-${Date.now()}-${crypto.randomUUID()}.${extension}`;
    const uploaded = await sb.storage.from('parking-public').upload(objectPath, blob, {
      cacheControl: '3600',
      contentType: normalizedMime,
      upsert: false
    });
    if (uploaded.error) throw uploaded.error;
    const publicUrl = sb.storage.from('parking-public').getPublicUrl(objectPath).data.publicUrl;
    return { id: objectPath, url: publicUrl, name: objectPath.split('/').pop() || 'logo' };
  }

  async function consistencyReport() {
    return unwrap(await sb.rpc('parking_consistency_report'));
  }

  async function consistencyFix(payload) {
    const result = unwrap(await sb.rpc('parking_consistency_fix', {
      p_code: payload.code,
      p_vehicle_id: payload.vehicleId
    }));
    invalidate();
    return result;
  }

  let systemStatusCache = null;
  let systemStatusCachedAt = 0;
  const SYSTEM_STATUS_TTL_MS = 45000;

  async function action(name, payload = {}) {
    if (name !== 'bootstrap' && !name.startsWith('system')) {
      const publicState = await publicAppState();
      if (publicState?.maintenance?.enabled) {
        const boot = await appBootstrap();
        if (!boot.user.IsRoot) throw new Error(publicState.maintenance.message || 'Sistema temporalmente en mantenimiento.');
      }
    }
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
      case 'previewIncidentFollowup': return previewIncidentFollowup(payload);
      case 'closeIncident': {
        const data = unwrap(await sb.rpc('close_parking_incident', { p_incident_id: payload.id, p_action: payload.AccionCierre, p_comment: payload.ComentarioCierre }));
        invalidate(); return data;
      }
      case 'saveVehicle': return saveVehicle(payload);
      case 'renewQr': return renewQr(payload);
      case 'replaceVehicle': return replaceVehicle(payload);
      case 'createRequest': return createRequest(payload);
      case 'resolveRequest': {
        const data = unwrap(await sb.rpc('resolve_parking_request', { p_request_id: payload.id, p_decision: payload.decision, p_notes: payload.observaciones || '' }));
        invalidate(); return data;
      }
      case 'getSettings': return (await appBootstrap()).settings;
      case 'saveSettings': return saveSettings(payload);
      case 'ownerImportTemplate': return ownerImportTemplate();
      case 'previewOwnerImport': return parkingAdmin('previewOwnerImport', payload);
      case 'applyOwnerImport': {
        const data = await parkingAdmin('applyOwnerImport', payload);
        invalidate();
        return data;
      }
      case 'consistencyReport': return consistencyReport();
      case 'consistencyFix': return consistencyFix(payload);
      case 'uploadLogo': return uploadLogo(payload);
      case 'globalSearch': return globalSearch(payload);
      case 'housingDetail': {
        const boot = await appBootstrap();
        if (!boot.user.IsRoot && !boot.roles.includes('ADMIN')) throw new Error('No tienes permisos para consultar el detalle de viviendas.');
        const [refs, requests, incidents] = await Promise.all([joinedReferenceData(), listRequests(), listIncidents()]);
        const housing = refs.housingById.get(payload.id);
        return { housing, owner: housing ? refs.profiles.get(housing.ResponsableUserId) : null, vehicles: refs.vehicles.filter((v) => v.ID_Vivienda === payload.id), requests: requests.filter((r) => r.ID_Vivienda === payload.id), incidents: incidents.filter((i) => i.ID_Vivienda === payload.id) };
      }
      case 'vehicleHistory': {
        const boot = await appBootstrap();
        if (!boot.user.IsRoot && !boot.roles.includes('ADMIN')) throw new Error('No tienes permisos para consultar el historial completo del vehículo.');
        const refs = await joinedReferenceData();
        const vehicle = refs.vehicleById.get(payload.id);
        const audits = (await listAudit()).filter((row) => row.ID_Entidad === payload.id);
        return { vehicle, events: audits.map((row) => ({ type: row.Accion, title: row.Entidad, date: row.FechaHora, user: row.UsuarioNombre, detail: row.Observaciones })) };
      }
      case 'saveUser': {
        const data = await parkingAdmin('saveUser', payload);
        invalidate();
        return data;
      }
      case 'adminSetPassword':
        return parkingAdmin('setPassword', { id: payload.id || payload.ID_Usuario, password: payload.password });
      case 'adminGeneratePassword':
        return parkingAdmin('generatePassword', { id: payload.id || payload.ID_Usuario });
      case 'closeUserSessions':
        return parkingAdmin('closeSessions', { id: payload.id || payload.ID_Usuario });
      case 'updateProfile': {
        const user = await sessionUser();
        unwrap(await sb.from('profiles').update({ name: String(payload.Nombre || '').trim() }).eq('user_id', user.id));
        invalidate(); return appBootstrap(true);
      }
      case 'changePassword': {
        const boot = await appBootstrap();
        if (boot.user.IsRoot) throw new Error('La contraseña técnica ROOT se gestiona mediante el procedimiento seguro de administración.');
        const currentPassword = String(payload.currentPassword || payload.PasswordActual || '');
        const newPassword = String(payload.newPassword || payload.password || payload.PasswordNueva || '');
        if (!currentPassword) throw new Error('Introduce tu contraseña actual.');
        if (newPassword.length < 8 || !/[A-Za-zÁÉÍÓÚáéíóúÑñ]/.test(newPassword) || !/\d/.test(newPassword)) {
          throw new Error('La contraseña nueva debe tener al menos 8 caracteres, una letra y un número.');
        }
        const reauth = await sb.auth.signInWithPassword({ email: boot.user.Email, password: currentPassword });
        if (reauth.error || !reauth.data.session) throw new Error('La contraseña actual no es correcta.');
        unwrap(await sb.auth.updateUser({ password: newPassword }));
        return true;
      }
      case 'systemStatus': {
        const force = !!payload.force;
        if (!force && systemStatusCache && Date.now() - systemStatusCachedAt < SYSTEM_STATUS_TTL_MS) {
          return { ...systemStatusCache, cached: true };
        }

        const overallStarted = performance.now();
        const [database, auth, adminEdge, legacyEdge] = await Promise.all([
          timed('Base de datos', async () => unwrap(await sb.rpc('root_system_status'))),
          timed('Auth / RLS', async () => {
            const user = await sessionUser();
            const boot = await appBootstrap();
            if (!boot.user.IsRoot || !user?.id) throw new Error('La sesión ROOT no pudo verificarse.');
            return boot;
          }),
          timed('parking-admin', async () => parkingAdmin('systemPing', {})),
          timed('legacy-auth-migrate', async () => edgeOptions('legacy-auth-migrate'))
        ]);
        if (!database.ok) throw database.error;
        const status = database.value || {};
        const services = [
          { label: 'Base de datos', ok: database.ok, detail: database.ok ? 'PostgreSQL / Supabase disponible' : String(database.error?.message || 'No disponible'), ms: database.ms, level: database.level },
          { label: 'Auth / RLS', ok: auth.ok, detail: auth.ok ? 'Sesión ROOT y políticas verificadas' : String(auth.error?.message || 'No disponible'), ms: auth.ms, level: auth.level },
          { label: 'Edge · parking-admin', ok: adminEdge.ok, detail: adminEdge.ok ? 'Función autenticada disponible' : String(adminEdge.error?.message || 'No disponible'), ms: adminEdge.ms, level: adminEdge.level },
          { label: 'Edge · legacy-auth-migrate', ok: legacyEdge.ok, detail: legacyEdge.ok ? 'Endpoint disponible' : String(legacyEdge.error?.message || 'No disponible'), ms: legacyEdge.ms, level: legacyEdge.level }
        ];
        const totalMs = Math.max(1, Math.round(performance.now() - overallStarted));
        const result = {
          ok: services.every((item) => item.ok),
          backendVersion: status.backendVersion || 'Supabase migration 129',
          schemaVersion: status.schemaVersion || '20261029012900',
          environment: status.environment || (location.pathname.includes('/preproduccion/')?'PREPRODUCCIÓN':'PRODUCCIÓN'),
          hosting: 'GitHub Pages',
          repository: 'floresderiviera/parking-comunidad',
          timeZone: 'Europe/Madrid',
          checkedAt: status.checkedAt || new Date().toISOString(),
          services,
          performance: { totalMs },
          counts: status,
          maintenance: status.maintenance || { enabled: false, message: '' },
          integrations: status.integrations || {}
        };

        systemStatusCache = result;
        systemStatusCachedAt = Date.now();
        return result;
      }
      case 'systemSetMaintenance': {
        const result = unwrap(await sb.rpc('parking_set_maintenance', {
          p_enabled: !!payload.enabled,
          p_message: String(payload.message || '')
        }));
        publicStateCache = result;
        publicStateCachedAt = Date.now();
        invalidate();
        systemStatusCache = null;
        systemStatusCachedAt = 0;
        return result;
      }
      case 'systemLegacyBridgeStatus': return parkingAdmin('legacyBridgeStatus', {});
      case 'systemLegacyBridgeAction': return parkingAdmin('legacyBridgeCommand', { domain: payload.domain, command: payload.command, args: payload.args || {} });
      case 'systemLegacyBridgeCommandStatus': return parkingAdmin('legacyBridgeCommandStatus', { id: payload.id });
      case 'systemRoundTripPing': {
        const ping = await timed('Ping', async () => unwrap(await sb.rpc('parking_system_ping')));
        if (!ping.ok) throw ping.error;
        return { serverMs: ping.ms, checkedAt: ping.value?.checkedAt || new Date().toISOString() };
      }
      case 'systemDiagnostics': {
        const mode = String(payload.mode || 'quick');
        const started = performance.now();
        const tests = [];
        const database = await timed('Base de datos', async () => unwrap(await sb.rpc('root_system_diagnostics')));
        tests.push({ label: database.label, detail: database.ok ? `Esquema ${database.value?.schemaVersion || 'Supabase'}` : String(database.error?.message || 'Error'), ok: database.ok, ms: database.ms, level: database.level });
        const auth = await timed('Auth / RLS', async () => { const boot = await appBootstrap(true); if (!boot.user.IsRoot) throw new Error('ROOT no verificado'); return boot; });
        tests.push({ label: auth.label, detail: auth.ok ? 'Sesión ROOT y bootstrap correctos' : String(auth.error?.message || 'Error'), ok: auth.ok, ms: auth.ms, level: auth.level });
        const admin = await timed('Edge · parking-admin', async () => parkingAdmin('systemPing', {}));
        tests.push({ label: admin.label, detail: admin.ok ? 'Disponible' : String(admin.error?.message || 'Error'), ok: admin.ok, ms: admin.ms, level: admin.level });
        const legacy = await timed('Edge · legacy-auth-migrate', async () => edgeOptions('legacy-auth-migrate'));
        tests.push({ label: legacy.label, detail: legacy.ok ? 'Endpoint disponible' : String(legacy.error?.message || 'Error'), ok: legacy.ok, ms: legacy.ms, level: legacy.level });
        if (mode === 'full') {
          const consistency = await timed('Consistencia', async () => consistencyReport());
          const issues = consistency.ok ? Number(consistency.value?.errors || 0) + Number(consistency.value?.warnings || 0) : null;
          tests.push({ label: consistency.label, detail: consistency.ok ? `${issues ?? 0} observaciones detectadas` : String(consistency.error?.message || 'Error'), ok: consistency.ok, ms: consistency.ms, level: consistency.level });
        }
        const totalMs = Math.max(1, Math.round(performance.now() - started));
        const ok = tests.every((test) => test.ok);
        return { checkedAt: new Date().toISOString(), totalMs, level: ok ? perfLevel(totalMs) : 'slow', tests };
      }
      case 'systemPerformanceHistory': return { health: [], history: [] };
      case 'systemRecordClientPerformance': return { ok: true };
      case 'systemSheetsRealBenchmark': throw new Error('Google Sheets ya no es el backend de la aplicación. Las integraciones heredadas de correo y documentos se controlan por separado.');
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
      try { return unwrap(await sb.rpc('parking_public_settings')) || window.INITIAL_PUBLIC_SETTINGS || {}; } catch (_) { return window.INITIAL_PUBLIC_SETTINGS || {}; }
    }
    if (fn === 'getPublicAppState') return publicAppState(true);
    if (fn === 'api') return action(args[1], args[2] || {});
    return previousServer(fn, ...args);
  };

  // Restore the stable landing views after the temporary POC adapter override.
  defaultViewForRole = function finalDefaultViewForRole(role) {
    return role === 'ADMIN' ? 'dashboard' : role === 'CONTROL' ? 'control' : 'ownerHome';
  };

  if (window.PARKING_PREPROD_TEST_HOOKS) {
    window.__parkingPreprodTestHooks = {
      buildIncidentCandidates,
      incidentObservedAccess,
      incidentAllowedActionsClient,
      resolveIncidentPlate,
      publicFollowupPlan
    };
  }

  sb.auth.onAuthStateChange((event, session) => {
    if (session?.access_token) localStorage.setItem('parking_token', session.access_token);
    if (event === 'SIGNED_OUT') {
      localStorage.removeItem('parking_token');
      invalidate();
    }
  });

  console.info('[Parking Comunidad] adaptador Supabase final activo');
})();
