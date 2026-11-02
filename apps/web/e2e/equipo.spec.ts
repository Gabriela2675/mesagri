/*
 * Equipo de Mesagri en el panel web: la administración general agrega a una persona con su rol y le
 * da una clave temporal; la persona entra por primera vez, crea su contraseña y activa su doble
 * factor (el código lo calcula aquí la prueba, como Google Authenticator). Cada persona personaliza
 * sus datos y hace suya su cuenta de prueba. Corre con el servidor y en la versión autónoma.
 */
import { test, expect, type Page } from '@playwright/test';
import crypto from 'node:crypto';
import { BASE, LOCAL_MODE, teamHeaders, rememberTeamKey } from './util';

const PANEL = BASE + (LOCAL_MODE ? '/index.html?modo=panel' : '/panel');

/** El código de 6 dígitos de una app de autenticación (TOTP, RFC 6238). */
function totp(secretB32: string, at = Date.now()): string {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, v = 0;
  const key: number[] = [];
  for (const c of secretB32.replace(/\s/g, '')) { v = ((v << 5) | A.indexOf(c)) & 0xffff; bits += 5; if (bits >= 8) { key.push((v >>> (bits - 8)) & 255); bits -= 8; } }
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const h = crypto.createHmac('sha1', Buffer.from(key)).update(msg).digest();
  const o = h[19] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

async function resetTeam(page: Page) {
  if (LOCAL_MODE) return;
  const r = await page.request.post(BASE + '/api/v1/demo/reset', { data: { team: true }, headers: teamHeaders() });
  expect(r.ok()).toBe(true);
}
const scr = (page: Page) => page.locator('[data-screen]').first();

async function openPanel(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/401|Unauthorized|status of 4\d\d/.test(m.text())) errors.push(m.text()); });
  await rememberTeamKey(page);
  await page.goto(PANEL);
  await expect(scr(page)).toHaveAttribute('data-screen', 'W-01', { timeout: 20_000 });
  return errors;
}
async function demoLogin(page: Page, who: RegExp) {
  await page.locator('.wdemo').getByRole('button', { name: who }).first().click();
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await expect(scr(page)).toHaveAttribute('data-screen', 'W-02');
}
async function login(page: Page, email: string, password: string, code = '') {
  await page.getByLabel('Correo del equipo').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await page.getByLabel(/Código de tu app de autenticación/).fill(code);
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
}
async function logout(page: Page) {
  await page.locator('aside.side').getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(scr(page)).toHaveAttribute('data-screen', 'W-01');
}

test.beforeEach(async ({ page }) => { await resetTeam(page); });
test.afterAll(async ({ browser }) => { const p = await browser.newPage(); await resetTeam(p); await p.close(); });

