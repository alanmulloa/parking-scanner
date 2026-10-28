#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyModel, makeServiceClient } from './apply.mjs';
import { readLegacyWorkbook, safeReport } from './model.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const toolRoot = resolve(here, '..');
const defaultFile = '/Users/macbookairm1/Downloads/DDBB QR Comunidad.xlsx';

function argsOf(argv) {
  const args = { mode: 'DRY_RUN', file: defaultFile, report: null, confirmChecksum: null };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--apply') args.mode = 'APPLY';
    else if (value === '--dry-run') args.mode = 'DRY_RUN';
    else if (value === '--file') args.file = argv[++index];
    else if (value === '--report') args.report = argv[++index];
    else if (value === '--confirm-checksum') args.confirmChecksum = argv[++index];
    else if (value === '--help') args.help = true;
    else throw new Error(`Argumento desconocido: ${value}`);
  }
  return args;
}

function help() {
  return `Uso:
  node src/import.mjs --dry-run --file "/ruta/DDBB QR Comunidad.xlsx" [--report informe.json]
  node src/import.mjs --apply --file "/ruta/DDBB QR Comunidad.xlsx" --confirm-checksum <sha256> [--report informe.json]

DRY_RUN es el modo predeterminado y no necesita credenciales Supabase.
APPLY requiere SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en el entorno.`;
}

const args = argsOf(process.argv.slice(2));
if (args.help) {
  console.log(help());
  process.exit(0);
}

const model = await readLegacyWorkbook(resolve(args.file), {
  communitySlug: process.env.COMMUNITY_SLUG,
  communityLegacyId: process.env.COMMUNITY_LEGACY_ID
});
let report = safeReport(model, args.mode);

if (model.issues.errors.length) {
  report.result = 'BLOCKED_BY_VALIDATION';
} else if (args.mode === 'APPLY') {
  if (!args.confirmChecksum || args.confirmChecksum.toLowerCase() !== model.source.sha256) {
    throw new Error(`APPLY bloqueado: usa --confirm-checksum ${model.source.sha256}`);
  }
  const client = makeServiceClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  report.apply = await applyModel(client, model);
  report.result = 'SUCCEEDED';
} else {
  report.result = 'DRY_RUN_OK';
}

const reportPath = resolve(args.report || `${toolRoot}/reports/${args.mode.toLowerCase()}-${model.source.sha256.slice(0, 12)}.json`);
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ result: report.result, valid: report.valid, counts: report.counts, warnings: report.warnings, report: reportPath, sha256: report.source_sha256 }, null, 2));

if (model.issues.errors.length) process.exitCode = 2;
