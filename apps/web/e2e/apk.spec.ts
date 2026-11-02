/*
 * El APK conectado al servidor de la nube: la pantalla de conexión (mientras el servidor gratuito
 * despierta, sin internet, cambio de dirección) y la app del servidor dentro del WebView de Android
 * (aquí, Chromium con el agente de usuario del APK y un doble del puente con Android).
 */
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { BASE, LOCAL_MODE, screen, tap, nav, teamHeaders } from './util';

test.skip(LOCAL_MODE, 'Con el servidor de Mesagri');
test.beforeEach(async ({ request }) => {
  expect((await request.post(BASE + '/api/v1/demo/reset', { data: {}, headers: teamHeaders() })).ok()).toBe(true);
});

const APK_UA = 'Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36 MesagriApp/1.2.0';

test('APK: pantalla de conexión mientras despierta el servidor, sin internet y cambio de dirección', async ({ browser }) => {
  const ctx = await browser.newContext({ userAgent: APK_UA, viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(() => {
    const w = window as any;
    w.__calls = [];
    w.MesagriAndroid = {
      server: () => 'https://mesagri.onrender.com',
      goOnline: () => w.__calls.push(['goOnline']),
      openOffline: () => w.__calls.push(['openOffline']),
      setServer: (u: string) => { w.__calls.push(['setServer', u]); return true; },
    };
  });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route(BASE + '/conexion.html', r => r.fulfill({ path: path.resolve(process.cwd(), '../android/conexion.html'), contentType: 'text/html; charset=utf-8' }));
  await page.goto(BASE + '/conexion.html');
  await expect(page.getByRole('heading', { name: /Conectando con Mesagri/ })).toBeVisible();
  await expect(page.getByText('https://mesagri.onrender.com', { exact: true })).toBeVisible();
  // el servidor tarda en despertar: se ve el intento
  await page.evaluate(() => (window as any).__mesagri.waiting(5));
  await expect(page.getByText(/Despertando el servidor… \(intento 5\)/)).toBeVisible();
  // sin internet: intentar de nuevo o probar la versión de ejemplo del celular
  await page.evaluate(() => (window as any).__mesagri.offline());
  await expect(page.getByRole('heading', { name: 'Sin internet' })).toBeVisible();
  await page.getByRole('button', { name: 'Probar sin internet' }).click();
  await page.getByRole('button', { name: 'Intentar de nuevo' }).click();
  await expect(page.getByRole('heading', { name: /Conectando con Mesagri/ })).toBeVisible();
  // otra dirección: se valida antes de guardar
  await page.getByRole('button', { name: 'Cambiar la dirección' }).click();
  await page.getByLabel('Dirección del servidor de Mesagri').fill('mesagri');
  await page.getByRole('button', { name: 'Guardar y conectar' }).click();
  await expect(page.getByText(/Escribe una dirección completa/)).toBeVisible();
  await page.getByLabel('Dirección del servidor de Mesagri').fill('https://mesagri-abcd.onrender.com');
  await page.getByRole('button', { name: 'Guardar y conectar' }).click();
  const calls = await page.evaluate(() => (window as any).__calls);
  expect(calls).toEqual([['openOffline'], ['goOnline'], ['setServer', 'https://mesagri-abcd.onrender.com']]);
  expect(errors).toEqual([]);
  await ctx.close();
});

test('APK conectado al servidor: la app de la nube con el botón atrás de Android y sin service worker', async ({ browser }) => {
  const ctx = await browser.newContext({ userAgent: APK_UA, viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(() => {
    const w = window as any;
    w.MesagriAndroid = { server: () => location.origin, canSpeak: () => false, speak: () => {}, stopSpeaking: () => {}, listen: () => {}, saveFile: () => {}, goOnline: () => {}, openOffline: () => {}, setServer: () => true };
  });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
  await page.goto(BASE + '/');
  const app = page.locator('.ph-in');
  await expect(screen(app)).toHaveAttribute('data-screen', 'A-01', { timeout: 20_000 });
  // la versión en línea avisa que es de prueba y que no se pongan datos reales
  await expect(app.getByText(/Versión de prueba en línea/)).toBeVisible();
  await tap(app, /Ya tengo cuenta/);
  await app.getByRole('button', { name: 'Comprador (MYPE)', exact: true }).click();
  await tap(app, /Ver cuentas de prueba/);
  await app.getByRole('button', { name: /Doña Charo/ }).first().click();
  await expect(app.getByLabel('Código de acceso')).toHaveValue(/^\d{6}$/);
  await tap(app, 'Ingresar', true);
  await expect(screen(app)).toHaveAttribute('data-screen', 'B-05');
  await nav(app, 'Perfil');
  await tap(app, /Solicitudes de compra/);
  await expect(screen(app)).toHaveAttribute('data-screen', 'B-17');
  expect(await page.evaluate(() => (window as any).__mesagriBack())).toBe(true);
  await expect(screen(app)).toHaveAttribute('data-screen', 'B-20');
  expect(await page.evaluate(async () => ((await navigator.serviceWorker?.getRegistrations?.()) ?? []).length)).toBe(0);
  // al abrir otra vez la app sigue con su sesión, donde la dejó (y recibe su copia del mundo con ella)
  await page.reload();
  await expect(screen(page.locator('.ph-in'))).toHaveAttribute('data-screen', 'B-20', { timeout: 20_000 });
  expect(errors).toEqual([]);
  await ctx.close();
});

test('APK: la primera vez pide juntos los permisos que usa el perfil (cámara, micrófono y ubicación) y se revisan en Perfil', async ({ browser }) => {
  const ctx = await browser.newContext({ userAgent: APK_UA, viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(() => {
    const w = window as any;
    const st: Record<string, string> = { camera: 'prompt', microphone: 'prompt', location: 'denied' };
    w.__asked = [];
    w.MesagriAndroid = {
      server: () => location.origin, canSpeak: () => false, speak: () => {}, stopSpeaking: () => {}, listen: () => {}, saveFile: () => {}, goOnline: () => {}, openOffline: () => {}, setServer: () => true,
      permissions: () => JSON.stringify(st),
      // Android: la persona permite cámara y micrófono; la ubicación ya la había negado dos veces (bloqueada)
      askPermissions: (names: string) => { w.__asked.push(names); for (const n of names.split(',')) st[n] = n === 'location' ? 'blocked' : 'granted'; setTimeout(() => w.__mesagriPermissions?.(JSON.stringify(st)), 20); },
      openSettings: () => { w.__asked.push('ajustes'); },
    };
  });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
  await page.goto(BASE + '/');
  const app = page.locator('.ph-in');
  await expect(screen(app)).toHaveAttribute('data-screen', 'A-01', { timeout: 20_000 });
  await tap(app, /Ya tengo cuenta/);
  await app.getByRole('button', { name: 'Agricultor', exact: true }).click();
  await tap(app, /Ver cuentas de prueba/);
  await app.getByRole('button', { name: /Wilber Huamaní/ }).first().click();
  await tap(app, 'Ingresar', true);
  await expect(screen(app)).toHaveAttribute('data-screen', 'A-08');
  const sheet = page.getByRole('dialog').filter({ hasText: 'Para que Mesagri funcione bien' });
  await expect(sheet).toBeVisible();
  for (const t of ['Cámara', 'Micrófono', 'Ubicación', 'Fotos de tu cosecha', 'Publicar tu cosecha hablando', 'Marcar dónde está tu chacra']) await expect(sheet).toContainText(t);
  await sheet.getByRole('button', { name: 'Permitir todo' }).click();
  await expect(sheet.getByText('Permitido')).toHaveCount(2);
  await expect(sheet).toContainText('Bloqueado');
  await sheet.getByRole('button', { name: 'Abrir ajustes del celular' }).click();
  expect(await page.evaluate(() => (window as any).__asked)).toEqual(['camera,microphone,location', 'ajustes']);
  await sheet.getByRole('button', { name: 'Ahora no' }).click();
  await expect(sheet).toHaveCount(0);
  // ya no aparece sola: se revisa en Perfil → Permisos de la app
  await page.reload();
  await expect(screen(page.locator('.ph-in'))).toHaveAttribute('data-screen', 'A-08', { timeout: 20_000 });
  await page.waitForTimeout(1200);
  await expect(page.getByText('Para que Mesagri funcione bien')).toHaveCount(0);
  const f = page.locator('.ph-in');
  await nav(f, 'Perfil');
  await tap(f, /Permisos de la app/);
  await expect(page.getByRole('dialog').filter({ hasText: 'Lo que Mesagri puede usar de tu celular' })).toBeVisible();
  expect(errors).toEqual([]);
  await ctx.close();
});
