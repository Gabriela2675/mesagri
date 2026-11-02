/*
 * Guía de prueba: los recorridos de 15.7 y las reglas corregidas tras la sesión 05, con cada paso
 * marcado solo cuando el motor ya lo registró. «Ir» abre el celular, la persona y la pantalla.
 */
import { useState } from 'react';
import type { World, SubOrder } from '@mesagri/shared/types';
import type { Store } from './store';
import type { UiState } from './stage';
import { Icon } from './ui/kit';
import { seedWorld } from '@mesagri/shared/engine/index';

type Go = (devId: string, userId: string, s?: string, p?: Record<string, any>) => void;
interface Step { t: string; dev: string; user: string; s?: string | ((w: World) => [string, any?]); done: (w: World) => boolean; hint?: string }
interface Flow { id: string; title: string; sub: string; steps: Step[] }

const isNew = (w: World, id: string) => !seedWorld().subOrders[id];
const newSub = (w: World, buyer: string, seller: string): SubOrder | undefined => Object.values(w.subOrders).filter(s => s.buyerOrgId === buyer && s.sellerOrgId === seller && isNew(w, s.id)).sort((a, b) => b.createdAt - a.createdAt)[0];
const past = (s: SubOrder | undefined, ...st: SubOrder['status'][]) => !!s && st.includes(s.status);
const newListing = (w: World, org: string) => Object.values(w.listings).some(l => l.orgId === org && !seedWorld().listings[l.id]);

