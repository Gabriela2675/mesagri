/*
 * Código por SMS desde el celular de Mesagri (SMS Gateway for Android). Corre con un servidor
 * configurado contra un «celular» de mentira que guarda los SMS en /__sms:
 *   MESAGRI_SMS_MOCK=http://127.0.0.1:3999
 */
import { test, expect, type Page } from '@playwright/test';
import { BASE, LOCAL_MODE, screen, tap, teamHeaders } from './util';

const MOCK = process.env.MESAGRI_SMS_MOCK ?? '';
test.skip(LOCAL_MODE || !MOCK, 'Con el servidor y SMS de prueba (MESAGRI_SMS_MOCK)');

const API = BASE + '/api/v1';
async function smsCode(page: Page, to: string, nth = 0): Promise<string> {
  let code = '';
  await expect.poll(async () => {
    const list = (await (await page.request.get(MOCK + '/__sms')).json()) as { to: string; text: string }[];
    const m = list.filter(x => x.to === '+51' + to)[nth];
    code = m ? (/es (\d{6})\./.exec(m.text)?.[1] ?? '') : '';
    return code;
  }, { timeout: 8000 }).toMatch(/^\d{6}$/);
  return code;
}

test.beforeEach(async ({ request }) => {
  expect((await request.post(API + '/demo/reset', { data: {}, headers: teamHeaders() })).ok()).toBe(true);
});

test('registro con el código que llega por SMS y, después, ingreso con otro SMS', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(BASE + '/');
  const app = page.locator('.ph-in');
  await expect(screen(app)).toHaveAttribute('data-screen', 'A-01', { timeout: 20_000 });
  await tap(app, 'Continuar', true);
  await app.getByRole('button', { name: 'Soy agricultor' }).click();
  const phoneNo = '94' + String(Date.now()).slice(-7);
  await app.getByLabel('Número de celular').fill(phoneNo);
  await tap(app, 'Enviar código');
  await expect(screen(app)).toHaveAttribute('data-screen', 'A-03');
  await expect(app.locator('.toast').filter({ hasText: 'Te enviamos un código por SMS' })).toBeVisible();
  await expect(app.getByRole('region', { name: 'Pedir el código por WhatsApp' })).toHaveCount(0);
  const code = await smsCode(page, phoneNo);
  await app.getByLabel('Dígito 1').fill(code);
  await tap(app, 'Verificar', true);
  await expect(screen(app)).toHaveAttribute('data-screen', 'A-04');
  expect(errors).toEqual([]);
  await ctx.close();
});
