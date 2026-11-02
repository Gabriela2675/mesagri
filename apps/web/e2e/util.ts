/* Ayudas comunes de las pruebas de punta a punta: abrir la demo y moverse por sus celulares y el panel. */
import { expect, type Page, type Locator } from '@playwright/test';
export const BASE = process.env.MESAGRI_WEB ?? 'http://localhost:3000';
/** Pruebas contra la versión autónoma (APK y app instalable): todo corre en el navegador, sin servidor. */
export const LOCAL_MODE = !!process.env.MESAGRI_LOCAL;
/** Servidor con clave del equipo (como en la nube): el escenario y las herramientas de la demo la piden. */
export const TEAM_KEY = process.env.MESAGRI_TEAM_KEY ?? '';
export const teamHeaders = (): Record<string, string> => (TEAM_KEY ? { 'x-team-key': TEAM_KEY } : {});
/** El navegador de quien presenta ya tiene guardada la clave del equipo. */
export async function rememberTeamKey(target: Page | import('@playwright/test').BrowserContext) {
  if (TEAM_KEY) await target.addInitScript((k: string) => { try { localStorage.setItem('mesagri.team', k); } catch { /* sin almacenamiento */ } }, TEAM_KEY);
}

/** Abre la demo de varios celulares (/demo) limpia y junta los errores de la consola (cada prueba exige cero). */
export async function start(page: Page, w = 1500, h = 960) {
  const errors: string[] = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
  await page.setViewportSize({ width: w, height: h });
  // cada prueba empieza con los datos de ejemplo (reinicio en MySQL; en la versión autónoma, cada
  // prueba abre un navegador nuevo y el celular arma sus propios datos de ejemplo)
  if (!LOCAL_MODE) {
    const r = await page.request.post(BASE + '/api/v1/demo/reset', { data: {}, headers: teamHeaders() });
    expect(r.ok()).toBe(true);
    await rememberTeamKey(page);
  }
  await page.goto(BASE + (LOCAL_MODE ? '/index.html?modo=demo' : '/demo'));
  await expect(page.locator('[data-screen]').first()).toBeVisible();
  return errors;
}
export const phone = (page: Page, n: number) => page.locator('.slot').nth(n).locator('.ph-in');
export const screen = (loc: Locator) => loc.locator('[data-screen]').first();
export async function tap(loc: Locator, name: string | RegExp, exact = false) {
  const b = loc.getByRole('button', { name, exact }).first();
  await b.scrollIntoViewIfNeeded();
  await b.click();
}
export async function nav(loc: Locator, label: string) { await loc.locator('nav.nav').getByRole('button', { name: label }).click(); }
export async function persona(page: Page, n: number, label: RegExp) {
  await page.locator('.slot').nth(n).locator('.pick').click();
  await page.getByRole('dialog').getByRole('button', { name: label }).first().click();
}
export async function advance(page: Page, label: string) {
  await page.getByRole('button', { name: 'Adelantar' }).click();
  await page.getByRole('dialog').getByRole('button', { name: label }).first().click();
  const close = page.getByRole('dialog').getByRole('button', { name: 'Cerrar' });
  if (await close.count()) await close.first().click();
}
export async function codeOf(loc: Locator) { return (await loc.locator('.code').first().innerText()).replace(/\D/g, ''); }

/** Pasa al panel web; con `who`, cierra la sesión e ingresa como esa persona del equipo (doble factor de demo). */
export async function webPanel(page: Page, who?: RegExp) {
  await page.getByRole('tab', { name: /Panel web/ }).click();
  const w = page.locator('.ph.web .ph-in');
  await expect(screen(w)).toBeVisible();
  if (who) {
    const out = w.getByRole('button', { name: 'Cerrar sesión' });
    if (await out.count()) await out.first().click();
    await expect(screen(w)).toHaveAttribute('data-screen', 'W-01');
    await w.locator('.wdemo').getByRole('button', { name: who }).first().click();
    await w.getByRole('button', { name: 'Ingresar', exact: true }).click();
    await expect(screen(w)).not.toHaveAttribute('data-screen', 'W-01');
  }
  return w;
}
