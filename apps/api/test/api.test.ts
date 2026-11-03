/*
 * El API completo contra MySQL real: autenticación (código, doble factor, refresco rotativo),
 * acciones por REST y por el canal de la demo, errores problem+json, archivos y tiempo real.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { io, type Socket } from 'socket.io-client';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import nodeHttp from 'node:http';
import crypto from 'node:crypto';

const DB = 'mesagri_test_api';
let app: INestApplication;
let http: any;
let base = '';

beforeAll(async () => {
  process.env.DB_NAME = DB;
  process.env.FILES_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mesagri-files-'));
  // Se usa lo compilado (vitest no emite los metadatos de los decoradores que Nest necesita)
  const dist = (p: string) => import(p as string);
  const { dropDatabase } = (await dist('../dist/db/migrate.js')) as typeof import('../src/db/migrate');
  await dropDatabase(DB);
  const { createApp } = (await dist('../dist/main.js')) as typeof import('../src/main');
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  http = app.getHttpServer();
  base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await app?.close();
});

const api = () => request(http);
const session = async (userId: string) => (await api().post('/api/v1/demo/sessions').send({ userIds: [userId] })).body[0].accessToken as string;

describe('API de Mesagri', () => {
  it('salud, documentación OpenAPI y la app web', async () => {
    const h = await api().get('/api/v1/health');
    expect(h.status).toBe(200);
    expect(h.body.db).toBe(true);
    // la versión del contrato y la compilación: con ellas la app y INICIAR detectan un servidor viejo abierto
    expect(h.body.protocol).toBe(3);
    expect(String(h.body.build)).toMatch(/^\d+$/);
    const snap = await api().get('/api/v1/sync/snapshot');
    expect(snap.body.protocol).toBe(3);
    expect(snap.body.world.requests).toBeDefined();
    const docs = await api().get('/api/docs-json');
    expect(docs.status).toBe(200);
    const paths = Object.keys(docs.body.paths);
    for (const p of ['/api/v1/auth/otp', '/api/v1/orders', '/api/v1/sub-orders/{id}/transition', '/api/v1/storage/bookings', '/api/v1/shipments/{id}/{step}', '/api/v1/admin/verification/queue', '/api/v1/billing/statements/{id}/pay']) expect(paths).toContain(p);
  });

  it('ingreso con código de un solo uso y errores claros', async () => {
    const otp = await api().post('/api/v1/auth/otp').send({ phone: '987654321', purpose: 'LOGIN' });
    expect(otp.status).toBe(200);
    expect(otp.body.demoCode).toMatch(/^\d{6}$/);
    const bad = await api().post('/api/v1/auth/login').send({ phone: '987654321', code: '000000' });
    expect(bad.status).toBe(422);
    expect(bad.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(bad.body.code).toBe('BAD_CODE');
    const ok = await api().post('/api/v1/auth/login').send({ phone: '987654321', code: otp.body.demoCode });
    expect(ok.status).toBe(200);
    expect(ok.body.userId).toBe('u-wilber');
    const me = await api().get('/api/v1/me').set('Authorization', 'Bearer ' + ok.body.session.accessToken);
    expect(me.body.organization.id).toBe('org-wilber');
    expect(me.body.user.phone).toBeUndefined();
    const reused = await api().post('/api/v1/auth/login').send({ phone: '987654321', code: otp.body.demoCode });
    expect(reused.status).toBe(422);
    const none = await api().post('/api/v1/auth/otp').send({ phone: '911111111', purpose: 'LOGIN' });
    expect(none.status).toBe(404);
  });

  it('ingreso según el tipo de usuario: otro tipo no gasta el código y el equipo va al panel', async () => {
    const otp = await api().post('/api/v1/auth/otp').send({ phone: '987654321', purpose: 'LOGIN' });
    const wrong = await api().post('/api/v1/auth/login').send({ phone: '987654321', code: otp.body.demoCode, role: 'BUYER' });
    expect(wrong.status).toBe(409);
    expect(wrong.body.code).toBe('ROLE_MISMATCH');
    expect(wrong.body.detail).toMatch(/agricultor/);
    expect(wrong.body.data.role).toBe('FARMER');
    const right = await api().post('/api/v1/auth/login').send({ phone: '987654321', code: otp.body.demoCode, role: 'FARMER' });
    expect(right.status).toBe(200);
    expect(right.body.role).toBe('FARMER');
    const team = await api().post('/api/v1/auth/otp').send({ phone: '900000001', purpose: 'LOGIN' });
    expect(team.status).toBe(200);
    const panel = await api().post('/api/v1/auth/login').send({ phone: '900000001', code: team.body.demoCode, role: 'ADMIN' });
    expect(panel.status).toBe(409);
    expect(panel.body.code).toBe('USE_PANEL');
    expect(panel.body.data.email).toBe('majo@mesagri.pe');
  });

  it('registro: código, permiso de 15 minutos y cuenta nueva con sesión', async () => {
    const phone = '933221100';
    const otp = await api().post('/api/v1/auth/otp').send({ phone, purpose: 'REGISTER' });
    const v = await api().post('/api/v1/auth/otp/verify').send({ phone, code: otp.body.demoCode });
    expect(v.body.ticket).toBeTruthy();
    const r = await api().post('/api/v1/auth/register').send({ ticket: v.body.ticket, event: { id: 'e-reg-api-1', p: { userId: 'u-api-1', orgId: 'org-api-1', role: 'FARMER', phone, name: 'Agricultora de Prueba', dni: '45678912', lang: 'es', org: { district: '040519' } } } });
    expect(r.status).toBe(201);
    expect(r.body.session.userId).toBe('u-api-1');
    const again = await api().post('/api/v1/auth/otp').send({ phone, purpose: 'REGISTER' });
    expect(again.status).toBe(409);
  });

  it('panel: contraseña Argon2id, doble factor TOTP y refresco rotativo con detección de reutilización', async () => {
    const team = (await api().get('/api/v1/demo/team')).body;
    const c = team.find((x: any) => x.userId === 'u-majo');
    const bad = await api().post('/api/v1/auth/admin/login').send({ email: c.email, password: c.password, code: '000000' });
    expect(bad.status).toBe(401);
    const ok = await api().post('/api/v1/auth/admin/login').send({ email: c.email, password: c.password, code: c.code });
    expect(ok.status).toBe(200);
    const r1 = await api().post('/api/v1/auth/refresh').send({ refreshToken: ok.body.session.refreshToken });
    expect(r1.status).toBe(200);
    const reuse = await api().post('/api/v1/auth/refresh').send({ refreshToken: ok.body.session.refreshToken });
    expect(reuse.body.code).toBe('SESSION_REUSED');
    const after = await api().post('/api/v1/auth/refresh').send({ refreshToken: r1.body.refreshToken });
    expect(after.status).toBe(401);
    const forbidden = await api().get('/api/v1/admin/audit-logs').set('Authorization', 'Bearer ' + (await session('u-wilber')));
    expect(forbidden.status).toBe(403);
    const audit = await api().get('/api/v1/admin/audit-logs?limit=5').set('Authorization', 'Bearer ' + ok.body.session.accessToken);
    expect(audit.status).toBe(200);
    expect(audit.body.items.length).toBeGreaterThan(0);
  });

  it('pedido por REST con Idempotency-Key, transición del agricultor y código de entrega solo para la MYPE', async () => {
    const elena = await session('u-elena');
    const wilber = await session('u-wilber');
    const body = { subs: [{ subOrderId: 'so-api-1', sellerOrgId: 'org-wilber', items: [{ listingId: 'l-w-papa', qty: 10 }], deliveryMode: 'FARMER', deliveryDate: Date.UTC(2026, 10, 5, 5), taxDoc: 'LIQUIDACION', payMethod: 'CASH' }] };
    const o1 = await api().post('/api/v1/orders').set('Authorization', 'Bearer ' + elena).set('Idempotency-Key', 'idem-order-api-1').send(body);
    expect(o1.status).toBe(201);
    const o2 = await api().post('/api/v1/orders').set('Authorization', 'Bearer ' + elena).set('Idempotency-Key', 'idem-order-api-1').send(body);
    expect(o2.body.seq).toBe(o1.body.seq);
    const notMine = await api().post('/api/v1/sub-orders/so-api-1/transition').set('Authorization', 'Bearer ' + elena).send({ action: 'accept' });
    expect(notMine.status).toBe(403);
    const acc = await api().post('/api/v1/sub-orders/so-api-1/transition').set('Authorization', 'Bearer ' + wilber).send({ action: 'accept' });
    expect(acc.status).toBe(201);
    const asBuyer = await api().get('/api/v1/sub-orders/so-api-1').set('Authorization', 'Bearer ' + elena);
    const asSeller = await api().get('/api/v1/sub-orders/so-api-1').set('Authorization', 'Bearer ' + wilber);
    expect(asBuyer.body.status).toBe('CONFIRMED');
    expect(asBuyer.body.deliveryCode).toMatch(/^\d{4}$/);
    expect(asSeller.body.deliveryCode).toBeUndefined();
    const inbox = await api().get('/api/v1/sub-orders?status=CONFIRMED').set('Authorization', 'Bearer ' + wilber);
    expect(inbox.body.items.some((x: any) => x.sub_order_uuid === 'so-api-1')).toBe(true);
  });

  it('canal en vivo: acciones en orden, reintento sin duplicar y a cada perfil solo lo suyo', async () => {
    const hector = await session('u-hector');
    const andres = await session('u-andres');
    const open = async (auth: Record<string, string>) => {
      const sock: Socket = io(base + '/sync', { transports: ['websocket'], auth });
      const got: any[] = [];
      sock.on('patch', (p: any) => got.push(p));
      const hello: any = await new Promise(r => sock.on('hello', r));
      return { sock, got, hello };
    };
    const anon = await open({});
    const buyer = await open({ token: andres });
    const team = await open({ team: '' });
    expect([anon.hello.viewer, buyer.hello.viewer, team.hello.viewer]).toEqual(['anon', 'user', 'team']);
    const ev = { id: 'e-api-sync-1', type: 'SUBORDER_ACCEPT', p: { subOrderId: 'so-a02' } };
    const r1 = await api().post('/api/v1/sync/events').set('Authorization', 'Bearer ' + hector).send({ events: [ev] });
    expect(r1.body.results[0].ok).toBe(true);
    expect(r1.body.results[0].event).toBeUndefined(); // sin el contenido (lleva códigos que no son de quien la hizo)
    const r2 = await api().post('/api/v1/sync/events').set('Authorization', 'Bearer ' + hector).send({ events: [ev] });
    expect(r2.body.results[0].duplicate).toBe(true);
    const sys = await api().post('/api/v1/sync/events').set('Authorization', 'Bearer ' + hector).send({ events: [{ id: 'e-api-sync-2', type: 'CLOCK_ADVANCE', p: { ms: 1000 } }] });
    expect(sys.body.results[0].ok).toBe(false);
    await new Promise(r => setTimeout(r, 400));
    const pick = (x: { got: any[] }) => x.got.find(p => p.ev?.id === 'e-api-sync-1');
    for (const x of [anon, buyer, team]) expect(pick(x)?.set?.subOrders?.['so-a02']?.status).toBe('CONFIRMED');
    const code = pick(team).set.subOrders['so-a02'].deliveryCode;
    expect(code).toMatch(/^\d{4}$/);
    expect(pick(buyer).set.subOrders['so-a02'].deliveryCode).toBe(code); // el comprador conoce su código
    expect(pick(anon).set.subOrders['so-a02'].deliveryCode).toMatch(/^#/); // los demás, solo su huella
    expect(pick(anon).push?.notifs ?? []).toEqual([]);
    expect((pick(buyer).push?.notifs ?? []).every((n: any) => n.to === 'org-hotel')).toBe(true);
    // ponerse al día con las acciones completas es solo para el equipo
    expect((await api().get('/api/v1/sync/events?after=0')).status).toBe(401);
    for (const x of [anon, buyer, team]) x.sock.close();
  });

  it('archivos: foto pública por enlace y DNI solo con enlace firmado', async () => {
    const t = await session('u-hector');
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    expect((await api().post('/api/v1/files').set('Authorization', 'Bearer ' + t).send({ id: 'ph-api-1', dataUrl: png })).status).toBe(201);
    expect((await api().get('/api/v1/files/ph-api-1')).status).toBe(200);
    await api().post('/api/v1/files').set('Authorization', 'Bearer ' + t).send({ id: 'ph-api-dni', kind: 'DNI', dataUrl: png });
    expect((await api().get('/api/v1/files/ph-api-dni')).status).toBe(403);
    const lucia = await session('u-lucia');
    const u = await api().get('/api/v1/files/ph-api-dni/url').set('Authorization', 'Bearer ' + lucia);
    expect((await api().get(u.body.url)).status).toBe(200);
  });

  it('archivos guardados en la base de datos (en la nube el disco se borra)', async () => {
    const t = await session('u-wilber');
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    const up = await api().post('/api/v1/files').set('Authorization', 'Bearer ' + t).send({ id: 'ph-api-db', dataUrl: 'data:image/png;base64,' + png.toString('base64') });
    expect(up.status).toBe(201);
    const { createPool } = (await import('../dist/db/db.js' as string)) as typeof import('../src/db/db');
    const pool = createPool(DB);
    const [r] = await pool.query("SELECT LENGTH(b.data) AS n, f.storage_key FROM file_blobs b JOIN files f ON f.id = b.file_id WHERE f.uuid = 'ph-api-db'");
    await pool.end();
    expect((r as any[])[0].n).toBe(png.length);
    expect((r as any[])[0].storage_key).toMatch(/^db:/);
    const got = await api().get('/api/v1/files/ph-api-db').buffer(true).parse((res, cb) => { const b: Buffer[] = []; res.on('data', (d: Buffer) => b.push(d)); res.on('end', () => cb(null, Buffer.concat(b))); });
    expect(got.status).toBe(200);
    expect(Buffer.compare(got.body as Buffer, png)).toBe(0);
  });

  describe('en la nube (con clave del equipo)', () => {
    let CONFIG: any;
    const KEY = 'clave-del-equipo-de-prueba';
    // la misma configuración que usa el servidor (módulo compilado, cargado con require)
    beforeAll(() => { CONFIG = createRequire(path.resolve(process.cwd(), 'package.json'))('./dist/config.js').CONFIG; CONFIG.teamKey = KEY; });
    afterAll(() => { CONFIG.teamKey = ''; });

    it('las herramientas de la demo piden la clave del equipo', async () => {
      expect((await api().get('/api/v1/demo/status')).body.teamKeyRequired).toBe(true);
      for (const [method, url, body] of [['post', '/api/v1/demo/sessions', { userIds: ['u-majo'] }], ['get', '/api/v1/demo/team', undefined], ['post', '/api/v1/demo/clock', { ms: 1000 }], ['post', '/api/v1/demo/reset', {}]] as const) {
        const none = await (api() as any)[method](url).send(body);
        expect(none.status, url).toBe(401);
        expect(none.body.code).toBe('TEAM_KEY');
        expect((await (api() as any)[method](url).set('x-team-key', 'otra').send(body)).status, url).toBe(401);
      }
      const ok = await api().post('/api/v1/demo/sessions').set('x-team-key', KEY).send({ userIds: ['u-wilber'] });
      expect(ok.status).toBe(200);
      expect(ok.body[0].userId).toBe('u-wilber');
      expect((await api().get('/api/v1/demo/team').set('x-team-key', KEY)).body.length).toBeGreaterThan(0);
    });

    it('cada perfil recibe su copia del mundo y el código solo aparece en el celular de la cuenta', async () => {
      const phone = '944556677';
      const otp = await api().post('/api/v1/auth/otp').send({ phone, purpose: 'REGISTER' });
      expect(otp.body.demoCode).toMatch(/^\d{6}$/);
      const v = await api().post('/api/v1/auth/otp/verify').send({ phone, code: otp.body.demoCode });
      const reg = await api().post('/api/v1/auth/register').send({ ticket: v.body.ticket, event: { id: 'e-reg-nube-1', p: { userId: 'u-nube-1', orgId: 'org-nube-1', role: 'FARMER', phone, name: 'Persona Real de Prueba', dni: '47654321', lang: 'es', org: { district: '040519' } } } });
      expect(reg.status).toBe(201);
      expect(reg.body.deviceKey).toMatch(/^[A-Za-z0-9_-]{20,}$/);
      const mine = reg.body.session.accessToken as string;
      const wilber = (await api().post('/api/v1/demo/sessions').set('x-team-key', KEY).send({ userIds: ['u-wilber'] })).body[0].accessToken;
      const snap = async (h: Record<string, string>) => { let r = api().get('/api/v1/sync/snapshot'); for (const k in h) r = r.set(k, h[k]); const res = await r; return { status: res.status, body: res.body }; };
      const anon = await snap({});
      const own = await snap({ Authorization: 'Bearer ' + mine });
      const other = await snap({ Authorization: 'Bearer ' + wilber });
      const team = await snap({ 'x-team-key': KEY });
      expect([anon.body.viewer, own.body.viewer, other.body.viewer, team.body.viewer]).toEqual(['anon', 'user', 'user', 'team']);
      expect(own.body.world.users['u-nube-1'].phone).toBe(phone);
      expect(own.body.world.users['u-nube-1'].dni).toBe('47654321');
      expect(team.body.world.users['u-nube-1'].phone).toBe(phone);
      for (const x of [anon, other]) {
        expect(x.body.world.users['u-nube-1'].phone).not.toBe(phone);
        expect(x.body.world.users['u-nube-1'].dni).toBeUndefined();
        expect(x.body.world.users['u-nube-1'].name).toBe('Persona Real de Prueba');
        expect(x.body.world.audit).toEqual([]);
      }
      // las cuentas de ejemplo siguen completas (se entra con ellas desde «Ver cuentas de prueba»)
      expect(anon.body.world.users['u-wilber'].phone).toBe('987654321');
      expect((await snap({ Authorization: 'Bearer token-falso' })).status).toBe(401);
      // con la clave equivocada no se ve el mundo completo (y se avisa, para escribirla otra vez)
      const wrongKey = await snap({ 'x-team-key': 'otra' });
      expect(wrongKey.status).toBe(401);
      expect(wrongKey.body.code).toBe('TEAM_KEY');

      // ingresar otra vez: el código se muestra solo en el celular donde se creó la cuenta
      const elsewhere = await api().post('/api/v1/auth/otp').send({ phone, purpose: 'LOGIN' });
      expect(elsewhere.body.demoCode).toBeUndefined();
      expect(elsewhere.body.deviceOnly).toBe(true);
      const here = await api().post('/api/v1/auth/otp').set('x-device-key', reg.body.deviceKey).send({ phone, purpose: 'LOGIN' });
      expect(here.body.demoCode).toMatch(/^\d{6}$/);
      const login = await api().post('/api/v1/auth/login').set('x-device-key', reg.body.deviceKey).send({ phone, code: here.body.demoCode, role: 'FARMER' });
      expect(login.status).toBe(200);
      expect(login.body.deviceKey).toBe(reg.body.deviceKey);
      // las personas de ejemplo, en cualquier celular
      expect((await api().post('/api/v1/auth/otp').send({ phone: '987654321', purpose: 'LOGIN' })).body.demoCode).toMatch(/^\d{6}$/);
      // si el equipo restablece el acceso, el próximo celular donde ingrese ve el código
      const team2 = (await api().get('/api/v1/demo/team').set('x-team-key', KEY)).body.find((x: any) => x.userId === 'u-majo');
      const admin = await api().post('/api/v1/auth/admin/login').send({ email: team2.email, password: team2.password, code: team2.code });
      const reset = await api().post('/api/v1/admin/organizations/org-nube-1/reset-access').set('Authorization', 'Bearer ' + admin.body.session.accessToken).send({ reason: 'Cambió de celular' });
      expect(reset.status).toBe(201);
      expect(reset.body.devicesForgotten).toBeGreaterThan(0);
      expect((await api().post('/api/v1/auth/otp').send({ phone, purpose: 'LOGIN' })).body.demoCode).toMatch(/^\d{6}$/);
    });
  });

  describe('código por WhatsApp sin costo: la persona escribe y Mesagri responde', () => {
    let CONFIG: any;
    let meta: nodeHttp.Server;
    const sent: { to: string; body: string }[] = [];
    const KEY = 'clave-del-equipo-de-prueba';
    const SECRET = 'secreto-de-la-app-de-meta';
    const saved: any = {};
    beforeAll(async () => {
      CONFIG = createRequire(path.resolve(process.cwd(), 'package.json'))('./dist/config.js').CONFIG;
      // un «Meta» de mentira: guarda lo que el servidor manda
      meta = nodeHttp.createServer((req, res) => {
        let raw = '';
        req.on('data', d => { raw += d; });
        req.on('end', () => {
          res.setHeader('Content-Type', 'application/json');
          if (req.method === 'GET' && /\/v25\.0\/PHONE123\?/.test(req.url ?? '')) { res.end(JSON.stringify({ display_phone_number: '+51 900 000 001', verified_name: 'Mesagri' })); return; }
          if (req.method === 'POST' && req.url === '/v25.0/PHONE123/messages') {
            const b = JSON.parse(raw);
            sent.push({ to: b.to, body: b.text?.body ?? '' });
            res.end(JSON.stringify({ messaging_product: 'whatsapp', messages: [{ id: 'wamid.' + sent.length }] }));
            return;
          }
          res.statusCode = 404; res.end(JSON.stringify({ error: { code: 100, message: 'no' } }));
        });
      });
      await new Promise<void>(r => meta.listen(0, '127.0.0.1', () => r()));
      Object.assign(saved, CONFIG.whatsapp, { teamKey: CONFIG.teamKey });
      CONFIG.teamKey = KEY;
      Object.assign(CONFIG.whatsapp, { token: 'token-de-prueba', phoneId: 'PHONE123', mode: 'responder', number: '', verifyToken: 'verifica-mesagri', appSecret: SECRET, apiBase: `http://127.0.0.1:${(meta.address() as AddressInfo).port}` });
    });
    afterAll(async () => {
      const { teamKey, ...wa } = saved;
      Object.assign(CONFIG.whatsapp, wa);
      CONFIG.teamKey = teamKey;
      await new Promise(r => meta.close(r));
    });
    const hook = (from: string, text: string, id: string, secret = SECRET) => {
      const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: 'WABA', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: 'PHONE123' }, contacts: [{ wa_id: from, profile: { name: 'Prueba' } }], messages: [{ id, from, timestamp: '1', type: 'text', text: { body: text } }] } }] }] });
      const sig = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
      return api().post('/api/v1/whatsapp/webhook').set('Content-Type', 'application/json').set('X-Hub-Signature-256', sig).send(body);
    };
    const waitFor = async <T,>(fn: () => T | undefined, ms = 3000): Promise<T> => {
      const t0 = Date.now();
      for (;;) { const v = fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('no llegó'); await new Promise(r => setTimeout(r, 50)); }
    };

    it('Meta conecta el webhook solo con la clave', async () => {
      const ok = await api().get('/api/v1/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=verifica-mesagri&hub.challenge=12345');
      expect(ok.status).toBe(200);
      expect(ok.text).toBe('12345');
      expect((await api().get('/api/v1/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=otra&hub.challenge=1')).status).toBe(403);
      const st = (await api().get('/api/v1/demo/status')).body.whatsapp;
      expect(st.configured).toBe(true);
    });

    it('registro: la app abre WhatsApp, la persona escribe y le llega su código; con él crea su cuenta', async () => {
      const phone = '944000111';
      const r = await api().post('/api/v1/auth/otp').send({ phone, purpose: 'REGISTER' });
      expect(r.status).toBe(200);
      expect(r.body.channel).toBe('WHATSAPP_IN');
      expect(r.body.demoCode).toBeUndefined();
      expect(r.body.wa.number).toBe('+51900000001');
      expect(r.body.wa.link).toMatch(/^https:\/\/wa\.me\/51900000001\?text=Hola%20Mesagri/);
      // un aviso sin la firma de Meta no hace nada
      await hook('51' + phone, 'Hola Mesagri, quiero mi código', 'wamid.falso', 'otra-clave');
      await new Promise(res => setTimeout(res, 200));
      expect(sent.filter(m => m.to === '51' + phone)).toEqual([]);
      // el mensaje de la persona (Meta lo puede mandar dos veces): una sola respuesta
      expect((await hook('51' + phone, 'Hola Mesagri, quiero mi código para crear mi cuenta', 'wamid.in.1')).status).toBe(200);
      await hook('51' + phone, 'Hola Mesagri, quiero mi código para crear mi cuenta', 'wamid.in.1');
      const msg = await waitFor(() => sent.find(m => m.to === '51' + phone));
      await new Promise(res => setTimeout(res, 150));
      expect(sent.filter(m => m.to === '51' + phone).length).toBe(1);
      expect(msg.body).toMatch(/crear tu cuenta con el celular 944 000 111/);
      const code = /\*(\d{6})\*/.exec(msg.body)![1];
      const v = await api().post('/api/v1/auth/otp/verify').send({ phone, code });
      expect(v.status).toBe(200);
      const reg = await api().post('/api/v1/auth/register').send({ ticket: v.body.ticket, event: { id: 'e-reg-wa-1', p: { userId: 'u-wa-1', orgId: 'org-wa-1', role: 'FARMER', phone, name: 'Agricultora por WhatsApp', lang: 'es', org: { district: '040519' } } } });
      expect(reg.status).toBe(201);
      // otra vez: ahora es para ingresar, y el código sirve en «Ya tengo cuenta»
      expect((await api().post('/api/v1/auth/otp').send({ phone, purpose: 'LOGIN' })).body.channel).toBe('WHATSAPP_IN');
      await hook('51' + phone, 'quiero mi código', 'wamid.in.2');
      const again = await waitFor(() => sent.filter(m => m.to === '51' + phone)[1]);
      expect(again.body).toMatch(/para ingresar/);
      const login = await api().post('/api/v1/auth/login').send({ phone, code: /\*(\d{6})\*/.exec(again.body)![1], role: 'FARMER' });
      expect(login.status).toBe(200);
      expect(login.body.userId).toBe('u-wa-1');
    });

    it('cuentas de prueba: en pantalla para todos; quien presenta la pide por WhatsApp desde su celular', async () => {
      const pub = await api().post('/api/v1/auth/otp').send({ phone: '987654321', purpose: 'LOGIN' });
      expect(pub.body.channel).toBe('PANTALLA');
      expect(pub.body.demoCode).toMatch(/^\d{6}$/);
      const pres = await api().post('/api/v1/auth/otp').set('x-team-key', KEY).send({ phone: '987654321', purpose: 'LOGIN' });
      expect(pres.body.channel).toBe('WHATSAPP_IN');
      expect(pres.body.demoAccount).toBe(true);
      const ask = /prueba%20([A-Z]{4})/.exec(pres.body.wa.link)![1];
      await hook('51955555555', `Hola Mesagri, quiero el código de la cuenta de prueba ${ask}`, 'wamid.demo.1');
      const msg = await waitFor(() => sent.find(m => m.to === '51955555555'));
      expect(msg.body).toMatch(/cuenta de prueba de Wilber/);
      const login = await api().post('/api/v1/auth/login').send({ phone: '987654321', code: /\*(\d{6})\*/.exec(msg.body)![1], role: 'FARMER' });
      expect(login.status).toBe(200);
      expect(login.body.userId).toBe('u-wilber');
    });
  });

  describe('código por SMS desde el celular de Mesagri (SMS Gateway for Android)', () => {
    let CONFIG: any;
    let gw: nodeHttp.Server;
    const sms: { auth: string; to: string[]; text: string }[] = [];
    let fail = false;
    const saved: any = {};
    beforeAll(async () => {
      CONFIG = createRequire(path.resolve(process.cwd(), 'package.json'))('./dist/config.js').CONFIG;
      // el «celular» de mentira: guarda los SMS que le pide el servidor
      gw = nodeHttp.createServer((req, res) => {
        let raw = '';
        req.on('data', d => { raw += d; });
        req.on('end', () => {
          res.setHeader('Content-Type', 'application/json');
          if (req.method === 'POST' && req.url === '/3rdparty/v1/messages') {
            if (fail) { res.statusCode = 500; res.end(JSON.stringify({ message: 'sin señal' })); return; }
            const b = JSON.parse(raw);
            sms.push({ auth: String(req.headers.authorization ?? ''), to: b.phoneNumbers, text: b.textMessage?.text ?? '' });
            res.statusCode = 202; res.end(JSON.stringify({ id: 'sms-' + sms.length, state: 'Pending' }));
            return;
          }
          res.statusCode = 404; res.end('{}');
        });
      });
      await new Promise<void>(r => gw.listen(0, '127.0.0.1', () => r()));
      Object.assign(saved, { sms: { ...CONFIG.sms }, demoCodesTo: CONFIG.demoCodesTo, teamKey: CONFIG.teamKey });
      Object.assign(CONFIG.sms, { url: `http://127.0.0.1:${(gw.address() as AddressInfo).port}/3rdparty/v1`, user: 'USUARIO', password: 'clave-sms' });
      CONFIG.demoCodesTo = ['955555555'];
      CONFIG.teamKey = 'clave-equipo-sms';
    });
    afterAll(async () => {
      Object.assign(CONFIG.sms, saved.sms);
      CONFIG.demoCodesTo = saved.demoCodesTo;
      CONFIG.teamKey = saved.teamKey;
      await new Promise(r => gw.close(r));
    });

    it('registro e ingreso con el código que llega por SMS', async () => {
      const phone = '966000222';
      const r = await api().post('/api/v1/auth/otp').send({ phone, purpose: 'REGISTER' });
      expect(r.body.channel).toBe('SMS');
      expect(r.body.demoCode).toBeUndefined();
      expect(r.body.to).toMatch(/^9•• ••• \d{3}$/);
      const m = sms.at(-1)!;
      expect(m.to).toEqual(['+51' + phone]);
      expect(m.auth).toBe('Basic ' + Buffer.from('USUARIO:clave-sms').toString('base64'));
      expect(m.text).toMatch(/^Tu codigo de Mesagri es \d{6}\. Vence en 5 min\./);
      expect(m.text).toMatch(/\n@127\.0\.0\.1 #\d{6}$/); // Chrome de Android completa el código solo
      expect(m.text.length).toBeLessThanOrEqual(160);
      const code = /es (\d{6})\./.exec(m.text)![1];
      const v = await api().post('/api/v1/auth/otp/verify').send({ phone, code });
      expect(v.status).toBe(200);
      const reg = await api().post('/api/v1/auth/register').send({ ticket: v.body.ticket, event: { id: 'e-reg-sms-1', p: { userId: 'u-sms-1', orgId: 'org-sms-1', role: 'FARMER', phone, name: 'Agricultor por SMS', lang: 'es', org: { district: '040519' } } } });
      expect(reg.status).toBe(201);
      const l = await api().post('/api/v1/auth/otp').send({ phone, purpose: 'LOGIN' });
      expect(l.body.channel).toBe('SMS');
      const code2 = /es (\d{6})\./.exec(sms.at(-1)!.text)![1];
      expect((await api().post('/api/v1/auth/login').send({ phone, code: code2, role: 'FARMER' })).body.userId).toBe('u-sms-1');
    });

    it('cuentas de prueba: en pantalla para el público y por SMS al celular de quien presenta', async () => {
      const pub = await api().post('/api/v1/auth/otp').send({ phone: '987654321', purpose: 'LOGIN' });
      expect(pub.body.channel).toBe('PANTALLA');
      const n = sms.length;
      const pres = await api().post('/api/v1/auth/otp').set('x-team-key', 'clave-equipo-sms').send({ phone: '987654321', purpose: 'LOGIN' });
      expect(pres.body.channel).toBe('SMS');
      expect(pres.body.demoCode).toBeUndefined();
      expect(sms.length).toBe(n + 1);
      expect(sms.at(-1)!.to).toEqual(['+51955555555']);
      const code = /es (\d{6})\./.exec(sms.at(-1)!.text)![1];
      expect((await api().post('/api/v1/auth/login').send({ phone: '987654321', code, role: 'FARMER' })).body.userId).toBe('u-wilber');
    });

    it('si el celular de los SMS no responde, la versión de prueba muestra el código para registrarse', async () => {
      fail = true;
      try {
        const r = await api().post('/api/v1/auth/otp').send({ phone: '966000333', purpose: 'REGISTER' });
        expect(r.body.channel).toBe('PANTALLA');
        expect(r.body.demoCode).toMatch(/^\d{6}$/);
        expect(r.body.notice).toMatch(/SMS/);
      } finally { fail = false; }
    });
  });

  describe('identidad: consulta del DNI (padrón de prueba o proveedor de RENIEC)', () => {
    const bearer = (t: string) => ({ Authorization: 'Bearer ' + t });
    const ticketFor = async (phone: string) => {
      const otp = await api().post('/api/v1/auth/otp').send({ phone, purpose: 'REGISTER' });
      return (await api().post('/api/v1/auth/otp/verify').send({ phone, code: otp.body.demoCode })).body.ticket as string;
    };
    const faces = [
      { pose: 'FRONT', photoId: 'ph-api-f1', live: true, auto: { ok: true, faces: 1, yaw: 2 } },
      { pose: 'RIGHT', photoId: 'ph-api-f2', live: true, auto: { ok: true, faces: 1, yaw: -26 } },
      { pose: 'LEFT', photoId: 'ph-api-f3', live: true, auto: { ok: true, faces: 1, yaw: 27 } },
    ];

    it('padrón de prueba: solo dice si coincide (nunca el nombre oficial) y pide el permiso de registro', async () => {
      const info = await api().get('/api/v1/identity/registry');
      expect(info.body.source).toBe('PADRON_PRUEBA');
      expect(info.body.tests.map((x: any) => x.dni)).toContain('41235876');
      const body = { dni: '41235876', name: 'Teodora Quispe Mamani' };
      expect((await api().post('/api/v1/identity/dni-check').send(body)).status).toBe(401);
      const ticket = await ticketFor('933221166');
      const ok = await api().post('/api/v1/identity/dni-check').send({ ...body, ticket });
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(ok.body).toMatchObject({ status: 'MATCH', source: 'PADRON_PRUEBA', deceased: false });
      expect(JSON.stringify(ok.body)).not.toMatch(/TEODORA|QUISPE/);
      expect((await api().post('/api/v1/identity/dni-check').send({ ...body, name: 'Rosa Ccalla Huamán', ticket })).body.status).toBe('NAME_MISMATCH');
      expect((await api().post('/api/v1/identity/dni-check').send({ dni: '40817263', name: 'Mario Ccapa Huamaní', ticket })).body).toMatchObject({ status: 'DECEASED', deceased: true });
      expect((await api().post('/api/v1/identity/dni-check').send({ dni: '12345678', name: 'Ana Ruiz Paz', ticket })).body.status).toBe('NOT_FOUND');
      expect((await api().post('/api/v1/identity/dni-check').send({ dni: '1234', name: 'Ana Ruiz Paz', ticket })).body.code).toBe('BAD_DNI');
      // límite de consultas: así nadie recorre DNI ajenos
      let last = 200;
      for (let i = 0; i < 8 && last === 200; i++) last = (await api().post('/api/v1/identity/dni-check').send({ ...body, ticket })).status;
      expect(last).toBe(429);
    });

    it('al enviar el expediente el servidor consulta el DNI y lo anota; la persona no ve el nombre oficial', async () => {
      const phone = '933221177';
      const ticket = await ticketFor(phone);
      const reg = await api().post('/api/v1/auth/register').send({ ticket, event: { id: 'e-reg-id-1', p: { userId: 'u-teo-api', orgId: 'org-teo-api', role: 'FARMER', phone, name: 'Teodora Quispe Mamani', dni: '41235876', lang: 'es', org: { district: '040519' } } } });
      expect(reg.status, JSON.stringify(reg.body)).toBe(201);
      const tok = reg.body.session.accessToken as string;
      const identity = { dni: '41235876', name: 'Teodora Quispe Mamani', dniFront: 'ph-api-d1', dniBack: 'ph-api-d2', faces };
      const sub = await api().post('/api/v1/verification/cases').set(bearer(tok)).send({ caseId: 'case-id-api', targetLevel: 1, identity, evidence: [{ key: 'cobro', label: 'Yape propio' }] });
      expect(sub.status, JSON.stringify(sub.body)).toBe(201);
      // la consulta la hace el servidor (no el celular) y queda en el expediente
      const admin = await session('u-lucia');
      await expect.poll(async () => (await api().get('/api/v1/sync/snapshot').set(bearer(admin))).body.world.cases['case-id-api']?.identity?.registry?.status, { timeout: 8000 }).toBe('MATCH');
      const seen = (await api().get('/api/v1/sync/snapshot').set(bearer(admin))).body.world.cases['case-id-api'];
      expect(seen.identity.registry).toMatchObject({ source: 'PADRON_PRUEBA', officialName: 'TEODORA QUISPE MAMANI' });
      expect(seen.evidence.map((e: any) => e.key)).toEqual(['dni', 'dni2', 'rostro', 'rostro-der', 'rostro-izq', 'cobro']);
      const mine = (await api().get('/api/v1/sync/snapshot').set(bearer(tok))).body.world.cases['case-id-api'];
      expect(mine.identity.registry.status).toBe('MATCH');
      expect(mine.identity.registry.officialName).toBeUndefined();
      // guardado en MySQL con su identidad
      const req = createRequire(path.resolve(process.cwd(), 'package.json'));
      const { rows } = req('./dist/db/db.js') as typeof import('../src/db/db');
      const engine = app.get(req('./dist/core/engine.service.js').EngineService);
      const row = (await rows(engine.pool, 'SELECT identity FROM verification_cases WHERE uuid = ?', ['case-id-api']))[0];
      expect(row.identity.faces.length).toBe(3);
      expect(row.identity.registry.status).toBe('MATCH');
      // el celular no puede anotar una consulta por su cuenta
      const forged = await api().post('/api/v1/sync/events').set(bearer(tok)).send({ events: [{ id: 'e-id-forged', type: 'VERIF_IDCHECK', p: { caseId: 'case-id-api', dni: '41235876', registry: { status: 'MATCH', source: 'PROVEEDOR' } } }] });
      expect(forged.body.results[0].error.code).toBe('FORBIDDEN');
      // el panel guarda lo que leyó en las fotos
      const auto = await api().post('/api/v1/sync/events').set(bearer(admin)).send({ events: [{ id: 'e-id-auto', type: 'VERIF_AUTOCHECK', p: { caseId: 'case-id-api', review: { mrz: { read: true, checks: true, dni: '41235876', surnames: 'QUISPE MAMANI', given: 'TEODORA', birth: '840512', expiry: '310820', sex: 'F' }, faceMatch: { distance: 0.31 } } } }] });
      expect(auto.body.results[0].ok, JSON.stringify(auto.body)).toBe(true);
      expect((await api().get('/api/v1/sync/snapshot').set(bearer(admin))).body.world.cases['case-id-api'].identity.review.faceMatch.level).toBe('ALTA');
    });

    describe('con un proveedor de consultas', () => {
      let CONFIG: any;
      let srv: nodeHttp.Server;
      const hits: { url: string; auth: string }[] = [];
      let reject = false;
      const saved: any = {};
      beforeAll(async () => {
        CONFIG = createRequire(path.resolve(process.cwd(), 'package.json'))('./dist/config.js').CONFIG;
        // el proveedor de mentira (responde como Factiliza: data.nombres, apellido_paterno...)
        srv = nodeHttp.createServer((req, res) => {
          hits.push({ url: String(req.url), auth: String(req.headers.authorization ?? '') });
          res.setHeader('Content-Type', 'application/json');
          if (reject) { res.statusCode = 401; res.end(JSON.stringify({ message: 'token inválido' })); return; }
          const dni = String(req.url).split('/').pop();
          if (dni === '44871209') { res.end(JSON.stringify({ status: 200, success: true, data: { numero: dni, nombres: 'RUBEN DARIO', apellido_paterno: 'HUAMANI', apellido_materno: 'CONDORI', nombre_completo: 'HUAMANI CONDORI, RUBEN DARIO' } })); return; }
          if (dni === '40817263') { res.end(JSON.stringify({ success: true, data: { first_name: 'MARIO', first_last_name: 'CCAPA', second_last_name: 'HUAMANI', fecha_fallecimiento: '2024-02-11' } })); return; }
          res.statusCode = 404; res.end(JSON.stringify({ success: false, message: 'No se encontró el DNI' }));
        });
        await new Promise<void>(r => srv.listen(0, '127.0.0.1', () => r()));
        Object.assign(saved, { ...CONFIG.dniApi });
        Object.assign(CONFIG.dniApi, { url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}/v1/dni/info/{dni}`, token: 'token-de-prueba', provider: 'Proveedor de prueba' });
      });
      afterAll(async () => {
        Object.assign(CONFIG.dniApi, saved);
        await new Promise(r => srv.close(r));
      });

      it('consulta con el token, guarda la consulta 30 días y lee el fallecimiento si el proveedor lo informa', async () => {
        expect((await api().get('/api/v1/identity/registry')).body).toMatchObject({ source: 'PROVEEDOR', provider: 'Proveedor de prueba', tests: [] });
        const ticket = await ticketFor('933221188');
        const one = await api().post('/api/v1/identity/dni-check').send({ dni: '44871209', name: 'Rubén Darío Huamaní Condori', ticket });
        expect(one.body).toMatchObject({ status: 'MATCH', source: 'PROVEEDOR', provider: 'Proveedor de prueba', deceased: null });
        expect(hits.at(-1)).toEqual({ url: '/v1/dni/info/44871209', auth: 'Bearer token-de-prueba' });
        const n = hits.length;
        expect((await api().post('/api/v1/identity/dni-check').send({ dni: '44871209', name: 'Rubén Huamaní', ticket })).body.status).toBe('PARTIAL');
        expect(hits.length).toBe(n); // segunda vez: de la consulta guardada, sin pagar otra
        expect((await api().post('/api/v1/identity/dni-check').send({ dni: '40817263', name: 'Mario Ccapa Huamaní', ticket })).body).toMatchObject({ status: 'DECEASED', deceased: true });
        expect((await api().post('/api/v1/identity/dni-check').send({ dni: '41111111', name: 'Ana Ruiz Paz', ticket })).body.status).toBe('NOT_FOUND');
      });

      it('si el proveedor rechaza la clave, no se cae: queda para que lo revise una persona', async () => {
        reject = true;
        try {
          const ticket = await ticketFor('933221199');
          const r = await api().post('/api/v1/identity/dni-check').send({ dni: '42222222', name: 'Ana Ruiz Paz', ticket });
          expect(r.body).toMatchObject({ status: 'UNAVAILABLE', source: 'PROVEEDOR' });
          // desde el panel se vuelve a consultar sin usar lo guardado
          reject = false;
          const admin = await session('u-lucia');
          const n = hits.length;
          const re = await api().post('/api/v1/admin/cases/case-id-api/dni-check').set(bearer(admin));
          expect(re.status, JSON.stringify(re.body)).toBe(201);
          expect(re.body.registry).toMatchObject({ source: 'PROVEEDOR', status: 'NOT_FOUND' });
          expect(hits.length).toBe(n + 1);
          expect((await api().post('/api/v1/admin/cases/case-id-api/dni-check').set(bearer(await session('u-ana')))).status).toBe(403);
        } finally { reject = false; }
      });
    });
  });

  it('política de privacidad publicada (la pide Meta)', async () => {
    const r = await api().get('/privacidad');
    expect(r.status).toBe(200);
    expect(r.text).toMatch(/Política de privacidad de Mesagri/);
  });

  it('equipo: la administración general crea la cuenta con su rol; la persona crea su contraseña y su doble factor; todo sobrevive al reinicio', async () => {
    const { totp: totpOf } = (await import('../dist/auth/secrets.js' as string)) as typeof import('../src/auth/secrets');
    const b32 = (s: string) => { const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = 0, v = 0; const out: number[] = []; for (const c of s) { v = ((v << 5) | A.indexOf(c)) & 0xffff; bits += 5; if (bits >= 8) { out.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(out); };
    const bearer = (t: string) => ({ Authorization: 'Bearer ' + t });
    const gen = await session('u-majo');
    // solo la administración general agrega personas
    const denied = await api().post('/api/v1/admin/team').set(bearer(await session('u-ana'))).send({ name: 'Rosa Quispe', email: 'rosa.q@mesagri.pe', phone: '900000031', adminRole: 'SUPPORT' });
    expect(denied.status).toBe(403);
    const add = await api().post('/api/v1/admin/team').set(bearer(gen)).send({ name: 'Rosa Quispe', email: 'Rosa.Q@mesagri.pe', phone: '900000031', adminRole: 'SUPPORT' });
    expect(add.status, JSON.stringify(add.body)).toBe(201);
    const id = add.body.access.userId as string;
    const temp = add.body.access.password as string;
    expect(temp).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
    // no es una cuenta de prueba: no aparece con la clave del equipo
    expect((await api().get('/api/v1/demo/team')).body.some((x: any) => x.userId === id)).toBe(false);
    const list = await api().get('/api/v1/admin/team').set(bearer(gen));
    expect(list.body.find((x: any) => x.userId === id)).toMatchObject({ pending: true, demo: false, expired: false });
    expect(list.body.find((x: any) => x.userId === 'u-gaby')).toMatchObject({ demo: true, pending: false });

    // primer ingreso: con la clave temporal (sin código) crea su contraseña y activa su doble factor
    expect((await api().post('/api/v1/auth/admin/login').send({ email: 'rosa.q@mesagri.pe', password: 'otra-clave-2026', code: '' })).status).toBe(401);
    const first = await api().post('/api/v1/auth/admin/login').send({ email: 'rosa.q@mesagri.pe', password: temp, code: '' });
    expect(first.status).toBe(200);
    expect(first.body.session).toBeUndefined();
    expect(first.body.setup.totp.uri).toContain('otpauth://totp/Mesagri:rosa.q%40mesagri.pe');
    const secret = b32(first.body.setup.totp.secret);
    const setup = (password: string, code: string) => api().post('/api/v1/auth/admin/setup').send({ token: first.body.setup.token, password, code });
    expect((await setup('corta', totpOf(secret))).body.code).toBe('WEAK_PASSWORD');
    expect(['SAME_PASSWORD', 'WEAK_PASSWORD']).toContain((await setup(temp, totpOf(secret))).body.code);
    expect((await setup('chacra-segura-2026', '000000')).body.code).toBe('BAD_CODE');
    const done = await setup('chacra-segura-2026', totpOf(secret));
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.session.accessToken).toBeTruthy();
    // el permiso sirve una vez y la clave temporal ya no entra
    expect((await setup('chacra-segura-2027', totpOf(secret))).body.code).toBe('SETUP_EXPIRED');
    expect((await api().post('/api/v1/auth/admin/login').send({ email: 'rosa.q@mesagri.pe', password: temp, code: totpOf(secret) })).status).toBe(401);
    const login = await api().post('/api/v1/auth/admin/login').send({ email: 'rosa.q@mesagri.pe', password: 'chacra-segura-2026', code: totpOf(secret) });
    expect(login.status).toBe(200);
    const rosa = login.body.session.accessToken as string;
    expect((await api().get('/api/v1/auth/admin/me').set(bearer(rosa))).body.demo).toBe(false);
    // soporte no ve la auditoría ni administra el equipo
    expect((await api().get('/api/v1/admin/audit-logs').set(bearer(rosa))).status).toBe(403);
    expect((await api().get('/api/v1/admin/team').set(bearer(rosa))).status).toBe(403);
    // pasa a analista: su copia del mundo ya no trae la auditoría ni datos personales
    expect((await api().post(`/api/v1/admin/team/${id}/role`).set(bearer(gen)).send({ adminRole: 'ANALYST' })).status).toBe(200);
    const snap = await api().get('/api/v1/sync/snapshot').set(bearer(rosa));
    expect(snap.body.viewer).toBe('analyst');
    expect(snap.body.world.audit).toEqual([]);
    // al pausarla, su sesión deja de servir; al reactivarla, vuelve
    expect((await api().post(`/api/v1/admin/team/${id}/status`).set(bearer(gen)).send({ active: false })).status).toBe(200);
    const blocked = await api().get('/api/v1/auth/admin/me').set(bearer(rosa));
    expect(blocked.status).toBe(401);
    expect(blocked.body.code).toBe('SUSPENDED');
    expect((await api().post(`/api/v1/admin/team/${id}/status`).set(bearer(gen)).send({ active: true })).status).toBe(200);
    // la administración general no puede pausarse a sí misma
    expect((await api().post('/api/v1/admin/team/u-majo/status').set(bearer(gen)).send({ active: false })).body.code).toBe('SELF');

    // Gaby hace suya su cuenta de prueba y personaliza su nombre
    const demo = (await api().get('/api/v1/demo/team')).body.find((x: any) => x.userId === 'u-gaby');
    const gl = await api().post('/api/v1/auth/admin/login').send({ email: demo.email, password: demo.password, code: demo.code });
    const gaby = gl.body.session.accessToken as string;
    expect((await api().get('/api/v1/auth/admin/me').set(bearer(gaby))).body.demo).toBe(true);
    expect((await api().post('/api/v1/auth/admin/password').set(bearer(gaby)).send({ current: demo.password, next: 'gaby-mesagri-2026' })).body.code).toBe('DEMO_ACCOUNT');
    const st = await api().post('/api/v1/auth/admin/2fa/start').set(bearer(gaby)).send({});
    expect(st.body.needPassword).toBe(true);
    const gsecret = b32(st.body.totp.secret);
    expect((await api().post('/api/v1/auth/admin/2fa/finish').set(bearer(gaby)).send({ token: st.body.token, code: totpOf(gsecret) })).body.code).toBe('PASSWORD_REQUIRED');
    const fin = await api().post('/api/v1/auth/admin/2fa/finish').set(bearer(gaby)).send({ token: st.body.token, code: totpOf(gsecret), password: 'gaby-mesagri-2026' });
    expect(fin.status, JSON.stringify(fin.body)).toBe(200);
    expect((await api().get('/api/v1/demo/team')).body.some((x: any) => x.userId === 'u-gaby')).toBe(false);
    expect((await api().post('/api/v1/auth/admin/login').send({ email: 'gaby@mesagri.pe', password: demo.password, code: demo.code })).status).toBe(401);
    const name = await api().post('/api/v1/sync/events').set(bearer(gaby)).send({ events: [{ id: 'e-api-perfil-1', type: 'PROFILE_SET', p: { name: 'Gabriela Moreno', shortName: 'Gaby' } }] });
    expect(name.body.results[0].ok, JSON.stringify(name.body)).toBe(true);
    // nadie del público ve el correo ni el celular del equipo
    const pub = await api().get('/api/v1/sync/snapshot');
    expect(pub.body.world.users['u-gaby'].email).toBeUndefined();
    expect(pub.body.world.users['u-gaby'].phone).not.toBe('900000002');

    // reiniciar la demo no cambia quién trabaja en Mesagri: roles, datos y claves se conservan
    await new Promise(r => setTimeout(r, 300));
    expect((await api().post('/api/v1/demo/reset').send({})).status).toBe(200);
    const again = await api().post('/api/v1/auth/admin/login').send({ email: 'rosa.q@mesagri.pe', password: 'chacra-segura-2026', code: totpOf(secret) });
    expect(again.status).toBe(200);
    const w2 = (await api().get('/api/v1/sync/snapshot').set(bearer(await session('u-majo')))).body.world;
    expect(w2.users[id]).toMatchObject({ name: 'Rosa Quispe', adminRole: 'ANALYST', status: 'ACTIVE', email: 'rosa.q@mesagri.pe' });
    expect(w2.users['u-gaby'].name).toBe('Gabriela Moreno');
    expect((await api().post('/api/v1/auth/admin/login').send({ email: 'gaby@mesagri.pe', password: 'gaby-mesagri-2026', code: totpOf(gsecret) })).status).toBe(200);
    expect((await api().get('/api/v1/demo/team')).body.map((x: any) => x.userId)).toEqual(expect.arrayContaining(['u-majo', 'u-dayis', 'u-kevin']));
    expect((await api().get('/api/v1/demo/team')).body.some((x: any) => x.userId === 'u-gaby' || x.userId === id)).toBe(false);
  });

  it('reiniciar la demo cambia la época y deja sin efecto los tokens anteriores', async () => {
    const t = await session('u-wilber');
    const before = (await api().get('/api/v1/health')).body.epoch;
    expect((await api().post('/api/v1/demo/reset').send({})).status).toBe(200);
    const after = (await api().get('/api/v1/health')).body.epoch;
    expect(after).not.toBe(before);
    const old = await api().get('/api/v1/me').set('Authorization', 'Bearer ' + t);
    expect(old.status).toBe(401);
    expect(old.body.code).toBe('EPOCH');
  });
});
