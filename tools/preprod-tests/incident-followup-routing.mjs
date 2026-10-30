import fs from 'node:fs';

const adapter = fs.readFileSync(
  'assets/js/supabase-final-adapter.js',
  'utf8'
);

const migration = fs.readFileSync(
  'supabase/migrations/20261029012400_incident_linked_event_parity.sql',
  'utf8'
);

let failed = false;

function check(label, condition) {
  if (condition) {
    console.log(`OK   ${label}`);
  } else {
    console.error(`FAIL ${label}`);
    failed = true;
  }
}

check(
  'followup resuelve anchor desde anchorId, ids o id',
  adapter.includes(
    "const anchorId = payload.anchorId || (Array.isArray(payload.ids) ? payload.ids[0] : '') || payload.id;"
  )
);

check(
  'preview usa buildFollowupCandidates con anchor resuelto',
  adapter.includes(
    "const candidates = await buildFollowupCandidates({ ...payload, anchorId }, ctx);"
  )
);

check(
  'preview y save usan la misma ruta de seguimiento',
  (
    adapter.match(
      /buildFollowupCandidates\(\{ \.\.\.payload, anchorId \}, ctx\)/g
    ) || []
  ).length === 2
);

check(
  'routing antiguo por payload.anchorId eliminado',
  !adapter.includes(
    "payload.anchorId ? await buildFollowupCandidates"
  )
);

check(
  'RPC deduplica por relation_key y fecha',
  migration.includes('f.occurred_date=') &&
  migration.includes('f.relation_key=v_relation')
);

check(
  'RPC usa occurrenceEventId común',
  migration.includes("'occurrenceEventId',v_occurrence")
);

check(
  'followups guardan followup_event_id',
  migration.includes(
    'event_id,followup_event_id,created_by,attempt_number'
  )
);

if (failed) {
  process.exit(1);
}

console.log('Incident followup routing parity: OK');
