/*
 * Recorridos principales del MVP, de punta a punta y con varios celulares a la vez:
 * compra y pago directo, envío con transportista aliado, límite del plan, verificación en el panel,
 * sin señal, y la vista de celular. Cada prueba falla si la página registra errores en la consola.
 */
import { test, expect } from '@playwright/test';
import { start, phone, screen, tap, nav, persona, advance, codeOf, webPanel } from './util';

test('compra: pedido, aceptación con comisión a la vista, pago directo, entrega con código, conformidad y calificación', async ({ page }) => {
  const errors = await start(page);
  const f = phone(page, 0), b = phone(page, 1);
  // Doña Charo busca papa y la agrega
  await b.getByLabel('Buscar productos').fill('papa');
  await b.getByLabel('Buscar productos').press('Enter');
  await expect(screen(b)).toHaveAttribute('data-screen', 'B-06');
  await b.locator('[role=button][aria-label*="Wilber"]').first().click();
  await expect(screen(b)).toHaveAttribute('data-screen', 'B-07');
  await tap(b, /^Agregar ·/);
  await nav(b, 'Carrito');
  await tap(b, 'Continuar', true);
  await expect(screen(b)).toHaveAttribute('data-screen', 'B-10');
  await tap(b, 'Continuar al pago');
  await tap(b, 'Confirmar pedido');
  await expect(screen(b)).toHaveAttribute('data-screen', 'B-13');
  // Wilber ve la comisión de esa venta y acepta (D-01)
  await nav(f, 'Pedidos');
  await f.getByRole('button', { name: 'Ver', exact: true }).first().click();
  await expect(f.getByText('Tu comisión en esta venta')).toBeVisible();
  await tap(f, 'Aceptar pedido');
  // Doña Charo (nivel 1) paga antes de la entrega y sube la constancia
  await b.getByRole('button', { name: 'Pagar', exact: true }).first().click();
  await expect(screen(b)).toHaveAttribute('data-screen', 'B-12');
  await b.getByRole('button', { name: /Usar foto de ejemplo/ }).first().click();
  await b.getByLabel('Número de operación').fill('05123987');
  await tap(b, 'Enviar constancia');
  // Wilber confirma que le llegó, prepara y sale a entregar
  await tap(f, /Confirma el pago/);
  await tap(f, 'Sí, me llegó');
  await tap(f, 'Empezar a preparar');
  await tap(f, 'Marcar listo');
  await tap(f, 'Salir a entregar');
  await expect(screen(f)).toHaveAttribute('data-screen', 'A-15');
  // Código de entrega: un código errado no entrega (RN-58)
  await b.getByRole('button', { name: 'Seguir', exact: true }).first().click();
  const code = await codeOf(b);
  expect(code).toMatch(/^\d{4}$/);
  const wrong = String((Number(code) + 1) % 10000).padStart(4, '0');
  await f.getByLabel('Dígito 1').fill(wrong);
  await tap(f, 'Confirmar entrega');
  await expect(screen(f)).toHaveAttribute('data-screen', 'A-15');
  await f.getByLabel('Dígito 1').fill(code);
  await tap(f, 'Confirmar entrega');
  await expect(screen(f)).toHaveAttribute('data-screen', 'A-08');
  // Doña Charo da su conformidad y califica
  await tap(b, /Revisa y confirma/);
  await expect(screen(b)).toHaveAttribute('data-screen', 'B-15');
  await tap(b, 'Todo conforme');
  await expect(screen(b)).toHaveAttribute('data-screen', 'B-16');
  await tap(b, 'Enviar calificación');
  await expect(screen(b)).toHaveAttribute('data-screen', 'B-13');
  expect(errors).toEqual([]);
});

