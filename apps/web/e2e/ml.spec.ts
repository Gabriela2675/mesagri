/*
 * Primer filtro con Machine Learning: el agricultor publica «cebolla roja» con una foto que no es
 * cebolla y el panel lo recomienda no publicar, con lo que ve el modelo y el porqué. Con servidor, el
 * modelo corre en el servidor; en la versión sin internet, en el navegador de la computadora.
 */
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { start, phone, screen, tap, nav, webPanel } from './util';

const MUESTRAS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/muestras');

test('una foto que no muestra el producto: el modelo la marca y el equipo pide cambios con el mensaje sugerido', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await start(page);
  const f = phone(page, 0);
  await nav(f, 'Publicar');
  await f.getByLabel('Frase').fill('Tengo 30 kilos de cebolla roja, cosechada hoy, a uno cincuenta el kilo');
  await tap(f, 'Listo', true);
  await expect(screen(f)).toHaveAttribute('data-screen', 'A-11');
  // la «foto de la cosecha» es la de un DNI, tomada con la cámara
  await f.locator('input[data-fuente="camara"]').first().setInputFiles(path.join(MUESTRAS, 'dni-frente.jpg'));
  await expect(f.getByText('Con foto')).toBeVisible();
  await tap(f, 'Publicar', true);
  await expect(screen(f)).toHaveAttribute('data-screen', 'A-09');
  const w = await webPanel(page, /Lucía/);
  await w.locator('aside.side').getByRole('button', { name: /^Publicaciones/ }).click();
  await expect(screen(w)).toHaveAttribute('data-screen', 'W-06');
  const row = w.getByRole('row', { name: /Cebolla roja · 30 kg.*Wilber/ }).first();
  await expect(row).toContainText('No publicar · ML', { timeout: 120_000, ignoreCase: true });
  await row.click();
  const card = w.locator('.wcard.mlcard');
  await expect(card).toBeVisible();
  await expect(card.getByText('No la dejes publicar: la foto no muestra cebolla roja.')).toBeVisible();
  await expect(card.getByText('Portada · No corresponde')).toBeVisible();
  await expect(card.getByText(/^Se ve un documento de identidad o tarjeta \(\d+ %\), no cebolla roja\.$/)).toBeVisible();
  await expect(card.locator('.mlbar').first()).toContainText('un documento de identidad o tarjeta');
  // aprobar pide confirmación; el equipo mejor pide cambios con el mensaje que sugiere el modelo
  await tap(w, 'Aprobar y publicar');
  await expect(page.getByRole('dialog').getByText(/El modelo de Machine Learning recomienda no publicarla/)).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: /Cancelar|No/ }).first().click();
  await card.getByRole('button', { name: 'Usar este mensaje' }).click();
  await expect(w.getByLabel('Mensaje al agricultor')).toHaveValue(/La foto 1 no muestra tu cebolla roja/);
  await tap(w, 'Pedir cambios');
  await expect(w.getByText(/Le pedimos los cambios al agricultor/)).toBeVisible();
  // probar el modelo con una foto suelta
  await tap(w, 'Probar el modelo');
  const t = w.locator('.wcard', { hasText: 'Probar el modelo con una foto' });
  await t.getByLabel('La publicación dice').selectOption('papa_blanca');
  await t.locator('input[type=file]').setInputFiles(path.join(MUESTRAS, 'rostro-frente.jpg'));
  await expect(t.getByText('No muestra papa blanca')).toBeVisible({ timeout: 60_000 });
  await expect(t.locator('.mlbar').first()).toContainText('una persona');
  expect(errors).toEqual([]);
});
