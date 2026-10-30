const { test, expect } = require('@playwright/test');

const PRE =
  'https://floresderiviera.github.io/parking-comunidad/preproduccion/';

function credentials(prefix) {
  return {
    email: process.env[`PRE_${prefix}_EMAIL`],
    password: process.env[`PRE_${prefix}_PASSWORD`]
  };
}

async function login(page, role) {
  const { email, password } = credentials(role);

  test.skip(
    !email || !password,
    `Faltan PRE_${role}_EMAIL / PRE_${role}_PASSWORD`
  );

  await page.goto(PRE, { waitUntil: 'networkidle' });

  await page.waitForFunction(async () => {
    const first = document.querySelector('#login-form');
    if (!first) return false;

    await new Promise(resolve => setTimeout(resolve, 500));

    return document.querySelector('#login-form') === first;
  });

  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);

  await page.locator('#login-form').evaluate(form => {
    const button = form.querySelector('button');
    form.requestSubmit(button);
  });

  await page.locator('#main').waitFor({
    state: 'visible',
    timeout: 20000
  });

  await expect(page.locator('#login-form')).toHaveCount(0);

  const roleSwitch = page.locator('#role-switch');

  if (await roleSwitch.count()) {
    const options = await roleSwitch.locator('option').allTextContents();

    if (options.includes(role)) {
      await roleSwitch.selectOption(role);

      await page.locator('#main').waitFor({
        state: 'visible',
        timeout: 10000
      });
    }
  }
}

test.describe('ADMIN', () => {
  test('navegación principal carga', async ({ page }) => {
    await login(page, 'ADMIN');

    await expect(
      page.locator('#nav button[data-view="housing"]')
    ).toBeVisible();

    await page.locator('#nav button[data-view="housing"]').click();

    await expect(page.locator('#main')).not.toContainText('No se pudo cargar');

    await page.locator('#nav button[data-view="incidents"]').click();

    await expect(page.locator('#main')).not.toContainText('No se pudo cargar');

    await page.locator('#nav button[data-view="requests"]').click();

    await expect(page.locator('#main')).not.toContainText('No se pudo cargar');
  });
});

test.describe('CONTROL', () => {
  test('pantalla Control e Incidencias cargan', async ({ page }) => {
    await login(page, 'CONTROL');

    await expect(
      page.locator('#nav button[data-view="control"]')
    ).toBeVisible();

    await page.locator('#nav button[data-view="control"]').click();

    await expect(page.locator('#main')).not.toContainText('No se pudo cargar');

    await page.locator('#nav button[data-view="incidents"]').click();

    await expect(page.locator('#main')).not.toContainText('No se pudo cargar');
  });
});

test.describe('PROPIETARIO', () => {
  test('vistas principales cargan', async ({ page }) => {
    await login(page, 'PROPIETARIO');

    for (const view of [
      'ownerHome',
      'ownerHousing',
      'ownerVehicles',
      'ownerIncidents',
      'ownerRequests'
    ]) {
      const button = page.locator(
        `#nav button[data-view="${view}"]`
      );

      await expect(button).toBeVisible();
      await button.click();

      await expect(page.locator('#main')).not.toContainText(
        'No se pudo cargar'
      );
    }
  });
});