test('envío: oferta al transportista favorito, recojo con QR, flete directo y entrega con código', async ({ page }) => {
  const errors = await start(page);
  const h = phone(page, 0), a = phone(page, 1), j = phone(page, 2);
  await persona(page, 0, /Héctor/);
  await persona(page, 1, /Andrés/);
  // Don Héctor acepta el frejol del hotel: el envío se ofrece a Julio (favorito del hotel, RN-56)
  await nav(h, 'Pedidos');
  await h.getByRole('button', { name: 'Ver', exact: true }).first().click();
  await tap(h, 'Aceptar pedido');
  await j.getByRole('button', { name: /OFERTA NUEVA/ }).first().click();
  await expect(screen(j)).toHaveAttribute('data-screen', 'T-09');
  await expect(j.getByText('Tú recibes')).toBeVisible();
  await tap(j, 'Aceptar envío');
  await expect(screen(j)).toHaveAttribute('data-screen', 'T-10');
  // Al día siguiente: Héctor prepara; Julio recoge el arroz del molino y el frejol de la chacra
  await advance(page, '+1 día');
  await tap(h, 'Empezar a preparar');
  await tap(h, 'Marcar listo');
  await nav(j, 'Ruta');
  await expect(screen(j)).toHaveAttribute('data-screen', 'T-11');
  await tap(j, /Ir al primer recojo/);
  await expect(screen(j)).toHaveAttribute('data-screen', 'T-12');
  await tap(j, /Completar con el QR del agricultor/);
  await j.getByLabel('Guía del transportista').fill('V001-00045');
  await tap(j, 'Confirmar recojo');
  await expect(screen(j)).toHaveAttribute('data-screen', 'T-13');
  await nav(j, 'Ruta');
  await tap(j, /Ir al siguiente recojo/);
  await tap(j, /Completar con el QR del agricultor/);
  await j.getByLabel('Guía del transportista').fill('V001-00046');
  await tap(j, 'Confirmar recojo');
  // Llega al hotel con la primera entrega
  await tap(j, /Llegué a la entrega/);
  await expect(screen(j)).toHaveAttribute('data-screen', 'T-14');
  const envio = (await j.locator('.bar').first().innerText()).match(/ENV-\d+/)![0];
  // El hotel abre ese envío, paga el flete y ve su código
  await nav(a, 'Pedidos');
  let found = false;
  for (let i = 0; i < 4 && !found; i++) {
    await nav(a, 'Pedidos');
    const cards = a.getByRole('button', { name: 'Seguir', exact: true });
    if (i >= await cards.count()) break;
    await cards.nth(i).click();
    if (await a.getByRole('button', { name: 'Ver envío' }).count()) {
      await tap(a, 'Ver envío');
      if ((await a.locator('.bar').first().innerText()).includes(envio)) found = true;
    }
  }
  expect(found).toBe(true);
  await tap(a, /Recibir y pagar el flete|llegó: recibir/);
  await expect(screen(a)).toHaveAttribute('data-screen', 'B-32');
  await tap(a, 'Ya pagué: dar mi código');
  const code = await codeOf(a);
  await j.getByLabel('Dígito 1').fill(code);
  // Sin confirmar que cobró el flete no se cierra la entrega (RN-55)
  await tap(j, 'Confirmar entrega');
  await expect(j.getByRole('alert')).toContainText('Confirma que cobraste el flete');
  await j.getByRole('switch', { name: /Cobré/ }).click();
  await tap(j, 'Confirmar entrega');
  await expect(screen(j)).toHaveAttribute('data-screen', 'T-11');
  // El hotel da su conformidad, califica a Héctor y luego a Julio (RN-64)
  await tap(a, 'Da tu conformidad del producto');
  await expect(screen(a)).toHaveAttribute('data-screen', 'B-15');
  await tap(a, 'Todo conforme');
  await expect(screen(a)).toHaveAttribute('data-screen', 'B-16');
  await tap(a, 'Enviar calificación');
  await expect(screen(a)).toHaveAttribute('data-screen', 'B-33');
  await tap(a, 'Enviar calificación');
  await expect(screen(a)).toHaveAttribute('data-screen', 'B-13');
  expect(errors).toEqual([]);
});

test('plan Básico: al pasar S/ 2 500 en el mes ofrece Pro y deja comprar (RF-SUB-05)', async ({ page }) => {
  const errors = await start(page);
  const b = phone(page, 1);
  await b.getByLabel('Buscar productos').fill('frejol');
  await b.getByLabel('Buscar productos').press('Enter');
  await b.locator('[role=button][aria-label*="Héctor"]').first().click();
  await b.getByLabel('Cantidad').fill('150');
  await tap(b, /^Agregar ·/);
  await nav(b, 'Carrito');
  await tap(b, 'Continuar', true);
  await expect(b.getByText(/pasa el límite de tu plan Básico/)).toBeVisible();
  await tap(b, /Pasar a Pro y comprar/);
  await expect(screen(b)).toHaveAttribute('data-screen', 'B-10');
  await tap(b, 'Continuar al pago');
  await tap(b, 'Confirmar pedido');
  await expect(screen(b)).toHaveAttribute('data-screen', 'B-13');
  await nav(b, 'Perfil');
  await expect(b.locator('.card.sel').getByText('Pro', { exact: true })).toBeVisible();
  await expect(b.locator('.card.sel').getByText('Tu plan')).toBeVisible();
  await expect(page.locator('.slot').nth(1).locator('.pick')).toContainText('plan Pro');
  expect(errors).toEqual([]);
});

