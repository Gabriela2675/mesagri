/*
 * Con el servidor de verdad: la app (/) muestra la pantalla de inicio y cada quien ingresa según su tipo
 * de usuario; el equipo va al panel web (/panel). Dos celulares en navegadores distintos se ven en vivo
 * (Socket.IO), lo que hacen queda en MySQL, el panel entra con doble factor y lo hecho sin señal se envía al volver.
 */
import { test, expect, type Page, type Browser } from '@playwright/test';
import { BASE, screen, tap, nav, LOCAL_MODE, TEAM_KEY, teamHeaders, rememberTeamKey } from './util';

// estas pruebas son del servidor (MySQL, dos navegadores, panel con doble factor real)
test.skip(LOCAL_MODE, 'Solo con el servidor de Mesagri');

const API = BASE + '/api/v1';

async function openApp(browser: Browser, path = '/') {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  if (path !== '/') await rememberTeamKey(ctx);
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_INTERNET_DISCONNECTED|WebSocket/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
  await page.goto(BASE + path);
  await expect(page.locator('[data-screen]').first()).toBeVisible({ timeout: 15_000 });
  return { ctx, page, errors };
}

/** Ingresa como en la app final: inicio → «Ya tengo cuenta» → tipo de usuario → celular y código (la demo muestra el código porque no hay proveedor de SMS). */
async function loginAs(page: Page, type: string, label: RegExp) {
  const app = page.locator('.ph-in');
  await expect(screen(app)).toHaveAttribute('data-screen', 'A-01', { timeout: 10_000 });
  await tap(app, /Ya tengo cuenta/);
  await expect(screen(app)).toHaveAttribute('data-screen', 'LOGIN');
  await app.getByRole('button', { name: type, exact: true }).click();
  await expect(screen(app)).toHaveAttribute('data-screen', 'LOGIN-F');
  await tap(app, /Ver cuentas de prueba/);
  await app.getByRole('button', { name: label }).first().click();
  await expect(app.getByLabel('Código de acceso')).toHaveValue(/^\d{6}$/);
  await tap(app, 'Ingresar', true);
  await expect(screen(app)).not.toHaveAttribute('data-screen', 'LOGIN-F');
  return app;
}

async function token(page: Page, userId: string) {
  const r = await page.request.post(API + '/demo/sessions', { data: { userIds: [userId] }, headers: teamHeaders() });
  return (await r.json())[0].accessToken as string;
}

test.beforeEach(async ({ request }) => {
  expect((await request.post(API + '/demo/reset', { data: {}, headers: teamHeaders() })).ok()).toBe(true);
});

test('dos celulares en navegadores distintos: el pedido llega en vivo y queda guardado en MySQL', async ({ browser }) => {
  const charo = await openApp(browser);
  const wilber = await openApp(browser);
  const b = await loginAs(charo.page, 'Comprador (MYPE)', /Doña Charo/);
  const f = await loginAs(wilber.page, 'Agricultor', /Wilber Huamaní/);
  await expect(screen(b)).toHaveAttribute('data-screen', 'B-05');
  await expect(screen(f)).toHaveAttribute('data-screen', 'A-08');

  // Doña Charo compra papa de Wilber en su celular
  await b.getByLabel('Buscar productos').fill('papa');
  await b.getByLabel('Buscar productos').press('Enter');
  await b.locator('[role=button][aria-label*="Wilber"]').first().click();
  await tap(b, /^Agregar ·/);
  await nav(b, 'Carrito');
  await tap(b, 'Continuar', true);
  await tap(b, 'Continuar al pago');
  await tap(b, 'Confirmar pedido');
  await expect(screen(b)).toHaveAttribute('data-screen', 'B-13');

  // En el otro navegador, Wilber lo ve sin recargar (la pestaña «Nuevos» se llena sola) y lo acepta
  await nav(f, 'Pedidos');
  const nuevos = f.getByRole('tab', { name: /Nuevos/ }).first();
  await expect(nuevos).toContainText('1', { timeout: 8000 });
  await nuevos.click();
  await f.locator('.card').filter({ hasText: 'Los Geranios' }).getByRole('button', { name: 'Ver', exact: true }).first().click();
  await tap(f, 'Aceptar pedido');

  // Doña Charo ve el cambio de estado en vivo
  await expect(b.getByText(/Por pagar|Aceptado|Confirmado/).first()).toBeVisible({ timeout: 8000 });

  // Y la base de datos lo tiene (vista v_seller_inbox)
  const t = await token(wilber.page, 'u-wilber');
  await expect.poll(async () => {
    const r = await wilber.page.request.get(API + '/sub-orders?limit=50', { headers: { Authorization: 'Bearer ' + t } });
    const items = (await r.json()).items as any[];
    return items.filter(x => x.buyer_uuid === 'org-geranios' && x.status === 'CONFIRMED').length;
  }, { timeout: 8000 }).toBeGreaterThan(0);

  expect(charo.errors).toEqual([]);
  expect(wilber.errors).toEqual([]);
  await charo.ctx.close(); await wilber.ctx.close();
});

