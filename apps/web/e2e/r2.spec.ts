/*
 * Funciones que antes eran de la versión 2 y ya funcionan en el MVP: solicitudes de compra con ofertas
 * (RF-ORD-09), pedidos programados del plan Pro (RF-ORD-10), equipo de la MYPE con permisos (B-23)
 * y quién publica por el agricultor (A-28). Cada prueba falla si la página registra errores en la consola.
 */
import { test, expect } from '@playwright/test';
import { start, phone, screen, tap, nav, persona } from './util';

test('solicitud de compra: la MYPE pide, el agricultor ofrece su precio, la MYPE acepta y el pedido le llega', async ({ page }) => {
  const errors = await start(page);
  const f = phone(page, 0), b = phone(page, 1);
  // Doña Charo pide 20 kg de papa amarilla, hasta S/ 3 por kilo
  await nav(b, 'Pedidos');
  await tap(b, /^Solicitudes de compra/);
  await expect(screen(b)).toHaveAttribute('data-screen', 'B-17');
  await tap(b, 'Nueva solicitud');
  const sheet = b.getByRole('dialog');
  await sheet.getByLabel('Producto').selectOption({ label: 'Papa amarilla' });
  await sheet.getByLabel('Kilos').fill('20');
  await sheet.getByLabel('Precio máximo por kilo').fill('3');
  await sheet.getByRole('button', { name: 'Publicar solicitud' }).click();
  await expect(screen(b)).toHaveAttribute('data-screen', 'B-17');
  await expect(b.getByText('Recibe ofertas').first()).toBeVisible();

  // Wilber la ve en «Pedidos» y ofrece su precio
  await nav(f, 'Pedidos');
  await tap(f, /^Solicitudes de compra/);
  await expect(screen(f)).toHaveAttribute('data-screen', 'A-27');
  await f.getByRole('button', { name: /^Papa amarilla, 20 kg/ }).first().click();
  const offer = f.getByRole('dialog');
  await offer.getByLabel('Precio por kilo').fill('2,80');
  await offer.getByLabel('Kilos').fill('20');
  await offer.getByRole('button', { name: 'Enviar oferta' }).click();
  await expect(f.getByRole('dialog')).toHaveCount(0);

  // Doña Charo ve la oferta en vivo y la acepta: se arma el pedido
  await expect(b.getByText('Wilber Huamaní').first()).toBeVisible();
  await b.getByRole('button', { name: 'Aceptar', exact: true }).first().click();
  await b.getByRole('dialog').getByRole('button', { name: 'Aceptar y hacer el pedido' }).click();
  await expect(screen(b)).toHaveAttribute('data-screen', 'B-14');

  // A Wilber le llega como pedido nuevo, marcado como venta por solicitud
  await nav(f, 'Pedidos');
  await f.getByRole('tab', { name: /Nuevos/ }).click();
  await f.locator('.card').filter({ hasText: 'Los Geranios' }).getByRole('button', { name: 'Ver', exact: true }).first().click();
  await expect(screen(f)).toHaveAttribute('data-screen', 'A-13');
  await expect(f.getByText(/Venta por solicitud/).first()).toBeVisible();
  await tap(f, 'Aceptar pedido');
  expect(errors).toEqual([]);
});

test('pedido programado (plan Pro): el pedido armado se aprueba y llega a cada agricultor', async ({ page }) => {
  const errors = await start(page);
  const f = phone(page, 0), b = phone(page, 1);
  await persona(page, 1, /Andrés/);
  await expect(screen(b)).toHaveAttribute('data-screen', 'B-05');
  await tap(b, /Pedido programado por aprobar/);
  await expect(screen(b)).toHaveAttribute('data-screen', 'B-22');
  await expect(b.getByText('Por aprobar', { exact: true }).first()).toBeVisible();
  await tap(b, 'Aprobar y pedir');
  await expect(screen(b)).toHaveAttribute('data-screen', 'B-13');
  // Wilber recibe el pedido del Hotel Los Andes
  await nav(f, 'Pedidos');
  await f.getByRole('tab', { name: /Nuevos/ }).click();
  await expect(f.locator('.card').filter({ hasText: 'Hotel Los Andes' }).first()).toBeVisible();
  // el programado queda listo para la próxima entrega
  await nav(b, 'Pedidos');
  await tap(b, /^Pedidos programados/);
  await expect(b.getByText(/Próxima entrega/).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('equipo de la MYPE: el titular invita con permisos y quien solo pide no puede aprobar', async ({ page }) => {
  const errors = await start(page);
  const b = phone(page, 1);
  await persona(page, 1, /Andrés/);
  await nav(b, 'Perfil');
  await tap(b, /Equipo y locales/);
  await expect(screen(b)).toHaveAttribute('data-screen', 'B-23');
  await expect(b.getByText(/3 de 5 usuarios/i).first()).toBeVisible();
  await tap(b, 'Invitar a alguien');
  const sheet = b.getByRole('dialog');
  await sheet.getByLabel('Nombre completo').fill('Kevin Torres Arias');
  await sheet.getByLabel('Celular').fill('951357246');
  await sheet.getByRole('button', { name: 'Invitar', exact: true }).click();
  await expect(b.getByText('Kevin Torres Arias').first()).toBeVisible();
  await expect(b.getByText(/4 de 5 usuarios/i).first()).toBeVisible();

  // Rosa (cocina) solo hace pedidos: ve el pedido programado pero no lo puede aprobar
  await persona(page, 1, /Rosa · cocina/);
  await expect(screen(b)).toHaveAttribute('data-screen', 'B-05');
  await expect(b.getByText(/Hotel Los Andes/).first()).toBeVisible();
  await nav(b, 'Pedidos');
  await tap(b, /^Pedidos programados/);
  await b.locator('.card').filter({ hasText: 'Por aprobar' }).first().click();
  await expect(b.getByRole('button', { name: 'Aprobar y pedir' })).toBeDisabled();
  expect(errors).toEqual([]);
});

test('quién publica por el agricultor: Nayeli entra con su celular y atiende la cuenta de su papá', async ({ page }) => {
  const errors = await start(page);
  const f = phone(page, 0);
  await persona(page, 0, /Nayeli/);
  await expect(screen(f)).toHaveAttribute('data-screen', 'A-08');
  await expect(f.getByText(/Ayudas a/).first()).toBeVisible();
  await expect(f.getByText(/Wilber Huamaní/).first()).toBeVisible();
  // lo que es solo del titular (equipo, cuenta de cobro) no se puede cambiar
  await nav(f, 'Perfil');
  await tap(f, /Quién puede publicar por mí/);
  await expect(screen(f)).toHaveAttribute('data-screen', 'A-28');
  await expect(f.getByRole('button', { name: 'Dar permiso a otra persona' })).toHaveCount(0);
  expect(errors).toEqual([]);
});