test('panel web: verificación aprueba el nivel 2 y la auditoría lo registra', async ({ page }) => {
  const errors = await start(page);
  const w = await webPanel(page);
  await w.locator('aside.side').getByRole('button', { name: /^Verificaciones/ }).click();
  await expect(screen(w)).toHaveAttribute('data-screen', 'W-03');
  await w.getByRole('row', { name: /Justina/ }).getByRole('button', { name: 'Abrir' }).click();
  await expect(screen(w)).toHaveAttribute('data-screen', 'W-04');
  await w.getByLabel('Motivo').fill('Padrón y chacra verificados. Cuenta de su hija con autorización firmada.');
  await tap(w, 'Guardar decisión');
  await w.locator('aside.side').getByRole('button', { name: /^Auditoría/ }).click();
  await expect(w.getByText(/DECISIÓN DE VERIFICACIÓN|Decisión de verificación/i).first()).toBeVisible();
  await expect(w.getByText(/Justina/).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('sin señal: lo hecho se guarda en el celular y se envía al volver la señal (RNF-05)', async ({ page }) => {
  const errors = await start(page);
  const f = phone(page, 0), b = phone(page, 1);
  const wifi = page.locator('.slot').nth(0).locator('.slothead .iconbtn');
  // Doña Charo pide papa a Wilber
  await b.getByLabel('Buscar productos').fill('papa');
  await b.getByLabel('Buscar productos').press('Enter');
  await b.locator('[role=button][aria-label*="Wilber"]').first().click();
  await tap(b, /^Agregar ·/);
  await nav(b, 'Carrito');
  await tap(b, 'Continuar', true);
  await tap(b, 'Continuar al pago');
  await tap(b, 'Confirmar pedido');
  await expect(b.getByRole('button', { name: 'Pagar', exact: true })).toHaveCount(0);
  // Wilber se queda sin señal en la chacra y acepta igual
  await wifi.click();
  await expect(wifi).toHaveAttribute('aria-label', 'Devolver la señal');
  await nav(f, 'Pedidos');
  await f.getByRole('button', { name: 'Ver', exact: true }).first().click();
  await tap(f, 'Aceptar pedido');
  await expect(f.locator('.offstrip')).toContainText('1 por enviar');
  await f.locator('.offstrip').click();
  await expect(f.getByRole('dialog').getByText(/POR ENVIAR \(1\)/)).toBeVisible();
  await f.getByRole('dialog').getByRole('button', { name: 'Entendido' }).click();
  // Mientras tanto Doña Charo aún no lo ve aceptado
  await page.waitForTimeout(400);
  await expect(b.getByRole('button', { name: 'Pagar', exact: true })).toHaveCount(0);
  // Vuelve la señal: se envía solo y a Doña Charo le aparece «Pagar»
  await wifi.click();
  await expect(wifi).toHaveAttribute('aria-label', 'Quitar la señal a este celular');
  await expect(b.getByRole('button', { name: 'Pagar', exact: true }).first()).toBeVisible();
  await expect(f.locator('.offstrip')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('celular 390 × 844: una sola columna, menú inferior visible y guía en el menú de la demo', async ({ page }) => {
  const errors = await start(page, 390, 844);
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(sw).toBeLessThanOrEqual(390);
  const tabs = page.locator('.sbar .stabs button');
  for (let i = 0; i < 3; i++) {
    await tabs.nth(i).click();
    const navBox = await page.locator('nav.nav').first().boundingBox();
    expect(navBox).not.toBeNull();
    expect(navBox!.y + navBox!.height).toBeLessThanOrEqual(844 + 1);
  }
  await page.getByRole('button', { name: 'Menú de la demo' }).click();
  await page.getByRole('button', { name: /Guía de prueba/ }).click();
  await expect(page.getByRole('complementary', { name: 'Guía de prueba' })).toBeVisible();
  expect(errors).toEqual([]);
});
