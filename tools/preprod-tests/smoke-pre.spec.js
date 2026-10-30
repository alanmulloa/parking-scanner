const { test, expect } = require('@playwright/test');

const PRE =
  'https://floresderiviera.github.io/parking-comunidad/preproduccion/';

function monitorBrowser(page) {
  const errors = [];

  page.on('pageerror', error => {
    errors.push(`pageerror: ${error.message}`);
  });

  page.on('console', msg => {
    if (msg.type() === 'error') {
      errors.push(`console: ${msg.text()}`);
    }
  });

  return errors;
}

test('PRE carga login público sin errores JS', async ({ page }) => {
  const errors = monitorBrowser(page);

  const response = await page.goto(PRE, {
    waitUntil: 'networkidle'
  });

  expect(response).not.toBeNull();
  expect(response.status()).toBeLessThan(400);

  await expect(page).toHaveTitle(/Urbanizaci[oó]n Flores de Riviera/i);
  expect(new URL(page.url()).pathname).toContain('/preproduccion/');

  await expect(page.locator('#app')).toBeVisible();
  await expect(page.locator('#login-form')).toBeVisible();

  await expect(page.locator('#email')).toBeVisible();
  await expect(page.locator('#password')).toBeVisible();
  await expect(page.locator('#forgot-password')).toBeVisible();

  await expect(
    page.getByRole('button', { name: 'Entrar' })
  ).toBeVisible();

  expect(errors).toEqual([]);
});

test('PRE carga los JS críticos', async ({ page }) => {
  const scripts = new Map();

  page.on('response', response => {
    const url = response.url();

    [
      'supabase-poc-config.js',
      'app.bundle.js',
      'supabase-poc-adapter.js',
      'supabase-final-adapter.js',
      'app-init.js'
    ].forEach(name => {
      if (url.includes(name)) {
        scripts.set(name, response.status());
      }
    });
  });

  await page.goto(PRE, {
    waitUntil: 'networkidle'
  });

  for (const name of [
    'supabase-poc-config.js',
    'app.bundle.js',
    'supabase-poc-adapter.js',
    'supabase-final-adapter.js',
    'app-init.js'
  ]) {
    expect(
      scripts.get(name),
      `${name} no cargó correctamente`
    ).toBe(200);
  }
});

test('recuperación de contraseña abre y permite volver', async ({ page }) => {
  const errors = monitorBrowser(page);

  await page.goto(PRE, {
    waitUntil: 'networkidle'
  });

  await page.locator('#forgot-password').click();

  await expect(
    page.getByRole('heading', { name: 'Restablecer contraseña' })
  ).toBeVisible();

  await expect(page.locator('#forgot-email')).toBeVisible();
  await expect(page.locator('#forgot-back')).toBeVisible();

  await page.locator('#forgot-back').click();

  await expect(page.locator('#login-form')).toBeVisible();

  expect(errors).toEqual([]);
});

test('pantalla de nueva contraseña renderiza correctamente', async ({ page }) => {
  const errors = monitorBrowser(page);

  await page.goto(`${PRE}?resetPassword=1`, {
    waitUntil: 'domcontentloaded'
  });

  await expect(
    page.getByRole('heading', { name: 'Crear nueva contraseña' })
  ).toBeVisible();

  await expect(page.locator('#recovery-password')).toBeVisible();
  await expect(page.locator('#recovery-confirm')).toBeVisible();

  expect(errors).toEqual([]);
});