test('cada celular recibe solo lo que su perfil puede ver: el código de entrega lo ve el comprador y el agricultor solo lo comprueba', async ({ browser }) => {
  const charo = await openApp(browser);
  const wilber = await openApp(browser);
  const b = await loginAs(charo.page, 'Comprador (MYPE)', /Doña Charo/);
  const f = await loginAs(wilber.page, 'Agricultor', /Wilber Huamaní/);
  // lo que le llegó a cada celular desde el servidor
  const copy = async (page: Page) => page.evaluate(async () => {
    const r = await fetch('/api/v1/sync/snapshot', { headers: { Authorization: 'Bearer ' + JSON.parse(localStorage.getItem('mesagri.v2.sessions') ?? '{}').list?.at(-1)?.accessToken } });
    const j = await r.json();
    return { viewer: j.viewer, code: j.world.subOrders['so-c03'].deliveryCode as string, notifs: (j.world.notifs as any[]).map(n => n.to), audit: j.world.audit.length };
  });
  const cb = await copy(charo.page);
  const cf = await copy(wilber.page);
  expect([cb.viewer, cf.viewer]).toEqual(['user', 'user']);
  expect(cb.code).toMatch(/^\d{4}$/);
  expect(cf.code).toMatch(/^#/); // Wilber recibe solo la huella del código
  expect(new Set(cf.notifs)).toEqual(new Set(['org-wilber']));
  expect(cf.audit).toBe(0);
  // Doña Charo ve su código en el pedido en camino
  await nav(b, 'Pedidos');
  await b.locator('.card').filter({ hasText: 'Wilber' }).filter({ hasText: /En camino/ }).getByRole('button', { name: 'Seguir', exact: true }).first().click();
  const code = (await b.locator('.code').first().innerText()).replace(/\D/g, '');
  expect(code).toBe(cb.code);
  // Wilber registra la entrega: un código errado se rechaza al instante en su celular; el que le dictan, entrega
  await nav(f, 'Pedidos');
  await f.getByRole('tab', { name: /Por entregar/ }).first().click();
  await f.locator('.card').filter({ hasText: 'Los Geranios' }).getByRole('button', { name: 'Ver', exact: true }).first().click();
  await tap(f, 'Registrar la entrega');
  await expect(screen(f)).toHaveAttribute('data-screen', 'A-15');
  await f.getByLabel('Dígito 1').fill(String((Number(code) + 1) % 10000).padStart(4, '0'));
  await tap(f, 'Confirmar entrega');
  await expect(f.getByText(/El código no es correcto/)).toBeVisible();
  await expect(screen(f)).toHaveAttribute('data-screen', 'A-15');
  await f.getByLabel('Dígito 1').fill(code);
  await tap(f, 'Confirmar entrega');
  await expect(screen(f)).toHaveAttribute('data-screen', 'A-08');
  // a Doña Charo le llega en vivo: ya puede revisar y dar su conformidad
  await expect(b.getByRole('button', { name: /Revisa y confirma/ }).first()).toBeVisible({ timeout: 10_000 });
  expect(charo.errors).toEqual([]);
  expect(wilber.errors).toEqual([]);
  await charo.ctx.close(); await wilber.ctx.close();
});

test('sin señal de verdad: la acción espera en el celular y llega al servidor al volver (RNF-05)', async ({ browser }) => {
  const w = await openApp(browser);
  const f = await loginAs(w.page, 'Agricultor', /Wilber Huamaní/);
  // abre el chat del pedido en camino de Los Geranios
  await nav(f, 'Pedidos');
  await f.getByRole('tab', { name: /Por entregar/ }).first().click();
  await f.locator('.card').filter({ hasText: 'Los Geranios' }).getByRole('button', { name: 'Ver', exact: true }).first().click();
  await f.getByRole('button', { name: 'Mensaje', exact: true }).first().click();
  await expect(screen(f)).toHaveAttribute('data-screen', 'CHAT');
  // se va la señal
  await w.ctx.setOffline(true);
  await expect(w.page.getByText(/Sin conexión con el servidor/)).toBeVisible({ timeout: 15_000 });
  const text = 'Llego en 20 minutos, sin señal en la carretera';
  await f.getByLabel('Mensaje').fill(text);
  await f.getByRole('button', { name: 'Enviar', exact: true }).click();
  await expect(f.getByText(text)).toBeVisible();
  // vuelve la señal: la acción se envía sola y queda en MySQL
  await w.ctx.setOffline(false);
  const t = await token(w.page, 'u-wilber');
  const subs = ((await (await w.page.request.get(API + '/sub-orders?limit=100', { headers: { Authorization: 'Bearer ' + t } })).json()).items as any[]).filter(x => x.buyer_uuid === 'org-geranios');
  await expect.poll(async () => {
    for (const so of subs) {
      const r = await w.page.request.get(API + `/conversations/${so.sub_order_uuid}/messages`, { headers: { Authorization: 'Bearer ' + t } });
      if (((await r.json()).items as any[]).some(m => m.text === text)) return true;
    }
    return false;
  }, { timeout: 25_000 }).toBe(true);
  await expect(w.page.getByText(/Sin conexión con el servidor/)).toHaveCount(0);
  await w.ctx.close();
});

test('panel web en /panel: ingreso con contraseña y doble factor, y salir cierra la sesión', async ({ browser }) => {
  const p = await openApp(browser, '/panel');
  await p.page.setViewportSize({ width: 1440, height: 900 });
  const w = p.page.locator('.ph-in');
  await expect(screen(w)).toHaveAttribute('data-screen', 'W-01');
  // una clave errada no entra
  await w.getByLabel('Correo del equipo').fill('majo@mesagri.pe');
  await w.locator('input[type=password]').fill('clave-equivocada');
  await w.getByLabel(/Código de tu app/).fill('123456');
  await w.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await expect(w.getByRole('alert')).toContainText(/no son correctos/);
  // con la cuenta de demo (código vigente del doble factor) entra
  await w.locator('.wdemo').getByRole('button', { name: /Majo/ }).first().click();
  await w.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await expect(screen(w)).not.toHaveAttribute('data-screen', 'W-01');
  await w.getByRole('button', { name: 'Cerrar sesión' }).first().click();
  await expect(screen(w)).toHaveAttribute('data-screen', 'W-01');
  expect(p.errors).toEqual([]);
  await p.ctx.close();
});

test('reiniciar la demo desde otro navegador: todos vuelven a los datos de ejemplo', async ({ browser }) => {
  const a = await openApp(browser, '/demo');
  await a.page.setViewportSize({ width: 1500, height: 960 });
  await expect(a.page.locator('.slot').first()).toBeVisible();
  const before = await a.page.request.get(API + '/health');
  const ep = (await before.json()).epoch;
  await a.page.request.post(API + '/demo/reset', { data: {}, headers: teamHeaders() });
  await expect.poll(async () => (await (await a.page.request.get(API + '/health')).json()).epoch).not.toBe(ep);
  await expect(a.page.locator('.slot').first().locator('[data-screen]')).toBeVisible();
  expect(a.errors).toEqual([]);
  await a.ctx.close();
});

test('ingreso según el tipo de usuario: otro tipo avisa y deja entrar con el suyo; el equipo va al panel web', async ({ browser }) => {
  const a = await openApp(browser);
  const app = a.page.locator('.ph-in');
  await expect(screen(app)).toHaveAttribute('data-screen', 'A-01', { timeout: 10_000 });
  await tap(app, /Ya tengo cuenta/);
  // el celular de Wilber (agricultor) en «Comprador»: avisa y ofrece entrar como agricultor
  await app.getByRole('button', { name: 'Comprador (MYPE)', exact: true }).click();
  await app.getByLabel('Número de celular').fill('987654321');
  await tap(app, 'Pedir código', true);
  await expect(app.getByLabel('Código de acceso')).toHaveValue(/^\d{6}$/);
  await tap(app, 'Ingresar', true);
  await expect(app.getByText(/registrado como agricultor/)).toBeVisible();
  await tap(app, /Ingresar como agricultor/);
  await expect(screen(app)).toHaveAttribute('data-screen', 'LOGIN-F');
  await tap(app, 'Ingresar', true);
  await expect(screen(app)).toHaveAttribute('data-screen', 'A-08');
  // salir y entrar como equipo de Mesagri: la app lleva al panel web
  await nav(app, 'Perfil');
  await tap(app, /Cerrar sesión|Salir/);
  const ok = app.getByRole('dialog').getByRole('button', { name: /Cerrar sesión|Salir/ });
  if (await ok.count()) await ok.first().click();
  await expect(screen(app)).toHaveAttribute('data-screen', 'A-01');
  await tap(app, /Ya tengo cuenta/);
  await app.getByRole('button', { name: 'Equipo de Mesagri', exact: true }).click();
  await tap(app, /Abrir el panel web/);
  await expect(a.page).toHaveURL(/\/panel/);
  await expect(screen(a.page.locator('.ph-in'))).toHaveAttribute('data-screen', 'W-01');
  expect(a.errors).toEqual([]);
  await a.ctx.close();
});

test('en la nube, el escenario de la demo y las cuentas del panel piden la clave del equipo', async ({ browser }) => {
  test.skip(!TEAM_KEY, 'Solo con un servidor que tiene clave del equipo (MESAGRI_TEAM_KEY)');
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  await page.goto(BASE + '/demo');
  const gate = page.getByRole('dialog', { name: 'Clave del equipo' });
  await expect(gate).toBeVisible({ timeout: 15_000 });
  await gate.getByLabel('Clave del equipo').fill('no-es-la-clave');
  await gate.getByRole('button', { name: 'Entrar al escenario' }).click();
  await expect(gate.getByRole('alert')).toContainText(/no es la clave/);
  await gate.getByLabel('Clave del equipo').fill(TEAM_KEY);
  await gate.getByRole('button', { name: 'Entrar al escenario' }).click();
  await expect(page.locator('.slot').first().locator('[data-screen]')).toBeVisible({ timeout: 15_000 });
  // el panel, en otro navegador sin la clave: primero la pide y luego muestra las cuentas de prueba
  const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p2 = await ctx2.newPage();
  await p2.goto(BASE + '/panel');
  const w = p2.locator('.ph-in');
  await expect(screen(w)).toHaveAttribute('data-screen', 'W-01', { timeout: 15_000 });
  await w.getByLabel('Clave del equipo').fill(TEAM_KEY);
  await w.getByRole('button', { name: 'Ver cuentas' }).click();
  await w.locator('.wdemo').getByRole('button', { name: /Majo/ }).first().click();
  await w.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await expect(screen(w)).not.toHaveAttribute('data-screen', 'W-01');
  await ctx.close(); await ctx2.close();
});

test('API: el ingreso respeta el tipo de usuario (ROLE_MISMATCH) y manda al equipo al panel (USE_PANEL)', async ({ request }) => {
  const otp = async (phone: string) => (await (await request.post(API + '/auth/otp', { data: { phone, purpose: 'LOGIN' } })).json()).demoCode as string;
  // agricultor que elige «Comprador»: 409 y el código sigue sirviendo para entrar con su tipo
  const c1 = await otp('987654321');
  const r1 = await request.post(API + '/auth/login', { data: { phone: '987654321', code: c1, role: 'BUYER' } });
  expect(r1.status()).toBe(409);
  expect((await r1.json()).code).toBe('ROLE_MISMATCH');
  const r2 = await request.post(API + '/auth/login', { data: { phone: '987654321', code: c1, role: 'FARMER' } });
  expect(r2.ok()).toBe(true);
  expect((await r2.json()).role).toBe('FARMER');
});
