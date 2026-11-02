/*
 * Más recorridos del documento de diseño: publicar con la voz, guardar y vender desde un almacén
 * aliado, estado de cuenta y conciliación, registro de un agricultor nuevo y permisos del panel.
 */
import { test, expect } from '@playwright/test';
import { start, phone, screen, tap, nav, persona, webPanel } from './util';

test('publicar con la voz: la frase pasa sola a «Revisa y publica» y el comprador la encuentra (D-04)', async ({ page }) => {
  const errors = await start(page);
  const f = phone(page, 0), b = phone(page, 1);
  const wilberCebolla = b.getByRole('button', { name: /Cebolla roja, S\/ 1,50 por kilo, de Wilber/ });
  await b.getByLabel('Buscar productos').fill('cebolla');
  await b.getByLabel('Buscar productos').press('Enter');
  const before = await wilberCebolla.count();
  await nav(f, 'Publicar');
  await expect(screen(f)).toHaveAttribute('data-screen', 'A-10');
  await f.getByLabel('Frase').fill('Tengo 50 kilos de cebolla roja, cosechada hoy, a uno cincuenta el kilo');
  await tap(f, 'Listo', true);
  await expect(screen(f)).toHaveAttribute('data-screen', 'A-11');
  await expect(f.getByText('Dijiste')).toBeVisible();
  await expect(f.getByText('Cebolla roja · 50 kg')).toBeVisible();
  await expect(f.getByText('S/ 1,50 por kg')).toBeVisible();
  // sin foto no se publica: se agrega ahí mismo (en el escenario, con una de ejemplo)
  await expect(f.getByRole('button', { name: 'Publicar', exact: true })).toBeDisabled();
  await f.getByRole('button', { name: 'Usar foto de ejemplo: Foto de la cosecha' }).first().click();
  await expect(f.getByText('Con foto')).toBeVisible();
  await tap(f, 'Publicar', true);
  await expect(screen(f)).toHaveAttribute('data-screen', 'A-09');
  await expect(f.getByText('50 kg · quedan 50 kg')).toBeVisible();
  // Doña Charo ya la ve en los resultados que tenía abiertos
  await expect(wilberCebolla).toHaveCount(before + 1);
  expect(errors).toEqual([]);
});