test('la administración general agrega a una persona con su rol; en su primer ingreso crea su contraseña y su doble factor', async ({ page }) => {
  const errors = await openPanel(page);
  await demoLogin(page, /Majo/);
  const side = page.locator('aside.side');
  await side.getByRole('button', { name: /^Equipo/ }).click();
  await expect(scr(page)).toHaveAttribute('data-screen', 'W-19');
  // qué ve cada rol, sacado del mismo menú
  const roles = page.getByRole('region', { name: 'Qué puede hacer cada rol' });
  await expect(roles.getByRole('row', { name: /Auditoría/ })).toBeVisible();
  // los cuatro del proyecto son administración general
  for (const n of ['Majo', 'Gaby', 'Dayis', 'Kevin']) await expect(page.locator('table.wtable').first().getByRole('row', { name: new RegExp(`^${n}`) })).toContainText('Administración general');

  await page.getByRole('button', { name: 'Agregar persona' }).click();
  const form = page.getByRole('form', { name: 'Agregar persona al equipo' });
  await form.getByLabel('Nombre y apellido').fill('Rosa');
  await form.getByRole('button', { name: 'Crear cuenta y clave temporal' }).click();
  await expect(form.getByRole('alert')).toContainText('nombre y el apellido');
  await form.getByLabel('Nombre y apellido').fill('Rosa Quispe');
  await form.getByLabel(/^Correo/).fill('rosa.e2e@mesagri.pe');
  await form.getByLabel('Celular').fill('900000041');
  await form.getByRole('radio', { name: /^Verificación/ }).check();
  await form.getByRole('button', { name: 'Crear cuenta y clave temporal' }).click();
  const card = page.getByRole('region', { name: 'Acceso de Rosa Quispe' });
  await expect(card).toBeVisible();
  const temp = (await card.getByLabel('Clave temporal').innerText()).trim();
  expect(temp).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
  await expect(card.getByRole('button', { name: 'Enviar por WhatsApp' })).toBeVisible();
  await card.getByRole('button', { name: 'Listo' }).click();
  const row = page.locator('table.wtable').first().getByRole('row', { name: /Rosa Quispe/ });
  await expect(row).toContainText('Verificación');
  await expect(row).toContainText('Aún no entra');

  // Rosa entra por primera vez con su clave temporal (sin código)
  await logout(page);
  await login(page, 'rosa.e2e@mesagri.pe', temp);
  const fa = page.getByRole('form', { name: 'Primer ingreso' });
  await expect(fa.getByRole('heading', { name: 'Hola, Rosa' })).toBeVisible();
  await fa.getByLabel(/Tu contraseña nueva/).fill('rosa-segura-2026');
  await fa.getByLabel('Escríbela otra vez').fill('rosa-segura-2025');
  const secret = (await fa.locator('.totpkey').innerText()).replace(/\s/g, '');
  await fa.getByLabel('Código de tu app de autenticación').fill(totp(secret));
  await fa.getByRole('button', { name: 'Guardar y entrar' }).click();
  await expect(fa.getByRole('alert')).toContainText('no coinciden');
  await fa.getByLabel('Escríbela otra vez').fill('rosa-segura-2026');
  await fa.getByRole('button', { name: 'Guardar y entrar' }).click();
  await expect(scr(page)).toHaveAttribute('data-screen', 'W-02');
  // con su rol: verificaciones sí, equipo no
  await expect(side.getByRole('button', { name: /^Verificaciones/ })).toBeVisible();
  await expect(side.getByRole('button', { name: /^Equipo/ })).toHaveCount(0);
  await side.getByRole('button', { name: /^Mi cuenta/ }).click();
  await expect(page.getByRole('region', { name: 'Tu acceso' })).toContainText('Nadie más los conoce');

  // desde ahora entra con su contraseña y el código de su app; la clave temporal ya no sirve
  await logout(page);
  await login(page, 'rosa.e2e@mesagri.pe', temp, totp(secret));
  await expect(page.locator('.wlogin-card').getByRole('alert')).toBeVisible();
  await login(page, 'rosa.e2e@mesagri.pe', 'rosa-segura-2026', totp(secret));
  await expect(scr(page)).toHaveAttribute('data-screen', 'W-02');
  expect(errors).toEqual([]);
});

test('cada persona personaliza sus datos y hace suya su cuenta de prueba', async ({ page }) => {
  const errors = await openPanel(page);
  await demoLogin(page, /Kevin/);
  const side = page.locator('aside.side');
  await side.getByRole('button', { name: /^Mi cuenta/ }).click();
  await expect(scr(page)).toHaveAttribute('data-screen', 'W-20');
  const data = page.getByRole('form', { name: 'Tus datos' });
  await data.getByLabel(/^Tu nombre/).fill('Kevin Salas');
  await data.getByRole('button', { name: 'Guardar mis datos' }).click();
  await expect(side.locator('.who')).toContainText('Kevin Salas');

  const acc = page.getByRole('region', { name: 'Tu acceso' });
  await expect(acc).toContainText('todavía es de prueba');
  await acc.getByRole('button', { name: 'Hacer mía esta cuenta' }).click();
  await acc.getByLabel(/Tu contraseña nueva/).fill('kevin-propia-2026');
  await acc.getByLabel('Escríbela otra vez').fill('kevin-propia-2026');
  const secret = (await acc.locator('.totpkey').innerText()).replace(/\s/g, '');
  await acc.getByLabel('Código de tu app de autenticación').fill(totp(secret));
  await acc.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(acc).toContainText('Nadie más los conoce');

  // ya no es una cuenta de prueba: no aparece en la lista y entra solo con lo suyo
  await logout(page);
  await expect(page.locator('.wdemo').getByRole('button', { name: /Majo/ })).toBeVisible();
  await expect(page.locator('.wdemo').getByRole('button', { name: /Kevin/ })).toHaveCount(0);
  await login(page, 'kevin@mesagri.pe', 'kevin-propia-2026', totp(secret));
  await expect(scr(page)).toHaveAttribute('data-screen', 'W-02');
  await expect(side.locator('.who')).toContainText('Kevin Salas');
  expect(errors).toEqual([]);
});
