import fs from 'node:fs';

const bundle = fs.readFileSync(new URL('../../assets/js/app.bundle.1.2.13.14-FIX11.29.js', import.meta.url), 'utf8');
const poc = fs.readFileSync(new URL('../../assets/js/supabase-poc-adapter.js', import.meta.url), 'utf8');
const finalAdapter = fs.readFileSync(new URL('../../assets/js/supabase-final-adapter.js', import.meta.url), 'utf8');

const actions = [...bundle.matchAll(/\bcall\(\s*['"]([^'"]+)['"]/g)].map((match) => match[1]);
const unique = [...new Set(actions)].sort();
const combined = `${poc}\n${finalAdapter}`;
const missing = unique.filter((action) => !combined.includes(action));

console.log(`UI actions: ${unique.length}`);
console.log(`Covered by Supabase adapters: ${unique.length - missing.length}`);
console.log(`Missing: ${missing.join(', ') || 'none'}`);

if (missing.length) process.exit(1);
