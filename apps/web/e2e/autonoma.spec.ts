/*
 * Versión autónoma (APK de Android y app web instalable): todo corre en el celular, sin servidor.
 * Se prueba con MESAGRI_LOCAL=1 contra la carpeta dist-app servida como archivos estáticos.
 */
import { test, expect, type Page } from '@playwright/test';
import { BASE, LOCAL_MODE, screen, tap, nav } from './util';

test.skip(!LOCAL_MODE, 'Solo para la versión autónoma');

const APP = BASE + '/index.html';

async function open(page: Page, url = APP) {
  const errors: string[] = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
  page.on('request', r => { if (/\/api\/|socket\.io/.test(r.url())) errors.push('PIDIÓ AL SERVIDOR ' + r.url()); });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url);
  return errors;
}

async function loginAs(page: Page, type: string, who: RegExp) {
  const app = page.locator('.ph-in');
  await expect(screen(app)).toHaveAttribute('data-screen', 'A-01', { timeout: 20_000 });
  await tap(app, /Ya tengo cuenta/);
  await app.getByRole('button', { name: type, exact: true }).click();
  await tap(app, /Ver cuentas de prueba/);
  await app.getByRole('button', { name: who }).first().click();
  await expect(app.getByLabel('Código de acceso')).toHaveValue(/^\d{6}$/);
  await tap(app, 'Ingresar', true);
  return app;
}

test('abre sin servidor, ingresa por tipo y lo hecho queda guardado en el celular', async ({ page }) => {
  const errors = await open(page);
  const app = page.locator('.ph-in');
  await expect(screen(app)).toHaveAttribute('data-screen', 'A-01', { timeout: 20_000 });
  await expect(app.getByText(/todo se guarda en este celular/)).toBeVisible();
  // el celular de Wilber en «Comprador»: avisa y deja entrar como agricultor
  await tap(app, /Ya tengo cuenta/);
  await app.getByRole('button', { name: 'Comprador (MYPE)', exact: true }).click();
  await app.getByLabel('Número de celular').fill('987654321');
  await tap(app, 'Pedir código', true);
  await expect(app.getByLabel('Código de acceso')).toHaveValue(/^\d{6}$/);
  await tap(app, 'Ingresar', true);
  await expect(app.getByText(/registrado como agricultor/)).toBeVisible();
  await tap(app, /Ingresar como agricultor/);
  await tap(app, 'Ingresar', true);
  await expect(screen(app)).toHaveAttribute('data-screen', 'A-08');
  // al cerrar y volver a abrir la app, sigue con su sesión
  await page.reload();
  await expect(screen(page.locator('.ph-in'))).toHaveAttribute('data-screen', 'A-08', { timeout: 20_000 });
  expect(errors).toEqual([]);
});

