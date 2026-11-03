/*
 * Identidad con visión por computadora: DNI con su dígito (consulta del nombre en el padrón de
 * prueba), fotos del DNI por los dos lados y del rostro en tres ángulos con la cámara guiada, que
 * toma cada foto sola cuando la cara está en el ángulo pedido. En el panel, la revisión automática
 * lee el código del reverso del DNI, busca el número en el frente y compara el rostro con la foto
 * del DNI (solo con servidor: la versión sin internet no lleva el lector de texto).
 * La cámara es la de Chromium de pruebas, que pasa un video con las tres fotos de ejemplo.
 * También: los campos con «S/» muestran todos los dígitos.
 */
import { test, expect, type Locator, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { start, phone, screen, tap, persona, webPanel, nav, LOCAL_MODE } from './util';

// el «video» de la cámara: 5 s de frente, 5 s girando a su derecha, 5 s a su izquierda (se repite)
const MUESTRAS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/muestras');
const VIDEO = path.join(os.tmpdir(), 'mesagri-caras.mjpeg');
fs.writeFileSync(VIDEO, Buffer.concat(['rostro-frente.jpg', 'rostro-derecha.jpg', 'rostro-izquierda.jpg'].flatMap(f => Array(150).fill(fs.readFileSync(path.join(MUESTRAS, f))))));
test.use({ launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${VIDEO}`] } });

/** El número cabe completo en su recuadro (no se corta ningún dígito). */
const fits = (l: Locator) => l.evaluate((el: HTMLInputElement) => el.scrollWidth <= el.clientWidth + 1);

/** Un agricultor nuevo hasta el paso de identidad (A-05). */
async function toIdentity(page: Page, phoneNo: string) {
  const n = phone(page, 2);
  await persona(page, 2, /Celular nuevo/);
  await expect(screen(n)).toHaveAttribute('data-screen', 'A-01', { timeout: 6000 });
  await tap(n, 'Continuar', true);
  await n.getByRole('button', { name: 'Soy agricultor' }).click();
  await n.getByLabel('Número de celular').fill(phoneNo);
  await tap(n, 'Enviar código');
  await expect(screen(n)).toHaveAttribute('data-screen', 'A-03');
  const otp = (await n.locator('.toast').filter({ hasText: 'tu código es' }).first().innerText()).match(/\d{6}/)![0];
  await n.getByLabel('Dígito 1').fill(otp);
  await tap(n, 'Verificar');
  await expect(screen(n)).toHaveAttribute('data-screen', 'A-04');
  for (const s of await n.getByRole('switch').all()) if ((await s.getAttribute('aria-checked')) !== 'true') await s.click();
  await tap(n, 'Acepto y continúo');
  await expect(screen(n)).toHaveAttribute('data-screen', 'A-05');
  return n;
}

test('agricultor: DNI con su dígito, fotos del DNI y el rostro en tres ángulos con la cámara guiada; el panel lo revisa solo', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = await start(page);
  const n = await toIdentity(page, '987 222 301');
  // el nombre se consulta con el DNI (aquí, el padrón de prueba de la demo)
  await n.getByLabel('Nombre completo').fill('Rubén Darío Huamaní Condori');
  await n.getByLabel('DNI', { exact: true }).fill('44871209');
  await n.getByLabel('Dígito de verificación').fill('1');
  await expect(n.getByRole('status').filter({ hasText: 'Coincide con el padrón de prueba' })).toBeVisible({ timeout: 10_000 });
  // sin fotos no se puede continuar con la verificación
  await tap(n, 'Continuar', true);
  await expect(n.getByRole('alert').filter({ hasText: 'foto del DNI' })).toBeVisible();
  await n.getByRole('button', { name: 'Usar foto de ejemplo: DNI · frente' }).click();
  await n.getByRole('button', { name: 'Usar foto de ejemplo: DNI · reverso' }).click();
  await expect(n.locator('.grid2 .chip').filter({ hasText: 'Se ve bien' })).toHaveCount(2, { timeout: 30_000 });
  // la cámara guiada: toma sola la foto de frente, a la derecha y a la izquierda
  await n.getByRole('button', { name: /Tomar las 3 fotos de tu rostro/ }).click();
  const cam = n.getByRole('group', { name: 'Cámara para las fotos de tu rostro' });
  await expect(cam).toBeVisible();
  await expect(cam.getByText('Mira de frente', { exact: true })).toBeVisible();
  await expect(cam).toBeHidden({ timeout: 90_000 });
  const chips = n.locator('.idfaces .chip');
  await expect(chips).toHaveCount(3);
  await expect(chips.filter({ hasText: 'Bien' })).toHaveCount(3);
  await tap(n, 'Continuar', true);
  await expect(screen(n)).toHaveAttribute('data-screen', 'A-06');
  const num = n.getByLabel('Número', { exact: true });
  if (await num.count()) await num.fill('987222301');
  await tap(n, 'Continuar', true);
  await expect(screen(n)).toHaveAttribute('data-screen', 'A-07');
  // el costo de envío por distrito: «12,50» se ve completo
  await n.getByRole('switch', { name: 'Chivay' }).click();
  const fee = n.getByLabel('Costo de envío a Chivay');
  await fee.fill('12,50');
  await expect(fee).toHaveValue('12,50');
  expect(await fits(fee)).toBe(true);
  await tap(n, 'Guardar zonas');
  await expect(screen(n)).not.toHaveAttribute('data-screen', 'A-07');

  // el panel: la consulta del DNI, la prueba de vida y, con servidor, la lectura del DNI y el parecido del rostro
  const w = await webPanel(page, /Lucía/);
  await w.locator('aside.side').getByRole('button', { name: /^Verificaciones/ }).click();
  const row = w.getByRole('row', { name: /Rubén Darío/ });
  await expect(row).toContainText('Rostro (3 ángulos)');
  await row.getByRole('button', { name: /^(Tomar|Abrir)$/ }).click();
  await expect(screen(w)).toHaveAttribute('data-screen', 'W-04');
  const rev = w.getByRole('region', { name: 'Revisión automática de identidad' });
  await expect(rev).toContainText('padrón de prueba');
  await expect(rev.locator('.rowx').filter({ hasText: 'DNI 44871209' })).toContainText('Coincide');
  await expect(rev.locator('.rowx').filter({ hasText: 'Prueba de vida' })).toContainText('Tomadas en vivo con la cámara guiada');
  await expect(rev.locator('.rowx').filter({ hasText: 'Prueba de vida' })).toContainText('Bien');
  if (!LOCAL_MODE) {
    await expect(rev.getByText('Parecido alto')).toBeVisible({ timeout: 120_000 });
    const mrz = rev.locator('.rowx').filter({ hasText: 'Código del reverso' });
    await expect(mrz).toContainText('Dígitos de control correctos', { timeout: 120_000 });
    await expect(mrz).toContainText('HUAMANI CONDORI, RUBEN DARIO');
    await expect(mrz).toContainText('vence el 02/06/2030');
    await expect(rev.locator('.rowx').filter({ hasText: 'Número en el frente' })).toContainText('Se lee', { timeout: 60_000 });
  } else {
    await expect(rev.locator('.rowx').filter({ hasText: 'Código del reverso' })).toContainText('solo en el panel en línea', { timeout: 60_000 });
  }
  await w.getByLabel('Motivo').fill('DNI y rostro coinciden; tres ángulos tomados en vivo.');
  await tap(w, 'Guardar decisión');
  await page.getByRole('tab', { name: /Celulares/ }).click();
  await expect(page.locator('.slot').nth(2).locator('.pick')).toContainText('nivel 1');
  expect(errors).toEqual([]);
});

test('un DNI de una persona fallecida no se puede usar; un nombre que no coincide se avisa', async ({ page }) => {
  const errors = await start(page);
  const n = await toIdentity(page, '987 222 302');
  await n.getByRole('button', { name: /Prueba: 40817263/ }).click();
  await n.getByLabel('Nombre completo').fill('Mario Ccapa Huamaní');
  await expect(n.getByRole('status').filter({ hasText: 'persona fallecida' })).toBeVisible({ timeout: 10_000 });
  await n.getByRole('button', { name: /Puedes hacerlo después/ }).click();
  await expect(n.getByRole('alert').filter({ hasText: 'fallecida' })).toBeVisible();
  await expect(screen(n)).toHaveAttribute('data-screen', 'A-05');
  // otro DNI, con un nombre que no es el suyo
  await n.getByLabel('DNI', { exact: true }).fill('41235876');
  await n.getByLabel('Nombre completo').fill('Rosa Ccalla Huamán');
  await expect(n.getByRole('status').filter({ hasText: 'no coincide con este DNI' })).toBeVisible({ timeout: 10_000 });
  await n.getByLabel('Nombre completo').fill('Teodora Quispe Mamani');
  await expect(n.getByRole('status').filter({ hasText: 'Coincide con el padrón de prueba' })).toBeVisible({ timeout: 10_000 });
  // el dígito que no corresponde al número se avisa al momento
  await n.getByLabel('Dígito de verificación').fill('K');
  await expect(n.getByText('El dígito no corresponde a ese número de DNI')).toBeVisible();
  expect(errors).toEqual([]);
});

test('sin cámara en vivo: cada foto del rostro se toma con la cámara del celular y se revisa igual', async ({ page }) => {
  await page.addInitScript(() => { if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permiso denegado', 'NotAllowedError')); });
  const errors = await start(page);
  const n = await toIdentity(page, '987 222 303');
  await n.getByRole('button', { name: /Tomar las 3 fotos de tu rostro/ }).click();
  await expect(n.locator('.toast').filter({ hasText: 'No se pudo abrir la cámara en vivo' })).toBeVisible();
  // una foto de frente puesta donde va la de la derecha: la revisión lo nota
  await n.getByLabel('Foto del rostro: de frente', { exact: true }).setInputFiles(path.join(MUESTRAS, 'rostro-frente.jpg'));
  await n.getByLabel('Foto del rostro: a tu derecha', { exact: true }).setInputFiles(path.join(MUESTRAS, 'rostro-frente.jpg'));
  await expect(n.locator('.toast').filter({ hasText: 'Gira un poco más' })).toBeVisible({ timeout: 30_000 });
  await n.getByLabel('Foto del rostro: a tu izquierda', { exact: true }).setInputFiles(path.join(MUESTRAS, 'rostro-izquierda.jpg'));
  const chips = n.locator('.idfaces .chip');
  await expect(chips).toHaveCount(3, { timeout: 30_000 });
  await expect(chips.nth(1)).toHaveText(/Revisar/);
  await expect(n.getByText(/Alguna foto no salió como pedimos/)).toBeVisible();
  // la repite bien
  await n.getByLabel('Foto del rostro: a tu derecha', { exact: true }).setInputFiles(path.join(MUESTRAS, 'rostro-derecha.jpg'));
  await expect(chips.filter({ hasText: 'Bien' })).toHaveCount(3, { timeout: 30_000 });
  await expect(n.getByText(/Alguna foto no salió como pedimos/)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('MYPE: el representante manda su identidad para el nivel 1 desde «Verifica tu negocio»', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = await start(page);
  const b = phone(page, 2);
  await persona(page, 2, /Celular nuevo/);
  await expect(screen(b)).toHaveAttribute('data-screen', 'A-01', { timeout: 6000 });
  await tap(b, 'Continuar', true);
  await b.getByRole('button', { name: 'Soy comprador (MYPE)' }).click();
  await expect(screen(b)).toHaveAttribute('data-screen', 'B-02');
  await b.getByRole('button', { name: /^Prueba: 2/ }).first().click();
  await b.getByLabel('Dirección').fill('Av. Ejército 512');
  await b.getByLabel('Representante').fill('Rubén Darío Huamaní Condori');
  await tap(b, 'Continuar', true);
  await expect(screen(b)).toHaveAttribute('data-screen', 'A-02');
  await b.getByLabel('Número de celular').fill('987 222 304');
  await tap(b, 'Enviar código');
  const otp = (await b.locator('.toast').filter({ hasText: 'tu código es' }).first().innerText()).match(/\d{6}/)![0];
  await b.getByLabel('Dígito 1').fill(otp);
  await tap(b, 'Verificar');
  for (const s of await b.getByRole('switch').all()) if ((await s.getAttribute('aria-checked')) !== 'true') await s.click();
  await tap(b, 'Acepto y continúo');
  await expect(screen(b)).toHaveAttribute('data-screen', 'B-04');
  // «Representante · nivel 1» abre la pantalla de identidad con la cámara guiada
  await b.locator('.row.top').filter({ hasText: 'Representante · nivel 1' }).first().getByRole('button', { name: 'Subir' }).click();
  await expect(screen(b)).toHaveAttribute('data-screen', 'ID-01');
  await expect(b.getByLabel('Nombre completo')).toHaveValue('Rubén Darío Huamaní Condori');
  await b.getByLabel('DNI', { exact: true }).fill('44871209');
  await b.getByLabel('Dígito de verificación').fill('1');
  await b.getByRole('button', { name: 'Usar foto de ejemplo: DNI · frente' }).click();
  await b.getByRole('button', { name: 'Usar foto de ejemplo: DNI · reverso' }).click();
  await b.getByRole('button', { name: 'Usar fotos de ejemplo del rostro' }).click();
  await expect(b.locator('.idfaces .chip').filter({ hasText: 'Bien' })).toHaveCount(3, { timeout: 30_000 });
  await expect(b.getByRole('status').filter({ hasText: 'Coincide con el padrón de prueba' })).toBeVisible({ timeout: 10_000 });
  await tap(b, 'Enviar a verificación');
  await expect(screen(b)).toHaveAttribute('data-screen', 'B-04');
  await expect(b.locator('.row.top').filter({ hasText: 'Representante · nivel 1' }).first()).toContainText('En revisión');
  expect(errors).toEqual([]);
});

test('los montos y cantidades con «S/» o «kg» se ven completos al escribirlos', async ({ page }) => {
  const errors = await start(page);
  const f = phone(page, 0);
  await nav(f, 'Publicar');
  await f.getByRole('tab', { name: 'Con íconos' }).click();
  await f.locator('.grid3 .card').first().click();
  const price = f.getByLabel('Precio por kilo').first();
  await expect(price).toBeVisible();
  for (const v of ['12,50', '125,90']) {
    await price.fill(v);
    expect(await fits(price)).toBe(true);
  }
  const qty = f.getByLabel('Cantidad').first();
  if (await qty.count()) { await qty.fill('12500'); expect(await fits(qty)).toBe(true); }
  expect(errors).toEqual([]);
});

/** Hasta el paso después de verificar el celular (transportista o almacén). */
async function registerAs(page: Page, role: RegExp, ruc: RegExp, phoneNo: string) {
  const n = phone(page, 2);
  await persona(page, 2, /Celular nuevo/);
  await expect(screen(n)).toHaveAttribute('data-screen', 'A-01', { timeout: 6000 });
  await tap(n, 'Continuar', true);
  await n.getByRole('button', { name: role }).click();
  await n.getByRole('button', { name: ruc }).first().click();
  await tap(n, 'Continuar', true);
  await expect(screen(n)).toHaveAttribute('data-screen', 'A-02');
  await n.getByLabel('Número de celular').fill(phoneNo);
  await tap(n, 'Enviar código');
  const otp = (await n.locator('.toast').filter({ hasText: 'tu código es' }).first().innerText()).match(/\d{6}/)![0];
  await n.getByLabel('Dígito 1').fill(otp);
  await tap(n, 'Verificar');
  for (const s of await n.getByRole('switch').all()) if ((await s.getAttribute('aria-checked')) !== 'true') await s.click();
  await tap(n, 'Acepto y continúo');
  return n;
}
async function fillIdentity(n: Locator) {
  await n.getByLabel('Nombre completo').fill('Rubén Darío Huamaní Condori');
  await n.getByLabel('DNI', { exact: true }).fill('44871209');
  await n.getByLabel('Dígito de verificación').fill('1');
  await n.getByRole('button', { name: 'Usar foto de ejemplo: DNI · frente' }).click();
  await n.getByRole('button', { name: 'Usar foto de ejemplo: DNI · reverso' }).click();
  await n.getByRole('button', { name: 'Usar fotos de ejemplo del rostro' }).click();
  await expect(n.locator('.idfaces .chip').filter({ hasText: 'Bien' })).toHaveCount(3, { timeout: 30_000 });
  await expect(n.getByRole('status').filter({ hasText: 'Coincide con el padrón de prueba' })).toBeVisible({ timeout: 10_000 });
}

test('transportista: quien maneja se identifica con el DNI y el rostro en tres ángulos antes del vehículo', async ({ page }) => {
  const errors = await start(page);
  const n = await registerAs(page, /Soy transportista aliado/, /^Prueba: 10/, '987 222 305');
  await expect(screen(n)).toHaveAttribute('data-screen', 'T-02');
  // sin la identidad completa no avanza
  await tap(n, 'Continuar', true);
  await expect(n.getByText('El DNI tiene 8 números.').first()).toBeVisible();
  await fillIdentity(n);
  await n.getByLabel('Vencimiento de la licencia').fill('2029-05-01');
  await n.getByRole('button', { name: 'Usar foto de ejemplo: Licencia' }).click();
  await tap(n, 'Continuar', true);
  await expect(screen(n)).toHaveAttribute('data-screen', 'T-03');
  expect(errors).toEqual([]);
});

test('almacén: el representante se identifica igual en «Documentos»', async ({ page }) => {
  const errors = await start(page);
  const n = await registerAs(page, /Soy almacén aliado/, /^Prueba: 2061555666/, '987 222 306');
  await expect(screen(n)).toHaveAttribute('data-screen', 'C-02');
  const row = n.locator('.row.top').filter({ hasText: 'DNI del representante' }).first();
  await row.getByRole('button', { name: 'Subir' }).click();
  await fillIdentity(n);
  await expect(row.getByRole('button', { name: 'Ver' })).toBeVisible();
  expect(errors).toEqual([]);
});