const FLOWS: Flow[] = [
  {
    id: 'compra', title: 'Comprar, pagar, entregar y calificar', sub: 'Flujos 3 y 4 · Doña Charo (MYPE, nivel 1) le compra a Wilber',
    steps: [
      { t: 'Doña Charo busca papa, la agrega al carrito y confirma el pedido', dev: 'd2', user: 'u-charo', s: 'B-05', done: w => !!newSub(w, 'org-geranios', 'org-wilber'), hint: 'Nivel 1: paga antes de la entrega (RN-24).' },
      { t: 'Wilber ve su comisión en esa venta y acepta', dev: 'd1', user: 'u-wilber', s: w => { const s = newSub(w, 'org-geranios', 'org-wilber'); return s ? ['A-13', { id: s.id }] : ['A-12']; }, done: w => past(newSub(w, 'org-geranios', 'org-wilber'), 'CONFIRMED', 'PREPARING', 'READY', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED'), hint: 'Plazo de 12 h para responder (RN-08).' },
      { t: 'Doña Charo paga por Yape y sube la captura', dev: 'd2', user: 'u-charo', s: w => { const s = newSub(w, 'org-geranios', 'org-wilber'); return s ? ['B-14', { id: s.id }] : ['B-13']; }, done: w => { const s = newSub(w, 'org-geranios', 'org-wilber'); return !!s && s.payment.status !== 'NONE'; } },
      { t: 'Wilber revisa su Yape y confirma el pago', dev: 'd1', user: 'u-wilber', s: w => { const s = newSub(w, 'org-geranios', 'org-wilber'); return s ? ['A-14', { id: s.id }] : ['A-12']; }, done: w => newSub(w, 'org-geranios', 'org-wilber')?.payment.status === 'CONFIRMED' },
      { t: 'Wilber prepara, sale y entrega con el código de 4 dígitos', dev: 'd1', user: 'u-wilber', s: w => { const s = newSub(w, 'org-geranios', 'org-wilber'); return s ? ['A-13', { id: s.id }] : ['A-12']; }, done: w => past(newSub(w, 'org-geranios', 'org-wilber'), 'DELIVERED', 'COMPLETED'), hint: 'Sin código no hay entrega (RN-58).' },
      { t: 'Doña Charo revisa el peso y marca «Todo conforme»', dev: 'd2', user: 'u-charo', s: w => { const s = newSub(w, 'org-geranios', 'org-wilber'); return s ? ['B-15', { id: s.id }] : ['B-13']; }, done: w => past(newSub(w, 'org-geranios', 'org-wilber'), 'COMPLETED') },
      { t: 'Los dos se califican: se publican juntas (doble ciego)', dev: 'd2', user: 'u-charo', s: w => { const s = newSub(w, 'org-geranios', 'org-wilber'); return s ? ['B-16', { id: s.id }] : ['B-13']; }, done: w => { const s = newSub(w, 'org-geranios', 'org-wilber'); return !!s?.reviewBuyer && !!s?.reviewSeller; } },
    ],
  },
  {
    id: 'camino', title: 'Un pedido en camino', sub: 'Wilber lleva cebolla a Los Geranios (pedido de ejemplo)',
    steps: [
      { t: 'Doña Charo abre el pedido y ve su código de entrega', dev: 'd2', user: 'u-charo', s: ['B-14', { id: 'so-c03' }] as any, done: w => w.subOrders['so-c03']?.status !== 'IN_TRANSIT' },
      { t: 'Wilber llega, toma la foto y escribe el código que le dictan', dev: 'd1', user: 'u-wilber', s: ['A-15', { id: 'so-c03' }] as any, done: w => ['DELIVERED', 'COMPLETED'].includes(w.subOrders['so-c03']?.status) },
      { t: 'Doña Charo confirma la recepción', dev: 'd2', user: 'u-charo', s: ['B-15', { id: 'so-c03' }] as any, done: w => w.subOrders['so-c03']?.status === 'COMPLETED' },
    ],
  },
  {
    id: 'envio', title: 'Un envío de punta a punta', sub: 'Flujo 10 · Hotel Los Andes, Don Héctor y Julio (Camaná → Arequipa)',
    steps: [
      { t: 'Don Héctor acepta el pedido de frejol del hotel', dev: 'd1', user: 'u-hector', s: ['A-13', { id: 'so-a02' }] as any, done: w => w.subOrders['so-a02']?.status !== 'PENDING_CONFIRMATION' && w.subOrders['so-a02']?.status !== 'EXPIRED' },
      { t: 'Julio recibe la oferta (favorito del hotel) y la acepta', dev: 'd3', user: 'u-julio', s: ['T-09', { id: 'sh-so-a02' }] as any, done: w => !!w.shipments['sh-so-a02']?.carrierOrgId },
      { t: 'Don Héctor prepara y marca la carga lista', dev: 'd1', user: 'u-hector', s: ['A-13', { id: 'so-a02' }] as any, done: w => ['READY', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED'].includes(w.subOrders['so-a02']?.status) },
      { t: 'Julio recoge con el QR, cuenta, pesa y anota las guías', dev: 'd3', user: 'u-julio', s: ['T-12', { id: 'sh-so-a02' }] as any, done: w => ['PICKED_UP', 'ARRIVED', 'DELIVERED', 'CLOSED'].includes(w.shipments['sh-so-a02']?.status) },
      { t: 'Julio llega al hotel (En camino › «Llegué a la entrega»)', dev: 'd3', user: 'u-julio', s: ['T-13', { id: 'sh-so-a02' }] as any, done: w => ['ARRIVED', 'DELIVERED', 'CLOSED'].includes(w.shipments['sh-so-a02']?.status) },
      { t: 'El hotel cuenta y pesa, paga el flete y ve su código', dev: 'd2', user: 'u-andres', s: ['B-32', { id: 'sh-so-a02' }] as any, done: w => !!w.shipments['sh-so-a02']?.buyerPaid || ['DELIVERED', 'CLOSED'].includes(w.shipments['sh-so-a02']?.status), hint: 'Mesagri no cobra el flete: se paga directo (RN-55).' },
      { t: 'Julio escribe el código que le dictan: entrega registrada', dev: 'd3', user: 'u-julio', s: ['T-14', { id: 'sh-so-a02' }] as any, done: w => ['DELIVERED', 'CLOSED'].includes(w.shipments['sh-so-a02']?.status), hint: 'Sin código no hay entrega (RN-58).' },
      { t: 'El hotel califica a Julio y lo recomienda', dev: 'd2', user: 'u-andres', s: ['B-33', { id: 'sh-so-a02' }] as any, done: w => !!w.shipments['sh-so-a02']?.rating },
      { t: 'El hotel da su conformidad del frejol a Don Héctor', dev: 'd2', user: 'u-andres', s: ['B-15', { id: 'so-a02' }] as any, done: w => w.subOrders['so-a02']?.status === 'COMPLETED' },
    ],
  },
  {
    id: 'voz', title: 'Publicar con la voz', sub: 'Flujo 2 · la frase pasa sola a la confirmación (corrige D-04)',
    steps: [
      { t: 'Wilber toca Publicar y dice (o escribe) una frase', dev: 'd1', user: 'u-wilber', s: 'A-10', done: w => newListing(w, 'org-wilber'), hint: 'Prueba «papitas amarillas, dos sacos, a dos setenta el kilo».' },
    ],
  },
  {
    id: 'plan', title: 'Límite del plan Básico', sub: 'Flujo 8 · Doña Charo pasa los S/ 2 500 del mes',
    steps: [
      { t: 'Doña Charo agrega 150 kg de frejol de Don Héctor y confirma', dev: 'd2', user: 'u-charo', s: 'B-05', done: w => w.orgs['org-geranios']?.subscription?.plan !== 'BASICO', hint: 'La hoja «pasa el límite» ofrece Pro o quitar productos.' },
    ],
  },
  {
    id: 'verif', title: 'Revisar un expediente', sub: 'Flujo 5 · Lucía (verificadora) en el panel web',
    steps: [
      { t: 'Lucía abre la bandeja y el expediente de Doña Justina', dev: 'web', user: 'u-lucia', s: 'W-03', done: w => w.orgs['org-justina']?.level >= 2 || w.cases['case-org-justina-2']?.status !== 'IN_REVIEW' },
      { t: 'Aprueba el nivel 2: Justina ya puede tener 30 publicaciones', dev: 'web', user: 'u-lucia', s: ['W-04', { id: 'case-org-justina-2' }] as any, done: w => w.orgs['org-justina']?.level >= 2 },
    ],
  },
  {
    id: 'almacen', title: 'Guardar y vender desde un almacén', sub: 'Flujos 6 y 7 · Wilber y el centro de acopio Yanque',
    steps: [
      { t: 'Wilber calcula si le conviene guardar y reserva espacio', dev: 'd1', user: 'u-wilber', s: 'A-21', done: w => Object.values(w.bookings).some(b => b.farmerOrgId === 'org-wilber' && !seedWorld().bookings[b.id]) },
      { t: 'Elmer (almacén) acepta la reserva en 24 h', dev: 'd3', user: 'u-elmer', s: 'C-07', done: w => Object.values(w.bookings).some(b => b.farmerOrgId === 'org-wilber' && !seedWorld().bookings[b.id] && b.status !== 'PENDING') },
      { t: 'Elmer recibe el lote: peso, calidad y fotos → constancia', dev: 'd3', user: 'u-elmer', s: 'C-06', done: w => Object.values(w.lots).some(l => l.farmerOrgId === 'org-wilber' && !seedWorld().lots[l.id]) },
      { t: 'Wilber publica desde el almacén (lote verificado)', dev: 'd1', user: 'u-wilber', s: 'A-23', done: w => Object.values(w.listings).some(l => l.orgId === 'org-wilber' && !!l.fromLotId && !seedWorld().listings[l.id]) },
    ],
  },
  {
    id: 'reglas', title: 'Reglas corregidas tras la sesión 05', sub: 'D-01, G-01, D-02, D-03 y CU-26',
    steps: [
      { t: 'D-01 · Don Héctor acepta el pedido del hotel: es su venta 5 «sin comisión» y así se cobra aunque otro pedido se complete antes', dev: 'd1', user: 'u-hector', s: ['A-13', { id: 'so-a02' }] as any, done: w => !!w.subOrders['so-a02']?.freeSlotReserved || w.subOrders['so-a02']?.status === 'COMPLETED' },
      { t: 'G-01 · Adelanta 12 h el reloj: un pedido sin respuesta vence solo y libera el stock', dev: 'd1', user: 'u-hector', s: 'A-12', done: w => Object.values(w.subOrders).some(s => s.status === 'EXPIRED') },
      { t: 'D-02 · El efectivo se mide con el envío incluido: S/ 1 995 + S/ 10 de envío ya no se paga en efectivo', dev: 'd2', user: 'u-andres', s: 'B-05', done: () => false, hint: 'Andrés (nivel 2) arma un pedido cercano a S/ 2 000 con envío del agricultor: el efectivo se apaga si el total con envío llega a S/ 2 000.' },
      { t: 'D-03 · Un precio 50 % sobre el sugerido exacto no pide confirmar; más, sí', dev: 'd1', user: 'u-wilber', s: 'A-10', done: () => false },
      { t: 'CU-26 · Dos MYPE piden el último saco a la vez: el sistema deja pasar solo una', dev: 'd2', user: 'u-elena', s: 'B-05', done: () => false, hint: 'Con 2 celulares o con la mesa compartida.' },
    ],
  },
  {
    id: 'senal', title: 'Sin señal', sub: 'RNF-05 · lo que se hace sin señal se envía solo al volver',
    steps: [
      { t: 'Quita la señal al celular de Wilber (ícono de wifi) y registra una entrega o un mensaje', dev: 'd1', user: 'u-wilber', s: 'A-08', done: () => false },
      { t: 'Devuelve la señal: lo pendiente se envía con su clave única, sin duplicarse', dev: 'd1', user: 'u-wilber', s: 'A-08', done: () => false },
    ],
  },
  {
    id: 'cuentas', title: 'Estado de cuenta y cobranza', sub: 'RN-14, RN-40 · comisión de 3 % desde la 6.ª venta',
    steps: [
      { t: 'Wilber ve su estado de cuenta de octubre (S/ 41,40) y lo paga con Yape', dev: 'd1', user: 'u-wilber', s: 'A-26', done: w => w.statements['st-FARMER-org-wilber-2026-10']?.status !== 'ISSUED' },
      { t: 'Carlos concilia el pago en el panel (W-14) y se emite la boleta', dev: 'web', user: 'u-carlos', s: 'W-14', done: w => w.statements['st-FARMER-org-wilber-2026-10']?.status === 'PAID' },
    ],
  },
  {
    id: 'nuevo', title: 'Primer uso de un agricultor', sub: 'Flujo 1 · registro, consentimientos, DNI, cobro y zonas',
    steps: [
      { t: 'En un celular nuevo, elige idioma y «Soy agricultor» y completa los 5 pasos', dev: 'd3', user: '', s: 'A-01', done: w => Object.values(w.users).some(u => u.role === 'FARMER' && !seedWorld().users[u.id]) },
      { t: 'Lucía aprueba su nivel 1 en el panel: ya puede publicar', dev: 'web', user: 'u-lucia', s: 'W-03', done: w => Object.values(w.orgs).some(o => o.type === 'FARMER' && !seedWorld().orgs[o.id] && o.level >= 1) },
    ],
  },
];

export function Guide({ store, ui, onGo, onClose }: { store: Store; ui: UiState; onGo: Go; onClose: () => void }) {
  const w = store.view();
  const [open, setOpen] = useState<string>('compra');
  return (
    <aside className="card" style={{ width: "340px", maxWidth: "100%", alignSelf: "stretch", maxHeight: "calc(100vh - 120px)", overflow: "auto", position: "sticky", top: "76px", fontSize: "14px" }} aria-label="Guía de prueba">
      <div className="row between"><h2 className="h2" style={{ fontSize: "20px" }}>Guía de prueba</h2><button className="iconbtn" onClick={onClose} aria-label="Cerrar la guía"><Icon n="x" s="1.1em" /></button></div>
      <p className="cap" style={{ margin: ".3em 0 .8em" }}>Cada paso se marca solo cuando la demo lo registra. «Ir» abre la persona y la pantalla en el celular indicado.</p>
      <div className="stack tight">
        {FLOWS.map(f => {
          const done = f.steps.filter(s => s.done(w)).length;
          const isOpen = open === f.id;
          return (
            <div key={f.id} className={'card ' + (isOpen ? 'soft' : 'line')} style={{ padding: ".7em .8em" }}>
              <button style={{ display: "flex", width: "100%", gap: ".6em", alignItems: "center", border: "0", background: "transparent", textAlign: "left", padding: "0", minHeight: "2.6em" }} onClick={() => setOpen(isOpen ? '' : f.id)} aria-expanded={isOpen ? 'true' : 'false'}>
                <span className={'icirc ' + (done === f.steps.length ? 'dark' : '')} style={{ width: "2.1em", height: "2.1em" }}>{done === f.steps.length ? <Icon n="check" s="1em" w={3} /> : <b style={{ fontSize: ".85em" }}>{done}/{f.steps.length}</b>}</span>
                <span className="grow"><b style={{ display: "block" }}>{f.title}</b><span className="cap">{f.sub}</span></span>
                <Icon n={isOpen ? 'chevron-up' : 'chevron-down'} s="1.1em" />
              </button>
              {isOpen && (
                <ol style={{ margin: ".6em 0 0", padding: "0", listStyle: "none", display: "flex", flexDirection: "column", gap: ".5em" }}>
                  {f.steps.map((st, i) => {
                    const ok = st.done(w);
                    const target = typeof st.s === 'function' ? st.s(w) : Array.isArray(st.s) ? st.s as any : [st.s];
                    return (
                      <li key={i} className="row top g8">
                        <span className={'icirc ' + (ok ? 'dark' : '')} style={{ width: "1.7em", height: "1.7em", fontSize: ".85em" }}>{ok ? <Icon n="check" s="1em" w={3} /> : i + 1}</span>
                        <div className="grow"><div style={ok ? { color: "var(--moss)" } : undefined}>{st.t}</div>{st.hint && <div className="cap">{st.hint}</div>}</div>
                        <button className="btn xs dark" onClick={() => onGo(st.dev, st.user, target[0], target[1])} disabled={!st.user && st.dev !== 'd3' ? false : false}>Ir</button>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          );
        })}
      </div>
      <p className="cap" style={{ marginTop: ".8em" }}>Consejo: usa «Adelantar» en el reloj para ver vencer los plazos (12 h, 24 h, 48 h, día 1 y día 11).</p>
      <p className="cap">Todo se guarda en MySQL: otros celulares conectados a esta laptop (la app, en la dirección sola) y el panel (/panel) ven los cambios en vivo.</p>
    </aside>
  );
}