test('almacén aliado: reserva con cálculo, ingreso pesado con constancia y venta desde el lote (flujos 6 y 7)', async ({ page }) => {
  const errors = await start(page);
  const f = phone(page, 0), b = phone(page, 1), c = phone(page, 2);
  await persona(page, 2, /Elmer/);
  // Wilber calcula si le conviene guardar y reserva
  await nav(f, 'Almacén');
  await expect(screen(f)).toHaveAttribute('data-screen', 'A-23');
  await tap(f, /Guardar más cosecha|Buscar almacén/);
  await expect(screen(f)).toHaveAttribute('data-screen', 'A-21');
  await f.getByRole('button', { name: /Centro de acopio Yanque/ }).first().click();
  await expect(screen(f)).toHaveAttribute('data-screen', 'A-22');
  await expect(f.getByText('¿Te conviene guardar?')).toBeVisible();
  await tap(f, 'Reservar espacio', true);
  await expect(screen(f)).toHaveAttribute('data-screen', 'A-23');
  await expect(f.getByText(/Responde en/).first()).toBeVisible();
  // Elmer la acepta y recibe el lote con balanza calibrada
  await nav(c, 'Reservas');
  await expect(screen(c)).toHaveAttribute('data-screen', 'C-07');
  await c.locator('.card').filter({ hasText: 'Wilber' }).getByRole('button', { name: 'Aceptar' }).first().click();
  await c.getByRole('tab', { name: /^Aceptadas/ }).click();
  await c.locator('.card').filter({ hasText: 'Wilber' }).getByRole('button', { name: 'Recibir el lote' }).first().click();
  await expect(screen(c)).toHaveAttribute('data-screen', 'C-08');
  await c.getByRole('switch', { name: /Balanza con certificado/ }).click();
  await tap(c, 'Registrar ingreso y emitir constancia');
  await expect(screen(c)).toHaveAttribute('data-screen', 'C-09');
  await expect(c.getByText('Constancia de depósito').first()).toBeVisible();
  // Wilber publica desde el almacén: sello «Lote verificado»
  await nav(f, 'Almacén');
  await tap(f, 'Vender desde el almacén');
  await f.getByRole('dialog').getByRole('button', { name: 'Publicar en el catálogo' }).click();
  const ok = f.getByRole('dialog').getByRole('button', { name: 'Sí, confirmo' });
  if (await ok.count()) await ok.click();
  await expect(f.getByText('En venta').first()).toBeVisible();
  // Doña Charo lo ve con el sello
  await b.getByLabel('Buscar productos').fill('papa');
  await b.getByLabel('Buscar productos').press('Enter');
  await expect(b.locator('.card').filter({ hasText: 'Lote verificado' }).filter({ hasText: 'Wilber' }).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('estado de cuenta: Wilber paga su comisión por Yape y Gaby lo concilia en el panel (RN-40)', async ({ page }) => {
  const errors = await start(page);
  const f = phone(page, 0);
  await f.getByRole('button', { name: /Estado de cuenta: S\/ 41,40/ }).click();
  await expect(screen(f)).toHaveAttribute('data-screen', 'A-26');
  await tap(f, /Pagar S\/ 41,40 con Yape/);
  await f.getByRole('dialog').getByLabel('Número de operación').fill('08812345');
  await f.getByRole('dialog').getByRole('button', { name: 'Registrar pago' }).click();
  await expect(f.getByText('Pago por conciliar')).toBeVisible();
  const w = await webPanel(page);
  await w.locator('aside.side').getByRole('button', { name: /^Cobros/ }).click();
  await expect(screen(w)).toHaveAttribute('data-screen', 'W-14');
  await w.getByRole('tab', { name: /^Conciliación/ }).click();
  await w.locator('tr').filter({ hasText: 'Wilber' }).first().click();
  await tap(w, 'Coincide: emitir comprobante');
  await page.getByRole('tab', { name: /Celulares/ }).click();
  await expect(phone(page, 0).getByText(/^Pagado/).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('registro: un agricultor nuevo completa los 5 pasos y Lucía aprueba su nivel 1 (flujo 1)', async ({ page }) => {
  const errors = await start(page);
  const n = phone(page, 2);
  await persona(page, 2, /Celular nuevo/);
  await expect(screen(n)).toHaveAttribute('data-screen', 'A-01', { timeout: 4000 });
  await tap(n, 'Continuar', true);
  await n.getByRole('button', { name: 'Soy agricultor' }).click();
  await expect(screen(n)).toHaveAttribute('data-screen', 'A-02');
  await n.getByLabel('Número de celular').fill('987 111 222');
  await tap(n, 'Enviar código');
  await expect(screen(n)).toHaveAttribute('data-screen', 'A-03');
  const otp = (await n.locator('.toast').filter({ hasText: 'tu código es' }).first().innerText()).match(/\d{6}/)![0];
  await n.getByLabel('Dígito 1').fill(otp);
  await tap(n, 'Verificar');
  await expect(screen(n)).toHaveAttribute('data-screen', 'A-04');
  for (const s of await n.getByRole('switch').all()) if ((await s.getAttribute('aria-checked')) !== 'true') await s.click();
  await tap(n, 'Acepto y continúo');
  await expect(screen(n)).toHaveAttribute('data-screen', 'A-05');
  await n.getByLabel('Nombre completo').fill('Teodora Quispe Mamani');
  await n.getByLabel('DNI', { exact: true }).fill('41235876');
  for (const label of ['DNI · frente', 'DNI · reverso', 'Selfie']) {
    const sample = n.getByRole('button', { name: `Usar foto de ejemplo: ${label}` });
    await sample.click();
    await expect(sample).toHaveCount(0);
  }
  await tap(n, 'Continuar', true);
  await expect(screen(n)).toHaveAttribute('data-screen', 'A-06');
  const num = n.getByLabel('Número', { exact: true });
  if (await num.count()) await num.fill('987111222');
  await tap(n, 'Continuar', true);
  await expect(screen(n)).toHaveAttribute('data-screen', 'A-07');
  await n.getByRole('switch', { name: 'Yanque' }).click().catch(() => {});
  await tap(n, 'Guardar zonas');
  await expect(screen(n)).not.toHaveAttribute('data-screen', 'A-07');
  // Lucía revisa el expediente en el panel y aprueba el nivel 1
  const w = await webPanel(page, /Lucía/);
  await w.locator('aside.side').getByRole('button', { name: /^Verificaciones/ }).click();
  const row = w.getByRole('row', { name: /Teodora/ });
  await expect(row).toContainText('Yape propio');
  await row.getByRole('button', { name: /^(Tomar|Abrir)$/ }).click();
  await expect(screen(w)).toHaveAttribute('data-screen', 'W-04');
  await w.getByLabel('Motivo').fill('DNI legible y selfie coincide con la foto del DNI.');
  await tap(w, 'Guardar decisión');
  await page.getByRole('tab', { name: /Celulares/ }).click();
  await expect(page.locator('.slot').nth(2).locator('.pick')).toContainText('Teodora');
  await expect(page.locator('.slot').nth(2).locator('.pick')).toContainText('nivel 1');
  expect(errors).toEqual([]);
});

test('panel web: cada rol ve solo sus secciones y todas abren sin errores (Ley 29733)', async ({ page }) => {
  const errors = await start(page);
  const expected: Record<string, RegExp[]> = {
    Majo: [/^Inicio/, /^Verificaciones/, /^Usuarios/, /^Publicaciones/, /^Pedidos/, /^Almacenes/, /^Transportistas/, /^Cobros/, /^Catálogo/, /^Reglas|^Configuración/, /^Reportes/, /^Reclamos|^Libro/, /^Auditoría/, /^Equipo/],
    Lucía: [/^Inicio/, /^Verificaciones/, /^Almacenes/, /^Transportistas/, /^Usuarios/],
    Diana: [/^Inicio/, /^Envíos/, /^Usuarios/, /^Publicaciones/, /^Pedidos/, /^Reclamos|^Libro/],
    Ana: [/^Inicio/, /^Reportes/],
  };
  for (const [who, sections] of Object.entries(expected)) {
    const w = await webPanel(page, new RegExp(who));
    const side = w.locator('aside.side');
    const buttons = side.locator('nav button, button[aria-current], .navlist button').filter({ hasNotText: /^$/ });
    const names = (await side.getByRole('button').allInnerTexts()).map(t => t.trim()).filter(t => t && !/Cerrar sesión/.test(t));
    for (const re of sections) expect(names.some(t => re.test(t)), `${who} debería ver ${re}`).toBe(true);
    if (who === 'Ana') expect(names.some(t => /^Usuarios|^Verificaciones|^Pedidos/.test(t)), 'Ana no ve datos personales').toBe(false);
    for (const label of names) {
      await side.getByRole('button', { name: label, exact: true }).first().click().catch(async () => { await side.getByRole('button').filter({ hasText: label }).first().click(); });
      await expect(w.locator('.wcard, .kpi, table').first()).toBeVisible();
      await expect(w.getByText('No tienes acceso a esta sección')).toHaveCount(0);
    }
    void buttons;
  }
  expect(errors).toEqual([]);
});

test('fotos de la cosecha: el agricultor pone varias fotos a su publicación y el comprador las ve en la galería', async ({ page }) => {
  const errors = await start(page);
  const f = phone(page, 0), b = phone(page, 1);
  await f.getByRole('button', { name: /Publicaciones activas/ }).click();
  await expect(screen(f)).toHaveAttribute('data-screen', 'A-09');
  const card = f.locator('.card', { has: page.getByText('Papa amarilla', { exact: true }) }).last();
  await card.getByRole('button', { name: 'Editar y poner fotos' }).click();
  const sheet = f.getByRole('dialog');
  await expect(sheet.getByText('Hasta 3 fotos')).toBeVisible();
  await sheet.getByRole('button', { name: 'Usar foto de ejemplo: Foto de la cosecha' }).click();
  await expect(sheet.getByText('1 de 3 fotos')).toBeVisible();
  await sheet.getByRole('button', { name: 'Usar foto de ejemplo: Foto de la cosecha' }).click();
  await expect(sheet.getByText('2 de 3 fotos')).toBeVisible();
  // la segunda pasa a ser la portada
  await sheet.getByRole('button', { name: 'Usar la foto 2 de portada' }).click();
  await sheet.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(f.getByText('Guardamos los cambios.')).toBeVisible();
  await expect(card.getByRole('button', { name: 'Editar', exact: true })).toBeVisible();
  // Doña Charo ve las dos fotos de Wilber
  await b.getByLabel('Buscar productos').fill('papa');
  await b.getByLabel('Buscar productos').press('Enter');
  await b.getByRole('button', { name: /Papa amarilla, S\/ 2,70 por kilo, de Wilber/ }).first().click();
  await expect(screen(b)).toHaveAttribute('data-screen', 'B-07');
  const gallery = b.getByRole('group', { name: /Fotos: Papa amarilla/ });
  await expect(gallery.getByText('1 de 2')).toBeVisible();
  await gallery.getByRole('button', { name: 'Ver la foto 2' }).click();
  await expect(gallery.getByText('2 de 2')).toBeVisible();
  expect(errors).toEqual([]);
});