test('una compra queda guardada al cerrar y abrir la app, y se puede volver a los datos de ejemplo', async ({ page }) => {
  const errors = await open(page);
  const b = await loginAs(page, 'Comprador (MYPE)', /Doña Charo/);
  await expect(screen(b)).toHaveAttribute('data-screen', 'B-05');
  await b.getByLabel('Buscar productos').fill('papa');
  await b.getByLabel('Buscar productos').press('Enter');
  await b.locator('[role=button][aria-label*="Wilber"]').first().click();
  await tap(b, /^Agregar ·/);
  await nav(b, 'Carrito');
  await tap(b, 'Continuar', true);
  await tap(b, 'Continuar al pago');
  await tap(b, 'Confirmar pedido');
  await expect(screen(b)).toHaveAttribute('data-screen', 'B-13');
  const waiting = b.locator('.card').filter({ hasText: 'Esperando que acepte' });
  await expect(waiting).toHaveCount(1);
  await page.waitForTimeout(700); // se guarda en el celular
  await page.reload();
  const b2 = page.locator('.ph-in');
  await expect(screen(b2)).toHaveAttribute('data-screen', 'B-13', { timeout: 20_000 });
  await expect(b2.locator('.card').filter({ hasText: 'Esperando que acepte' })).toHaveCount(1);
  // salir y volver a los datos de ejemplo: el pedido ya no está
  await nav(b2, 'Perfil');
  await tap(b2, /Cerrar sesión/);
  await expect(screen(b2)).toHaveAttribute('data-screen', 'A-01');
  await tap(b2, 'Volver a los datos de ejemplo');
  await page.getByRole('dialog').getByRole('button', { name: 'Reiniciar' }).click();
  await expect(page.getByText('Listo: datos de ejemplo de nuevo.')).toBeVisible();
  const b3 = await loginAs(page, 'Comprador (MYPE)', /Doña Charo/);
  await nav(b3, 'Pedidos');
  await expect(b3.locator('.card').filter({ hasText: 'Esperando que acepte' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('el equipo entra al panel desde la app, con clave y código de doble factor', async ({ page }) => {
  const errors = await open(page);
  const app = page.locator('.ph-in');
  await expect(screen(app)).toHaveAttribute('data-screen', 'A-01', { timeout: 20_000 });
  await tap(app, /Ya tengo cuenta/);
  await app.getByRole('button', { name: 'Equipo de Mesagri', exact: true }).click();
  await tap(app, /Abrir el panel web/);
  await expect(page).toHaveURL(/modo=panel/);
  const w = page.locator('.ph-in');
  await expect(screen(w)).toHaveAttribute('data-screen', 'W-01', { timeout: 20_000 });
  // clave equivocada: no entra
  await w.getByLabel('Correo del equipo').fill('carlos@mesagri.pe');
  await w.locator('input[type=password]').fill('otra-clave');
  await w.getByLabel(/Código de tu app/).fill('123456');
  await w.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await expect(w.getByRole('alert')).toContainText(/no son correctos/);
  // cuenta de prueba (llena clave y código vigente)
  await w.locator('.wdemo').getByRole('button', { name: /Lucía/ }).first().click();
  await w.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await expect(screen(w)).toHaveAttribute('data-screen', 'W-02');
  expect(errors).toEqual([]);
});

test('dentro del APK: sin service worker y el botón atrás vuelve de pantalla en pantalla', async ({ browser }) => {
  const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36 MesagriApp/1.0.0', viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errors = await open(page);
  const b = await loginAs(page, 'Comprador (MYPE)', /Doña Charo/);
  await expect(screen(b)).toHaveAttribute('data-screen', 'B-05');
  await nav(b, 'Perfil');
  await tap(b, /Solicitudes de compra/);
  await expect(screen(b)).toHaveAttribute('data-screen', 'B-17');
  expect(await page.evaluate(() => (window as any).__mesagriBack())).toBe(true);
  await expect(screen(b)).toHaveAttribute('data-screen', 'B-20');
  expect(await page.evaluate(() => (window as any).__mesagriBack())).toBe(false);
  expect(await page.evaluate(async () => ((await navigator.serviceWorker?.getRegistrations?.()) ?? []).length)).toBe(0);
  await expect(page.getByText('Ten Mesagri como app en tu celular')).toHaveCount(0);
  expect(errors).toEqual([]);
  await ctx.close();
});

test('app instalable: después de abrirla una vez, abre sin señal', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await open(page);
  await expect(screen(page.locator('.ph-in'))).toHaveAttribute('data-screen', 'A-01', { timeout: 20_000 });
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.waitForTimeout(1500);
  await ctx.setOffline(true);
  await page.reload();
  await expect(screen(page.locator('.ph-in'))).toHaveAttribute('data-screen', 'A-01', { timeout: 20_000 });
  const b = await loginAs(page, 'Comprador (MYPE)', /Doña Charo/);
  await expect(screen(b)).toHaveAttribute('data-screen', 'B-05');
  await ctx.close();
});

test('en el APK: dictado y voz del celular, y los archivos se guardan o comparten con Android', async ({ browser }) => {
  const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36 MesagriApp/1.0.0', viewport: { width: 390, height: 844 } });
  // el WebView de Android no trae voz del navegador: la pone el APK (aquí, un doble del puente)
  await ctx.addInitScript(() => {
    const w = window as any;
    for (const k of ['speechSynthesis', 'webkitSpeechRecognition', 'SpeechRecognition']) Object.defineProperty(w, k, { value: undefined, configurable: true });
    w.__calls = [];
    w.MesagriAndroid = {
      canSpeak: () => true,
      speak: (t: string) => { w.__calls.push(['speak', t]); setTimeout(() => w.__mesagriSpoken?.(), 10); },
      stopSpeaking: () => {},
      listen: () => { w.__calls.push(['listen']); setTimeout(() => w.__mesagriHeard?.('Tengo 50 kilos de cebolla roja, cosechada hoy, a uno cincuenta el kilo', null), 60); },
      saveFile: (b64: string, name: string, mime: string) => { w.__calls.push(['save', name, mime, b64.length]); },
    };
  });
  const page = await ctx.newPage();
  const errors = await open(page);
  const f = await loginAs(page, 'Agricultor', /Wilber Huamaní/);
  await expect(screen(f)).toHaveAttribute('data-screen', 'A-08');
  await nav(f, 'Publicar');
  await f.getByRole('button', { name: 'Toca y habla' }).click();
  await expect(screen(f)).toHaveAttribute('data-screen', 'A-11');
  await expect(f.getByText('Cebolla roja · 50 kg')).toBeVisible();
  await tap(f, 'Publicar', true);
  await expect(screen(f)).toHaveAttribute('data-screen', 'A-09');
  await nav(f, 'Perfil');
  await tap(f, /Cerrar sesión/);
  const b = await loginAs(page, 'Comprador (MYPE)', /Andrés/);
  await nav(b, 'Reportes');
  await tap(b, /Descargar para Excel/);
  await expect.poll(() => page.evaluate(() => (window as any).__calls.some((c: any[]) => c[0] === 'save'))).toBe(true);
  const calls = await page.evaluate(() => (window as any).__calls);
  expect(calls.some((c: any[]) => c[0] === 'listen')).toBe(true);
  const save = calls.find((c: any[]) => c[0] === 'save');
  expect(save[1]).toMatch(/^ahorro-.*\.csv$/);
  expect(save[2]).toBe('text/csv');
  expect(save[3]).toBeGreaterThan(20);
  expect(errors).toEqual([]);
  await ctx.close();
});
