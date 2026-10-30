import fs from 'node:fs';

const bundle = fs.readFileSync(new URL('../../assets/js/app.bundle.js', import.meta.url), 'utf8');
const finalAdapter = fs.readFileSync(new URL('../../assets/js/supabase-final-adapter.js', import.meta.url), 'utf8');

const actions = [...bundle.matchAll(/\bcall\(\s*['"]([^'"]+)['"]/g)].map((match) => match[1]);
const unique = [...new Set(actions)].sort();
const missing = unique.filter((action) => !finalAdapter.includes(action));

console.log(`UI actions: ${unique.length}`);
console.log(`Covered by final Supabase adapter: ${unique.length - missing.length}`);
console.log(`Missing: ${missing.join(', ') || 'none'}`);

if (missing.length) process.exit(1);
