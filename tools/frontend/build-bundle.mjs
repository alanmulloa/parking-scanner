import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = process.cwd();

const sources = [
  'assets/js/core.js',
  'assets/js/records-shared.js',
  'assets/js/auth-navigation.js',
  'assets/js/admin/dashboard.js',
  'assets/js/admin/management.js',
  'assets/js/admin/advanced.js',
  'assets/js/control/control.js',
  'assets/js/admin/requests.js',
  'assets/js/admin/incidents.js',
  'assets/js/admin/audit.js',
  'assets/js/owner/owner.js',
];

const output = 'assets/js/app.bundle.js';

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8').replace(/\s+$/, '');
}

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

for (const source of sources) {
  if (!fs.existsSync(path.join(root, source))) {
    throw new Error(`Falta módulo frontend: ${source}`);
  }
}

const bundle = sources.map(read).join('\n') + '\n';
const outputPath = path.join(root, output);

const previous = fs.existsSync(outputPath)
  ? fs.readFileSync(outputPath, 'utf8')
  : '';

fs.writeFileSync(outputPath, bundle);

console.log('Frontend bundle generado');
console.log(`  módulos : ${sources.length}`);
console.log(`  salida  : ${output}`);
console.log(`  bytes   : ${Buffer.byteLength(bundle)}`);
console.log(`  sha256  : ${sha256(bundle)}`);
console.log(`  cambio  : ${previous === bundle ? 'NO (reproducible)' : 'SI'}`);
