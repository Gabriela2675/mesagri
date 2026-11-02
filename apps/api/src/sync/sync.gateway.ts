/*
 * Tiempo real por WebSocket (Socket.IO, 14.6). Cada celular se conecta con su sesión (o con la
 * clave del equipo, el escenario de la demo). Después de cada acción aceptada, a cada uno le llega
 * en el orden del servidor solo lo que cambió y su perfil puede ver (@mesagri/shared/patch).
 * El equipo recibe además los eventos del documento (message.new, suborder.status_changed...).
 */
import { Logger } from '@nestjs/common';
import { OnGatewayConnection, OnGatewayInit, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';
import { patchFor, relatedOf, viewerKey, viewerKind, emptyChanges, ANON, type Viewer } from '@mesagri/shared';
import { EngineService, Applied } from '../core/engine.service';
import { AuthService } from '../auth/auth.service';
import { encodeWorld } from './sync.controller';
import { viewerOf, adminViewer } from './viewer';

/** Nombre del evento del documento según la acción. */
export function domainEvent(type: string): string | undefined {
  if (type === 'MSG_SEND') return 'message.new';
  if (type.startsWith('PAYMENT_') || type === 'SUB_PAY') return 'payment.updated';
  if (type === 'VERIF_DECIDE') return 'verification.decided';
  if (type.startsWith('LISTING_')) return 'listing.stock_changed';
  if (type === 'STO_BOOK' || type.startsWith('STO_BOOK_')) return 'storage.booking_updated';
  if (type.startsWith('STO_')) return 'storage.lot_updated';
  if (type === 'SHIP_OFFER_RESPOND' || type === 'SHIP_REOFFER') return 'shipment.offered';
  if (type.startsWith('SHIP_')) return 'shipment.status_changed';
  if (type.startsWith('STATEMENT_') || type.startsWith('BILLING_') || type === 'CHARGE_VOID') return 'billing.statement_updated';
  if (type === 'ORDER_PLACE' || type.startsWith('SUBORDER_') || type === 'RECEIPT_CONFIRM' || type.startsWith('DISPUTE_')) return 'suborder.status_changed';
  return undefined;
}

interface Peer { viewer?: Viewer; related?: Set<string> }

@WebSocketGateway({ namespace: '/sync', cors: { origin: true, credentials: false }, transports: ['websocket', 'polling'] })
export class SyncGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly log = new Logger('Tiempo real');
  @WebSocketServer() server!: Namespace;

  constructor(private readonly engine: EngineService, private readonly auth: AuthService) {}

  afterInit() {
    this.engine.bus.on('event', (a: Applied) => {
      try { this.broadcast(a); } catch (e: any) { this.log.error(`No se pudo difundir ${a.event.type}: ${e?.message ?? e}`); }
      if (a.event.type === 'STAFF_ROLE_SET' || a.event.type === 'STAFF_STATUS_SET') this.refreshViewers(String(a.event.p?.userId ?? ''));
    });
    this.engine.bus.on('reset', (r: { epoch: string }) => this.server.emit('reset', { epoch: r.epoch, boot: this.engine.boot }));
  }

  /** A cada perfil conectado, lo que cambió para él (se calcula una vez por perfil). */
  private broadcast(a: Applied) {
    const ch = a.changes ?? emptyChanges();
    const meta = { id: a.event.id, type: a.event.type, actor: a.event.actor, t: a.event.t };
    const groups = new Map<string, { viewer: Viewer; related?: Set<string>; sockets: Socket[] }>();
    for (const s of this.server.sockets.values()) {
      const peer = s.data as Peer;
      if (!peer.viewer) continue;
      const k = viewerKey(peer.viewer);
      const g = groups.get(k);
      if (g) g.sockets.push(s);
      else groups.set(k, { viewer: peer.viewer, related: peer.related, sockets: [s] });
    }
    const name = domainEvent(a.event.type);
    for (const g of groups.values()) {
      const { patch, related } = patchFor(ch, this.engine.world, g.viewer, a.seq, meta, g.related);
      const payload = JSON.parse(encodeWorld(patch));
      const staff = g.viewer.kind === 'team' || g.viewer.kind === 'admin';
      for (const s of g.sockets) {
        (s.data as Peer).related = related;
        s.emit('patch', payload);
        if (staff && name) s.emit(name, { seq: a.seq, type: a.event.type, at: a.event.t, ref: a.event.p?.subOrderId ?? a.event.p?.shipmentId ?? a.event.p?.listingId ?? a.event.p?.conv ?? a.event.p?.caseId ?? null });
        if (a.event.type === 'CLOCK_TICK' || a.event.type === 'CLOCK_ADVANCE') s.emit('clock', { seq: a.seq, simNow: this.engine.simNow() });
      }
    }
  }

  /** Cambió el rol de una persona del equipo o se pausó su acceso: sus conexiones pasan a ver lo que su rol permite. */
  private refreshViewers(userId: string) {
    const u = this.engine.world.users[userId];
    for (const s of this.server.sockets.values()) {
      const peer = s.data as Peer;
      if (peer.viewer?.kind !== 'admin' || peer.viewer.userId !== userId) continue;
      const viewer = u && u.status === 'ACTIVE' ? adminViewer(u.id, u.adminRole) : ANON;
      peer.viewer = viewer;
      peer.related = relatedOf(this.engine.world, viewer);
      // con otro perfil, el celular pide su copia otra vez (GET /sync/snapshot)
      s.emit('hello', { epoch: this.engine.epoch, boot: this.engine.boot, seq: this.engine.seq, serverNow: Date.now(), viewer: viewerKind(viewer) });
    }
  }

  async handleConnection(client: Socket) {
    try { await this.engine.whenReady; } catch { client.disconnect(true); return; }
    const h = client.handshake;
    const auth = (h.auth ?? {}) as { token?: string; team?: string };
    const { viewer, tokenError } = await viewerOf(this.auth, { token: auth.token, team: typeof auth.team === 'string' ? auth.team : undefined });
    const peer = client.data as Peer;
    peer.viewer = viewer;
    peer.related = relatedOf(this.engine.world, viewer);
    client.emit('hello', { epoch: this.engine.epoch, boot: this.engine.boot, seq: this.engine.seq, serverNow: Date.now(), viewer: viewerKind(viewer), ...(tokenError ? { authError: tokenError.code } : {}) });
  }
}
