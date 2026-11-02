/*
 * Código por WhatsApp sin costo: la persona toca «Abrir WhatsApp», envía el mensaje listo y Mesagri
 * le responde con su código. Corre con un servidor configurado contra un «Meta» de mentira:
 *   MESAGRI_WA_MOCK=http://127.0.0.1:3999 (guarda lo que el servidor manda en /__sent)
 *   MESAGRI_WA_SECRET=... (el WHATSAPP_APP_SECRET del servidor, para firmar los avisos)
 */
import { test, expect, type Page } from '@playwright/test';
import crypto from 'node:crypto';
import { BASE, LOCAL_MODE, screen, tap, teamHeaders } from './util';

const MOCK = process.env.MESAGRI_WA_MOCK ?? '';
const SECRET = process.env.MESAGRI_WA_SECRET ?? '';
test.skip(LOCAL_MODE || !MOCK, 'Con el servidor y WhatsApp de prueba (MESAGRI_WA_MOCK)');

const API = BASE + '/api/v1';

/** La persona envía el mensaje desde su WhatsApp: Meta se lo avisa al servidor. */
async function sendFromWhatsApp(page: Page, from: string, text: string) {
  const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: 'WABA', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: 'PHONE123' }, contacts: [{ wa_id: from, profile: { name: 'Prueba' } }], messages: [{ id: 'wamid.e2e.' + crypto.randomUUID(), from, timestamp: '1', type: 'text', text: { body: text } }] } }] }] });
  const sig = 'sha256=' + crypto.createHmac('sha256', SECRET).update(body).digest('hex');
  const r = await page.request.post(API + '/whatsapp/webhook', { headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sig }, data: body });
  expect(r.ok()).toBe(true);
}
async function codeSentTo(page: Page, to: string, nth = 0): Promise<string> {
  let code = '';
  await expect.poll(async () => {
    const list = (await (await page.request.get(MOCK + '/__sent')).json()) as { to: string; body: string }[];
    const m = list.filter(x => x.to === to)[nth];
    code = m ? (/\*(\d{6})\*/.exec(m.body)?.[1] ?? '') : '';
    return code;
  }, { timeout: 8000 }).toMatch(/^\d{6}$/);
  return code;
}

test.beforeEach(async ({ request }) => {
  expect((await request.post(API + '/demo/reset', { data: {}, headers: teamHeaders() })).ok()).toBe(true);
});

test('registro e ingreso con el código que Mesagri responde por WhatsApp', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const opened: string[] = [];
  await page.exposeFunction('__opened', (u: string) => { opened.push(u); });
  await page.addInitScript(() => { window.open = ((u: string) => { (window as any).__opened(String(u)); return {} as Window; }) as any; });
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(BASE + '/');
  const app = page.locator('.ph-in');
  await expect(screen(app)).toHaveAttribute('data-screen', 'A-01', { timeout: 20_000 });
  // registro de una agricultora con su celular
  await tap(app, 'Continuar', true);
  await app.getByRole('button', { name: 'Soy agricultor' }).click();
  await expect(screen(app)).toHaveAttribute('data-screen', 'A-02');
  const phoneNo = '93' + String(Date.now()).slice(-7);
  await app.getByLabel('Número de celular').fill(phoneNo);
  await tap(app, 'Enviar código');
  await expect(screen(app)).toHaveAttribute('data-screen', 'A-03');
  const card = app.getByRole('region', { name: 'Pedir el código por WhatsApp' });
  await expect(card).toContainText('+51900000001');
  await card.getByRole('button', { name: 'Abrir WhatsApp' }).click();
  await expect.poll(() => opened.at(-1) ?? '').toMatch(/^https:\/\/wa\.me\/51900000001\?text=Hola%20Mesagri%2C%20quiero%20mi%20c%C3%B3digo%20para%20crear%20mi%20cuenta/);
  // la persona envía el mensaje: le llega el código y lo escribe en la app
  await sendFromWhatsApp(page, '51' + phoneNo, 'Hola Mesagri, quiero mi código para crear mi cuenta');
  const code = await codeSentTo(page, '51' + phoneNo);
  await app.getByLabel('Dígito 1').fill(code);
  await tap(app, 'Verificar', true);
  await expect(screen(app)).toHaveAttribute('data-screen', 'A-04');
  expect(errors).toEqual([]);
  await ctx.close();
});

test('ingreso de una cuenta de prueba: en pantalla para el público', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(BASE + '/');
  const app = page.locator('.ph-in');
  await expect(screen(app)).toHaveAttribute('data-screen', 'A-01', { timeout: 20_000 });
  await tap(app, /Ya tengo cuenta/);
  await app.getByRole('button', { name: 'Agricultor', exact: true }).click();
  await tap(app, /Ver cuentas de prueba/);
  await app.getByRole('button', { name: /Wilber Huamaní/ }).first().click();
  await expect(app.getByLabel('Código de acceso')).toHaveValue(/^\d{6}$/);
  await expect(app.getByRole('region', { name: 'Pedir el código por WhatsApp' })).toHaveCount(0);
  await tap(app, 'Ingresar', true);
  await expect(screen(app)).toHaveAttribute('data-screen', 'A-08');
  await ctx.close();
});
