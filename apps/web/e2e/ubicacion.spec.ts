/*
 * Dónde está la chacra: buscador como el de un mapa con los 109 distritos y los centros poblados del
 * INEI (funciona sin internet), GPS del celular, mapa del distrito y enlace a Google Maps.
 */
import { test, expect } from '@playwright/test';
import { start, phone, screen, tap, nav } from './util';

test('chacra nueva: se busca el lugar aunque se escriba mal, se marca con el GPS y queda en «Mis chacras»', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: -15.6502, longitude: -71.6655, accuracy: 12 });
  const errors = await start(page);
  const f = phone(page, 0);
  await nav(f, 'Perfil');
  await tap(f, /Mis chacras y zonas/);
  await f.getByRole('dialog').getByRole('button', { name: 'Mis chacras' }).click();
  await expect(screen(f)).toHaveAttribute('data-screen', 'A-16');
  // las chacras de ejemplo ya tienen su lugar
  await expect(f.locator('.card').filter({ hasText: 'Pampa Alta' })).toContainText('GPS del celular');
  await expect(f.locator('.card').filter({ hasText: 'Coporaque' })).toContainText('Solo el distrito');
  await tap(f, 'Agregar chacra');
  await f.getByLabel('Nombre de la chacra').fill('Chacra del río');
  // se escribe como suena: «pampajasi» encuentra Pampajashi (Yanque)
  const search = f.getByLabel('Buscar el lugar de la chacra');
  await search.fill('pampajasi');
  const option = f.getByRole('option', { name: /Pampajashi/ }).first();
  await expect(option).toContainText('Yanque, Caylloma');
  await option.click();
  const sel = f.getByRole('group', { name: 'Lugar de la chacra' });
  await expect(sel).toContainText('Pampajashi');
  await expect(sel).toContainText('Yanque · Caylloma');
  await expect(sel).toContainText('Existe en el registro de centros poblados del INEI');
  await expect(sel.getByRole('img', { name: /Mapa de Yanque/ })).toBeVisible();
  await expect(sel.getByRole('button', { name: /Ver en Google Maps/ })).toBeVisible();
  // un lugar que no existe no aparece
  await sel.getByRole('button', { name: 'Cambiar' }).click();
  await f.getByLabel('Buscar el lugar de la chacra').fill('xyzw qwerty');
  await expect(f.getByText(/No encontramos «xyzw qwerty» en Arequipa/)).toBeVisible();
  // con el GPS del celular
  await tap(f, 'Usar mi ubicación');
  await expect(sel).toContainText('Marcado con el GPS del celular (±12 m)');
  await expect(sel).toContainText('Caylloma');
  await f.getByLabel('Referencia para llegar').fill('Pasando el puente, portón azul');
  await f.getByLabel('Área en hectáreas').fill('1,2');
  await tap(f, 'Guardar chacra');
  const card = f.locator('.card').filter({ hasText: 'Chacra del río' });
  await expect(card).toContainText('GPS del celular');
  await expect(card).toContainText('Caylloma');
  // y se puede corregir después
  await card.getByRole('button', { name: /Corregir la ubicación/ }).click();
  await expect(screen(f)).toHaveAttribute('data-screen', 'A-16');
  await expect(f.getByLabel('Referencia para llegar')).toHaveValue('Pasando el puente, portón azul');
  await f.getByLabel('Referencia para llegar').fill('Pasando el puente colgante, portón azul');
  await tap(f, 'Guardar ubicación');
  await expect(f.getByText('Guardamos dónde está tu chacra.')).toBeVisible();
  expect(errors).toEqual([]);
});
