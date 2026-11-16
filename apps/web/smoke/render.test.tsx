/* Pantallas nuevas y cambiadas, dibujadas con los datos de ejemplo: pagos que se pueden comprobar, ayuda, panel y letra. */
import { it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { seedWorld, applySafe, structuredCloneSafe } from '@mesagri/shared/engine/index';
import { Provide, type AppCtx } from '../src/app/ctx';
import { SCREENS } from '../src/app/screens/registry';
import '../src/app/screens/all';
import { AccountTools, MesagriAccounts, StatementMatch, OrderDetail, matchStatement, pendingPayments } from '../src/app/screens/admin3';
import type { World } from '@mesagri/shared/types';

let n = 0;
const act = (w: World, actor: string, type: string, p: any) => { const r = applySafe(w, { id: 'sm-' + (++n), type, actor, t: w.now + 60_000, lamport: 0, p }); if (!r.ok) throw new Error(type + ': ' + r.error?.message); return r; };

function ctx(w: World, userId: string, s: string, p?: any, mode: 'stage' | 'app' | 'panel' = 'stage'): AppCtx {
  const me = w.users[userId];
  const fail = () => { throw new Error('no se usa al dibujar'); };
  return {
    store: { mode, events: [], sessions: { token: async () => '' }, version: 1 } as any,
    photos: { peek: () => undefined, get: async () => undefined, put: async () => undefined } as any,
    dev: { id: 'd1', kind: mode === 'panel' ? 'web' : 'phone', userId, stack: [{ s, p }], online: true, outbox: [], cart: [], flow: {} } as any,
    w, now: w.now, me, org: me ? w.orgs[me.orgId] : undefined, fmt: {} as any, top: { s, p },
    go: fail, replace: fail, back: fail, reset: fail, act: fail as any, check: fail as any, patch: fail, toast: fail, sheet: fail, confirm: fail as any,
    login: fail, logout: fail, t: (_k, es) => es, say: () => undefined, web: mode === 'panel',
  };
}
const draw = (A: AppCtx, node: any) => renderToString(<Provide value={A}>{node}</Provide>);
const screen = (w: World, userId: string, s: string, p?: any, mode: 'stage' | 'app' | 'panel' = 'stage') => { const C = SCREENS[s].c; return draw(ctx(w, userId, s, p, mode), <C />); };

it('pantallas de pago: constancia (MYPE) y confirmación (agricultor)', () => {
  const w = structuredCloneSafe(seedWorld());
  const proof = screen(w, 'u-elena', 'B-12', { id: 'so-e01' });
  expect(proof).toContain('Código de seguridad de Yape');
  expect(proof).toContain('¿A nombre de quién sale el pago?');
  // en la app real (no la demo) no hay captura de ejemplo
  expect(screen(w, 'u-elena', 'B-12', { id: 'so-e01' }, 'app')).not.toContain('Usar foto de ejemplo');
  act(w, 'u-elena', 'PAYMENT_UPLOAD', { subOrderId: 'so-e01', method: 'YAPE', operation: '05123456', payerName: 'Elena Quispe', securityCode: '472', photoId: 'ph-x' });
  const conf = screen(w, 'u-wilber', 'A-14', { id: 'so-e01' });
  expect(conf).toContain('Cómo saber si de verdad te pagaron');
  expect(conf).toContain('472');
  expect(conf).toContain('Elena Quispe');
});

it('pagos a Mesagri: membresía y estado de cuenta usan las cuentas del panel', () => {
  const w = structuredCloneSafe(seedWorld());
  const mem = screen(w, 'u-elena', 'B-26');
  expect(mem).toContain('900 000 100');
  expect(mem).toContain('(ejemplo)');
  act(w, 'u-majo', 'MESAGRI_DATA_PROPOSE', { accounts: [{ kind: 'YAPE', number: '912345678', holder: 'Mesagri S.A.C.' }], whatsapp: '912345678', reason: 'Cuenta real' });
  act(w, 'u-gaby', 'MESAGRI_DATA_APPROVE', {});
  const mem2 = screen(w, 'u-elena', 'B-26');
  expect(mem2).toContain('912 345 678');
  expect(mem2).not.toContain('(ejemplo)');
  expect(mem2).not.toContain('Tarjeta');
  expect(screen(w, 'u-wilber', 'A-26')).toContain('Estado de cuenta');
  expect(screen(w, 'u-wilber', 'A-19')).toContain('912 345 678');
});

it('ayuda: la persona ve sus consultas; el equipo responde en «Mensajes de ayuda»', () => {
  const w = structuredCloneSafe(seedWorld());
  act(w, 'u-charo', 'TICKET_OPEN', { ticketId: 'tk-s', topic: 'Borrar mi cuenta', text: 'Pido que borren mi cuenta y mis datos personales.' });
  expect(screen(w, 'u-charo', 'A-19')).toContain('Tus consultas');
  expect(screen(w, 'u-charo', 'TICKET', { id: 'tk-s' })).toContain('esperando respuesta de Soporte');
  const inbox = screen(w, 'u-diana', 'W-21', { id: 'tk-s' }, 'panel');
  expect(inbox).toContain('Mensajes de ayuda');
  expect(inbox).toContain('Borrar cuenta');
  expect(inbox).toContain('Respuestas rápidas');
  expect(screen(w, 'u-majo', 'W-08', undefined, 'panel')).toContain('Ir a Mensajes de ayuda');
});

it('panel: cuentas (corregir, eliminar), publicaciones, pedidos y cobros', () => {
  const w = structuredCloneSafe(seedWorld());
  const users = screen(w, 'u-majo', 'W-05', { id: 'org-lucio' }, 'panel');
  expect(users).toContain('Corregir datos');
  expect(users).toContain('Eliminar cuenta');
  expect(draw(ctx(w, 'u-majo', 'W-05', { id: 'org-lucio', del: 1 }, 'panel'), <AccountTools o={w.orgs['org-lucio']} />)).toContain('Escribe ELIMINAR para confirmar');
  expect(draw(ctx(w, 'u-majo', 'W-05', { id: 'org-wilber', del: 1 }, 'panel'), <AccountTools o={w.orgs['org-wilber']} />)).toContain('Todavía no se puede');
  // Soporte corrige pero no elimina
  const sup = draw(ctx(w, 'u-diana', 'W-05', { id: 'org-lucio' }, 'panel'), <AccountTools o={w.orgs['org-lucio']} />);
  expect(sup).toContain('Corregir datos');
  expect(sup).not.toContain('Eliminar cuenta');
  act(w, 'u-majo', 'ACCOUNT_DELETE', { orgId: 'org-lucio', reason: 'Lo pidió por la app' });
  expect(screen(w, 'u-majo', 'W-05', { id: 'org-lucio' }, 'panel')).toContain('Cuenta eliminada');
  const mod = screen(w, 'u-diana', 'W-06', { id: 'l-w-papa', all: 1 }, 'panel');
  expect(mod).toContain('Todas las publicaciones');
  expect(mod).toContain('Eliminar');
  const orders = screen(w, 'u-diana', 'W-07', { order: 'so-e01' }, 'panel');
  expect(orders).toContain('Pagos sin confirmar');
  expect(draw(ctx(w, 'u-diana', 'W-07', undefined, 'panel'), <OrderDetail s={w.subOrders['so-a02']} onClose={() => undefined} />)).toContain('Cancelar el pedido');
  expect(screen(w, 'u-majo', 'W-14', { tab: 'CTA' }, 'panel')).toContain('Dónde le pagan a Mesagri');
  expect(screen(w, 'u-majo', 'W-14', { tab: 'REC' }, 'panel')).toContain('Comprobar con tu extracto');
  expect(draw(ctx(w, 'u-majo', 'W-14', undefined, 'panel'), <MesagriAccounts />)).toContain('datos de ejemplo');
  expect(draw(ctx(w, 'u-majo', 'W-14', undefined, 'panel'), <StatementMatch onPick={() => undefined} />)).toContain('Subir CSV');
  expect(screen(w, 'u-majo', 'W-02', undefined, 'panel')).toContain('Mensajes de ayuda por responder');
  for (const s of ['W-02', 'W-05', 'W-06', 'W-07', 'W-08', 'W-14', 'W-21']) for (const who of ['u-majo', 'u-diana', 'u-lucia', 'u-ana']) screen(w, who, s, undefined, 'panel');
});

it('cruce con el extracto: encuentra el número con su monto, con otro monto o no lo encuentra', () => {
  const w = structuredCloneSafe(seedWorld());
  const st = Object.values(w.statements).find(s => s.orgId === 'org-wilber' && ['ISSUED', 'OVERDUE'].includes(s.status))!;
  act(w, 'u-wilber', 'STATEMENT_PAY', { statementId: st.id, method: 'YAPE', operation: '05123987', payerName: 'Wilber Huamaní' });
  act(w, 'u-elena', 'SUB_PAY', { method: 'TRANSFER', operation: '7788990011' });
  const list = pendingPayments(w);
  const total = st.total.toFixed(2).replace('.', ',');
  const r = matchStatement(`16/11/2026 YAPE DE WILBER HUAMANI Op. 5123987 S/ ${total}\n16/11/2026 TRANSF 7788990011 1.234,50`, list);
  expect(r[st.id].m).toBe('OK');
  const inv = list.find(p => p.kind === 'INVOICE')!;
  expect(r[inv.id].m).toBe('AMOUNT');
  expect(r[inv.id].amounts).toEqual([1234.5]);
  expect(matchStatement('nada que ver 999', list)[st.id].m).toBe('MISSING');
});

it('letra: la MYPE de ejemplo empieza normal y puede elegir chica', () => {
  const w = structuredCloneSafe(seedWorld());
  expect(w.users['u-charo'].prefs.textScale).toBe(1);
  const html = screen(w, 'u-charo', 'B-20');
  expect(html).toContain('letra normal');
});
