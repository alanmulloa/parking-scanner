const ENVIRONMENTS = [
  {
    name: 'PRO',
    base: 'https://floresderiviera.github.io/parking-comunidad/',
    expectedTitle: 'Urbanización Flores de Riviera',
    mustNotContain: ['Preproducción'],
  },
  {
    name: 'PRE',
    base: 'https://floresderiviera.github.io/parking-comunidad/preproduccion/',
    expectedTitle: 'Urbanización Flores de Riviera',
  },
];

let failures = 0;

function ok(message) {
  console.log(`OK   ${message}`);
}

function fail(message) {
  failures++;
  console.error(`FAIL ${message}`);
}

async function get(url) {
  const started = performance.now();

  const response = await fetch(url, {
    redirect: 'follow',
    cache: 'no-store',
    headers: {
      'User-Agent': 'parking-comunidad-smoke-test/1.0',
    },
  });

  const text = await response.text();

  return {
    response,
    text,
    ms: Math.round(performance.now() - started),
  };
}

function extractAsset(html, pattern) {
  const match = html.match(pattern);
  return match?.[1] || null;
}

for (const env of ENVIRONMENTS) {
  console.log(`\n===== ${env.name} =====`);

  try {
    const page = await get(env.base);

    if (page.response.ok) {
      ok(`index HTTP ${page.response.status} (${page.ms} ms)`);
    } else {
      fail(`index HTTP ${page.response.status}`);
      continue;
    }

    if (page.text.includes(`<title>${env.expectedTitle}</title>`)) {
      ok(`título correcto: ${env.expectedTitle}`);
    } else {
      fail('título incorrecto');
    }

    for (const value of env.mustContain || []) {
      if (page.text.includes(value)) {
        ok(`contiene "${value}"`);
      } else {
        fail(`debería contener "${value}"`);
      }
    }

    for (const value of env.mustNotContain || []) {
      if (!page.text.includes(value)) {
        ok(`no contiene "${value}"`);
      } else {
        fail(`no debería contener "${value}"`);
      }
    }

    const css = extractAsset(
      page.text,
      /href=["'](\.\/assets\/css\/app\.css[^"']*)["']/
    );

    const bundle = extractAsset(
      page.text,
      /src=["'](\.\/assets\/js\/app\.bundle\.js[^"']*)["']/
    );

    const pocAdapter = extractAsset(
      page.text,
      /src=["'](\.\/assets\/js\/supabase-poc-adapter\.js[^"']*)["']/
    );

    if (env.name === 'PRE') {
      if (pocAdapter) {
        fail('PRE no debería cargar POC adapter');
      } else {
        ok('PRE no carga POC adapter');
      }
    }

    const finalAdapter = extractAsset(
      page.text,
      /src=["'](\.\/assets\/js\/supabase-final-adapter\.js[^"']*)["']/
    );

    const appInit = extractAsset(
      page.text,
      /src=["'](\.\/assets\/js\/app-init\.js[^"']*)["']/
    );

    const assets = [
      ['CSS', css],
      ['bundle', bundle],
      ['final adapter', finalAdapter],
      ['app-init', appInit],
    ];

    for (const [label, relative] of assets) {
      if (!relative) {
        fail(`${label}: referencia no encontrada`);
        continue;
      }

      const url = new URL(relative, env.base).href;
      const result = await get(url);

      if (result.response.ok && result.text.length > 0) {
        ok(`${label} HTTP ${result.response.status} (${result.ms} ms)`);
      } else {
        fail(`${label} HTTP ${result.response.status}`);
      }
    }

    if (bundle) {
      const bundleResult = await get(new URL(bundle, env.base));

      const dynamicVersion =
        bundleResult.text.includes(
          "location.pathname.includes('/preproduccion/')"
        ) &&
        bundleResult.text.includes("'2.0.0-preprod.4'") &&
        bundleResult.text.includes("'2.0.0'");

      if (dynamicVersion) {
        ok('bundle contiene versionado dinámico PRO/PRE');
      } else {
        fail('bundle no contiene versionado dinámico esperado');
      }
    }

    const scanner = await get(new URL('./scanner/', env.base));

    if (scanner.response.ok) {
      ok(`scanner HTTP ${scanner.response.status} (${scanner.ms} ms)`);
    } else {
      fail(`scanner HTTP ${scanner.response.status}`);
    }

    const obsoleteBundle = await fetch(
      new URL('./assets/js/app.bundle.preprod.js', env.base),
      {
        redirect: 'follow',
        cache: 'no-store',
      }
    );

    if (obsoleteBundle.status === 404) {
      ok('bundle PRE antiguo no está publicado');
    } else {
      fail(
        `app.bundle.preprod.js todavía responde HTTP ${obsoleteBundle.status}`
      );
    }
  } catch (error) {
    fail(`${env.name}: ${error.message}`);
  }
}

console.log('\n==============================');

if (failures) {
  console.error(`SMOKE TEST: FAIL (${failures} fallo/s)`);
  process.exit(1);
}

console.log('SMOKE TEST: OK');
console.log('PRO y PRE superaron la validación pública.');
