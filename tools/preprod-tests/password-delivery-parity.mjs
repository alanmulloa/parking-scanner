import fs from 'node:fs';

const admin = fs.readFileSync(
  'supabase/functions/parking-admin/index.ts',
  'utf8'
);

const adapter = fs.readFileSync(
  'assets/js/supabase-final-adapter.js',
  'utf8'
);

const management = fs.readFileSync(
  'assets/js/admin/management.js',
  'utf8'
);

const bridge = fs.readFileSync(
  'legacy-apps-script/LegacyBridge.gs',
  'utf8'
);

const tests = [
  [
    'parking-admin expone generateTemporaryPassword',
    admin.includes("action === 'generateTemporaryPassword'")
  ],
  [
    'contraseña temporal usa Supabase Auth',
    admin.includes('updateUserById') &&
    admin.includes('temporaryPassword: password')
  ],
  [
    'contraseña temporal no se guarda en auditoría',
    admin.includes(
      'El valor no fue almacenado.'
    )
  ],
  [
    'adapter expone adminGenerateTemporaryPassword',
    adapter.includes(
      "case 'adminGenerateTemporaryPassword'"
    )
  ],
  [
    'UI genera contraseña temporal',
    management.includes(
      "call('adminGenerateTemporaryPassword'"
    )
  ],
  [
    'UI permite copiar contraseña temporal',
    management.includes(
      'copy-temporary-password'
    ) &&
    management.includes(
      'navigator.clipboard.writeText(password)'
    )
  ],
  [
    'UI ya no asigna contraseña manual por admin',
    !management.includes("call('adminSetPassword'")
  ],
  [
    'UI ya no usa adminGeneratePassword antiguo',
    !management.includes("call('adminGeneratePassword'")
  ],
  [
    'bridge ya no expone mail.sendAccess',
    !bridge.includes("action==='mail.sendAccess'")
  ],
  [
    'bridge ya no contiene parkingBridgeSendAccess',
    !bridge.includes('parkingBridgeSendAccess_')
  ]
];

let failed = false;

for (const [label, ok] of tests) {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}`);
  if (!ok) failed = true;
}

if (failed) process.exit(1);

console.log('Temporary password parity: OK');
