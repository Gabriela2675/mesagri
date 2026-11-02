/*
 * Mesagri · MVP · Tipos del dominio
 * Equivalen, simplificados, a las tablas de la sección 13 del documento de diseño v5.
 * Todo vive en un "mundo" que se reconstruye aplicando eventos en orden (ver engine.ts).
 */

export type Lang = 'es' | 'qu' | 'ay';
export type Role = 'FARMER' | 'BUYER' | 'CARRIER' | 'WAREHOUSE' | 'ADMIN';
export type AdminRole = 'GENERAL' | 'VERIFIER' | 'SUPPORT' | 'ANALYST';
export type OrgType = 'FARMER' | 'BUYER' | 'CARRIER' | 'WAREHOUSE' | 'MESAGRI';

/** Régimen del vendedor: decide qué comprobante puede dar (RN-34, RF-CAT-15). */
export type TaxRegime = 'SIN_RUC' | 'NRUS' | 'RER' | 'GENERAL';
export type TaxDocType = 'BOLETA' | 'FACTURA' | 'LIQUIDACION';
export type PayMethod = 'YAPE' | 'PLIN' | 'TRANSFER' | 'CASH' | 'CARD';
export type DeliveryMode = 'PICKUP' | 'FARMER' | 'CARRIER';
export type Unit = 'kg' | 'saco' | 'arroba' | 'jaba' | 'atado';
export type Quality = 'PRIMERA' | 'SEGUNDA' | 'TERCERA';

export interface Prefs {
  lang: Lang;
  audioGuide: boolean;
  bilingual: boolean;
  textScale: 1 | 1.25 | 1.5;
  dataSaver: boolean;
  numFmt: 'coma' | 'punto';
}

export interface User {
  id: string;
  name: string;
  shortName: string;
  phone: string;
  role: Role;
  adminRole?: AdminRole;
  orgId: string;
  dni?: string;
  email?: string;
  createdAt: number;
  prefs: Prefs;
  consents?: { version: string; at: number; items: Record<string, boolean> };
  /** Persona de ejemplo del documento (sección 5): se muestra en el selector de la demo. */
  persona?: string;
  title?: string;
  status: 'ACTIVE' | 'SUSPENDED';
}

export interface PayoutAccount {
  id: string;
  kind: 'YAPE' | 'PLIN' | 'BANK';
  number: string;       // número o CCI (en la demo se muestra completo solo al comprador con pedido confirmado)
  holder: string;
  relation: 'PROPIA' | 'FAMILIAR' | 'ASOCIACION';
  authorization?: string; // texto de la autorización expresa (RN-28)
  verified: boolean;
}

export interface ServiceArea {
  district: string;     // código de distrito (ubigeo.ts)
  fee: number;          // costo de envío del agricultor a esa zona (0 = incluido)
}

export interface DocItem {
  kind: string;          // SOAT, CITV, LICENCIA, TUC, ITSE, FUMIGACION, ...
  label: string;
  number?: string;
  expiresOn?: number;    // fecha de vencimiento (ms)
  status: 'OK' | 'PENDING' | 'OBSERVED' | 'MISSING';
  note?: string;
}

export interface Subscription {
  plan: 'BASICO' | 'PRO' | 'EMPRESA';
  status: 'TRIAL' | 'ACTIVE' | 'GRACE' | 'INACTIVE';
  trialEndsOn: number;
  paidUntil: number;     // fin del periodo pagado (o de la prueba)
  graceUntil?: number;
  monthsBelow: number;   // meses seguidos por debajo del límite del plan inferior (RN-38)
  history: { at: number; text: string }[];
}

export interface Vehicle {
  plate: string;
  vclass: 'V1' | 'V2' | 'V3';
  category: 'L3' | 'N1' | 'N2';
  body: string;          // furgón cerrado, camioneta con toldo, cajuela...
  payloadKg: number;
  year: number;
  docs: DocItem[];
}

export interface CarrierRoute {
  routeId: string;       // shipping route id (settings)
  days: number[];        // 1 = lunes ... 7 = domingo
  departs: string;       // '15:00'
  arrives: string;       // '18:30'
}

export interface CarrierInfo {
  level: 'T0' | 'T1' | 'T2' | 'T3';
  available: boolean;
  vehicle: Vehicle;
  driverLicense: { cls: 'B-IIb' | 'A-I' | 'A-IIb'; expiresOn: number };
  routes: CarrierRoute[];
  training: { done: number; total: number };
  inspection?: { at: number; score: number; criticalFails: number; by: string; checklist: Record<string, boolean> };
  agreementSigned: boolean;
  insurance: boolean;
  noShows: number;
}

export interface StorageRate { productId: string; perSackMonth: number }

export interface WarehouseInfo {
  level: 'A0' | 'A1' | 'A2' | 'A3';
  facilityType: 'MOLINO' | 'SECO' | 'ACOPIO';
  capacitySacks: number;
  rates: StorageRate[];
  defaultRate: number;
  products: string[];
  services: string[];
  optional: { label: string; price: number }[];
  docs: DocItem[];
  visit?: { at: number; score: number; criticalFails: number; by: string };
  visitScheduled?: number;
  agreementSigned: boolean;
  location: string;      // distrito
  geo: { x: number; y: number }; // posición en el mapa esquemático
}

export interface Org {
  id: string;
  type: OrgType;
  name: string;                // nombre comercial o de la persona
  legalName?: string;          // razón social
  ruc?: string;
  dni?: string;
  district: string;
  province: string;
  address?: string;
  receiver?: string;           // quien recibe (comprador)
  businessType?: 'RESTAURANTE' | 'HOTEL' | 'BODEGA' | 'COMEDOR';
  level: number;               // 0 a 3 (agricultor y comprador)
  status: 'ACTIVE' | 'SUSPENDED';
  suspendedReason?: string;
  createdAt: number;
  taxRegime?: TaxRegime;
  payout: PayoutAccount[];
  acceptsCash: boolean;
  serviceAreas: ServiceArea[];
  deliveryDays: number[];
  pickupPoint?: string;
  memberIds: string[];
  subscription?: Subscription;
  carrier?: CarrierInfo;
  warehouse?: WarehouseInfo;
  /** contadores para reputación, comisión y alertas */
  counters: {
    completedSales: number;     // ventas conformes (agricultor) · base de la comisión (RN-14)
    freeSalesUsed: number;      // cuántas de las 5 sin comisión ya se usaron
    completedPurchases: number; // compras conformes (comprador)
    lateCancels: number;
    sellerCancels: number;
    expiredOrders: number;
    responseMinutesTotal: number;
    responses: number;
    onTime: number;
    deliveries: number;
    disputesLost: number;
  };
  initials: string;
  color: string;
  /** reputación importada de antes del piloto (se suma a las calificaciones de la app) */
  seedRating?: { avg: number; count: number };
  /** historial del transportista de antes del piloto */
  seedCarrier?: { rating: number; count: number; punctuality: number; care: number; treatment: number; onTimePct: number; shipments: number; recommends: number };
  /** personas que actúan por la cuenta además del titular: equipo de la MYPE (B-23) o quien publica por el agricultor (A-28) */
  members?: OrgMember[];
  /** locales de entrega de la MYPE (B-23): hasta 1 en Básico, 3 en Pro */
  locales?: Local[];
}

/* ---------- Equipo, locales y quién publica por mí (R2) ---------- */
export type MemberPerm = 'PEDIR' | 'APROBAR' | 'PAGAR' | 'PUBLICAR' | 'PEDIDOS';
export interface OrgMember {
  userId: string;
  kind: 'EQUIPO' | 'FAMILIAR' | 'PROMOTOR' | 'CONDUCTOR';
  perms: MemberPerm[];
  active: boolean;
  addedAt: number;
  addedBy: string;
  note?: string;              // cargo o parentesco («cocina», «hija»)
}
export interface Local {
  id: string;
  name: string;
  district: string;
  address: string;
  receiver: string;
  days: number[];             // días en que recibe (1 = lunes … 7 = domingo)
  isDefault: boolean;
}

/* ---------- Solicitudes de compra: la MYPE pide y los agricultores ofertan (RF-ORD-09) ---------- */
export interface RequestOffer {
  id: string;
  sellerOrgId: string;
  userId: string;
  pricePerKg: number;
  kg: number;
  harvestDate?: number;
  quality: Quality;
  note?: string;
  at: number;
  status: 'SENT' | 'ACCEPTED' | 'REJECTED' | 'WITHDRAWN';
  listingId?: string;         // publicación que se crea al aceptarla
}
export interface PurchaseRequest {
  id: string;
  code: string;               // SOL-0012
  buyerOrgId: string;
  buyerUserId: string;
  productId: string;
  kg: number;
  maxPricePerKg?: number;
  neededOn: number;           // día de entrega (inicio del día, hora de Lima)
  district: string;
  address?: string;
  localId?: string;
  note?: string;
  createdAt: number;
  closesAt: number;           // hasta cuándo recibe ofertas
  status: 'OPEN' | 'AWARDED' | 'CLOSED' | 'EXPIRED';
  offers: RequestOffer[];
  awardedOfferId?: string;
  subOrderId?: string;
  closedAt?: number;
}

/* ---------- Pedidos programados del plan Pro (RF-ORD-10) ---------- */
export interface ScheduleItem { productId: string; sellerOrgId: string; listingId?: string; qty: number; unit: Unit; unitKg: number; refPrice: number }
export interface ScheduleLine {
  productId: string;
  sellerOrgId: string;
  listingId?: string;
  qty: number;
  unit: Unit;
  price?: number;
  ok: boolean;
  reason?: string;
  alt?: { listingId: string; sellerOrgId: string; price: number };
}
export interface Schedule {
  id: string;
  code: string;               // PRG-0003
  buyerOrgId: string;
  createdBy: string;
  name: string;
  items: ScheduleItem[];
  frequency: 'SEMANAL' | 'QUINCENAL' | 'MENSUAL';
  weekday: number;            // día de entrega: 1 = lunes … 7 = domingo
  deliveryMode: DeliveryMode;
  payMethod: PayMethod;
  taxDoc: TaxDocType;
  slot: string;
  localId?: string;
  maxIncrease: number;        // 0.10 = se pide solo si el precio no sube más de 10 %
  nextDelivery: number;       // próxima entrega
  active: boolean;
  createdAt: number;
  draft?: { at: number; deliveryDate: number; lines: ScheduleLine[]; total: number; status: 'PENDING' | 'APPROVED' | 'SKIPPED' | 'EXPIRED'; orderId?: string };
  history: { at: number; text: string; orderId?: string }[];
}

export interface Farm {
  id: string;
  orgId: string;
  name: string;
  district: string;
  areaHa: number;
  tenure: 'PROPIA' | 'COMUNAL' | 'ALQUILADA';
  crops: string[];
  gps: 'APP' | 'MANUAL';
  photos: string[];
  createdAt: number;
}

export type CaseStatus = 'SUBMITTED' | 'IN_REVIEW' | 'NEEDS_INFO' | 'APPROVED' | 'REJECTED' | 'APPEALED';
export interface Evidence { key: string; label: string; detail?: string; photoId?: string; ok?: boolean }
export interface VerifCase {
  id: string;
  orgId: string;
  kind: 'FARMER' | 'BUYER' | 'CARRIER' | 'WAREHOUSE';
  targetLevel: number;           // nivel que pide (para T y A: 1 = T1/A1, 2 = T2/A2)
  status: CaseStatus;
  submittedAt: number;
  assignedTo?: string;
  evidence: Evidence[];
  alerts: string[];
  history: { at: number; by: string; text: string }[];
  decision?: { by: string; at: number; result: 'APPROVE' | 'NEEDS_INFO' | 'REJECT'; reason: string };
  appealed?: boolean;
}

export type ListingStatus = 'ACTIVE' | 'PAUSED' | 'SOLD_OUT' | 'EXPIRED' | 'IN_REVIEW' | 'REJECTED' | 'REMOVED' | 'QUEUED';
export interface Listing {
  id: string;
  orgId: string;
  productId: string;
  variety?: string;
  unit: Unit;
  unitKg: number;              // kilos por unidad de venta (1 si es kg)
  qtyTotal: number;            // en unidades de venta
  available: number;           // disponible para pedir
  reserved: number;            // reservado por pedidos en curso
  sold: number;
  price: number;               // S/ por unidad de venta (RN-06)
  harvestDate: number;
  quality: Quality;
  farmId?: string;
  photoIds: string[];
  harvestSeal: boolean;        // sello «cosechado hoy» (RN-22)
  status: ListingStatus;
  reviewReason?: string;
  createdAt: number;
  expiresAt: number;
  minQty: number;
  fromLotId?: string;          // lote verificado en almacén (RF-STO-12)
  tiers?: { minKg: number; price: number }[];
  /** por qué pasa por revisión (precio fuera de rango, agricultor de nivel 1) */
  flags?: string[];
  /** publicación que nace de una oferta aceptada en una solicitud de compra (RF-ORD-09) */
  requestId?: string;
}

export interface Movement { at: number; listingId: string; kind: 'INIT' | 'RESERVE' | 'RELEASE' | 'CONSUME' | 'ADJUST'; qty: number; ref?: string }

export type SubStatus =
  | 'PENDING_CONFIRMATION' | 'CONFIRMED' | 'AWAITING_HARVEST' | 'PREPARING' | 'READY' | 'IN_TRANSIT'
  | 'DELIVERED' | 'COMPLETED' | 'DISPUTED' | 'REJECTED' | 'EXPIRED' | 'CANCELLED_BY_BUYER' | 'CANCELLED_BY_SELLER';

export interface SubItem {
  listingId: string;
  productId: string;
  name: string;
  unit: Unit;
  unitKg: number;
  qty: number;
  price: number;
  subtotal: number;
  acceptedQty?: number;
  quality?: 'OK' | 'FAIL';
}

export interface Payment {
  status: 'NONE' | 'UPLOADED' | 'CONFIRMED' | 'NOT_RECEIVED';
  method: PayMethod;
  operation?: string;
  amount?: number;
  paidAt?: number;
  photoId?: string;
  uploadedAt?: number;
  confirmedAt?: number;
}

export interface SubOrder {
  id: string;
  code: string;                // CAMP-7F2K91
  orderId: string;
  buyerOrgId: string;
  sellerOrgId: string;
  buyerUserId: string;
  items: SubItem[];
  subtotal: number;
  deliveryMode: DeliveryMode;
  deliveryFee: number;         // costo del envío del agricultor (no del transportista)
  total: number;               // subtotal + envío del agricultor
  deliveryDate: number;
  slot: string;
  address: string;
  district: string;
  taxDoc: TaxDocType;
  taxDocNumber?: string;
  prepay: boolean;             // pago antes de preparar (comprador nivel 1, RN-24)
  status: SubStatus;
  history: { status: SubStatus; at: number; by?: string; note?: string }[];
  createdAt: number;
  confirmBy: number;           // plazo para aceptar (RN-08)
  respondedAt?: number;
  deliveredAt?: number;
  completedAt?: number;
  deliveryCode: string;        // código de 4 dígitos que dicta el comprador (en producción solo su huella)
  pickupCode?: string;         // código de recojo (modo PICKUP)
  pickupQr: string;            // QR que el agricultor muestra al transportista
  codeTries: number;
  payment: Payment;
  /** comisión: tasa congelada al crear (RN-14) y cupo sin comisión reservado al aceptar (corrige D-01) */
  commissionRate: number;
  freeSlotReserved: boolean;
  saleNumber?: number;
  commission?: number;
  saleAmount?: number;
  freeSaleBonus?: boolean;
  rejectReason?: string;
  cancelReason?: string;
  lateCancel?: boolean;
  disputeId?: string;
  shipmentId?: string;
  reviewBuyer?: string;        // id de review hecha por el comprador
  reviewSeller?: string;
  onTime?: boolean;
  deliveryPhotoId?: string;
  receiptPhotoIds?: string[];
  fromLot?: boolean;
}

export interface Order {
  id: string;
  buyerOrgId: string;
  buyerUserId: string;
  createdAt: number;
  subOrderIds: string[];
  total: number;
}

export interface Message {
  id: string;
  conv: string;
  from: string;               // userId
  text: string;
  quick?: string;             // clave de respuesta rápida
  at: number;
}

export interface Review {
  id: string;
  subOrderId: string;
  fromOrg: string;
  toOrg: string;
  side: 'BUYER' | 'SELLER';
  stars: number;
  tags: string[];
  comment?: string;
  at: number;
  published: boolean;
  reply?: string;
}

export interface Dispute {
  id: string;
  code: string;               // DSP-0031
  subOrderId: string;
  openedBy: string;           // orgId
  kind: 'CANTIDAD' | 'CALIDAD' | 'NO_LLEGO' | 'PAGO_NO_RECIBIDO' | 'OTRO';
  description: string;
  photoIds: string[];
  status: 'OPEN' | 'PROPOSED' | 'RESOLVED';
  openedAt: number;
  proposal?: { refund: number; note: string; by: string; at: number };
  resolution?: { outcome: 'FAVOR_COMPRADOR' | 'FAVOR_AGRICULTOR' | 'ACUERDO'; refund: number; note: string; by: string; at: number };
  assignedTo?: string;
}

export interface Complaint {
  id: string;
  number: string;             // 000231 (correlativo, RN-20)
  type: 'RECLAMO' | 'QUEJA';
  orgId: string;
  userId: string;
  related: string;
  amount?: number;
  detail: string;
  request: string;
  at: number;
  dueAt: number;              // 15 días hábiles
  status: 'OPEN' | 'ANSWERED';
  answer?: string;
  answeredAt?: number;
  answeredBy?: string;
}

export interface Ticket { id: string; code: string; orgId: string; userId: string; topic: string; text: string; at: number; status: 'OPEN' | 'CLOSED'; replies: { by: string; text: string; at: number }[] }

export interface Notif {
  id: string;
  to: string;                 // orgId (o 'ADMIN')
  at: number;
  kind: 'ORDER' | 'PAYMENT' | 'DELIVERY' | 'VERIFICATION' | 'BILLING' | 'STORAGE' | 'SHIPMENT' | 'REVIEW' | 'SYSTEM' | 'PRICE';
  title: string;
  body: string;
  link?: { screen: string; params?: Record<string, string> };
  /** correlativo global (orden en la base) */
  seq?: number;
}

export interface AuditEntry {
  id: string;
  at: number;
  actor: string;              // userId
  action: string;
  entity: string;
  detail: string;
  before?: string;
  after?: string;
  seq?: number;
}

export type StatementKind = 'FARMER' | 'WAREHOUSE' | 'CARRIER';
export interface StatementItem { id: string; ref: string; label: string; base: number; rate: number; amount: number; voided?: boolean; voidReason?: string; saleNumber?: number }
export interface Statement {
  id: string;
  code: string;
  orgId: string;
  kind: StatementKind;
  period: string;             // '2026-10'
  items: StatementItem[];
  base: number;               // ventas, alquiler o fletes del mes
  total: number;
  issuedAt: number;
  dueAt: number;
  status: 'ISSUED' | 'PAYMENT_REGISTERED' | 'PAID' | 'OVERDUE' | 'VOID';
  payment?: { method: PayMethod; operation: string; at: number };
  receiptNumber?: string;     // boleta o factura de Mesagri
  claim?: { itemId: string; reason: string; at: number; status: 'OPEN' | 'ACCEPTED' | 'REJECTED' };
  reconcileNote?: string;
}

export interface SubInvoice {
  id: string;
  orgId: string;
  period: string;
  plan: 'BASICO' | 'PRO' | 'EMPRESA';
  concept: string;
  amount: number;
  issuedAt: number;
  dueAt: number;
  status: 'ISSUED' | 'PAID' | 'RECONCILED' | 'VOID';
  payment?: { method: PayMethod; operation: string; at: number };
  receiptNumber?: string;
}

export interface SettingProposal {
  id: string;
  key: string;
  label: string;
  from: number | string;
  to: number | string;
  reason: string;
  proposedBy: string;
  proposedAt: number;
  effectiveFrom: number;
  status: 'PENDING' | 'APPROVED' | 'APPLIED' | 'REJECTED';
  approvedBy?: string;
  decidedAt?: number;
  rejectReason?: string;
}

export type ShipStatus =
  | 'WAITING_FARMER' | 'OFFERING' | 'ASSIGNED' | 'GOING_TO_PICKUP' | 'PICKED_UP' | 'ARRIVED'
  | 'DELIVERED' | 'CLOSED' | 'NO_CARRIER' | 'CANCELLED';

export interface ShipOffer { carrierOrgId: string; sentAt: number; expiresAt: number; response?: 'ACCEPTED' | 'REJECTED' | 'EXPIRED'; respondedAt?: number; reason?: string }
export interface ShipEvent { kind: string; at: number; text: string; by?: string }
export interface Shipment {
  id: string;
  code: string;               // ENV-0032
  subOrderId: string;
  buyerOrgId: string;
  sellerOrgId: string;
  routeId: string;
  scope: 'RUTA' | 'CIUDAD';
  originLabel: string;
  destLabel: string;
  distanceKm: number;
  weightKg: number;
  sacks: number;
  cargoValue: number;
  freight: number;            // congelado al pedir (RN-54)
  commissionRate: number;     // 10 % (RN-63)
  preferredCarrier?: string;
  status: ShipStatus;
  requestedAt: number;
  offeringSince?: number;
  offers: ShipOffer[];
  carrierOrgId?: string;
  pickupAt: number;
  deliverFrom: number;
  deliverTo: number;
  events: ShipEvent[];
  pickup?: { at: number; sacks: number; kg: number; photoIds: string[]; waybillSender: string; waybillCarrier: string; qrOk: boolean };
  delivery?: { at: number; sacks: number; kg: number; photoIds: string[]; method: PayMethod; collected: boolean };
  buyerPaid?: { method: PayMethod; at: number };
  incidents: { id: string; kind: string; at: number; text: string; newEta?: string; where?: string; photoIds: string[] }[];
  claim?: { at: number; kind: string; kgLost: number; text: string; status: 'OPEN' | 'RESPONDED' | 'RESOLVED'; response?: string; compensation?: number; resolution?: string };
  rating?: { punctuality: number; care: number; treatment: number; tags: string[]; recommends: boolean; comment?: string; at: number; reply?: string };
  falseFreight?: number;
  cancelReason?: string;
  releaseOrderId?: string;    // si sale de un almacén aliado
  onTime?: boolean;
  closedAt?: number;
}

export interface Booking {
  id: string;
  code: string;               // R-0203
  facilityOrgId: string;
  farmerOrgId: string;
  productId: string;
  sacks: number;
  kgPerSack: number;
  months: number;
  arrivalDate: number;
  rate: number;               // S/ por saco al mes, congelada (RN-43)
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED' | 'RECEIVED' | 'CANCELLED' | 'LAPSED';
  createdAt: number;
  respondedAt?: number;
  rejectReason?: string;
  qr: string;
}

export interface Lot {
  id: string;
  code: string;               // ALM-2026-0042
  bookingId: string;
  facilityOrgId: string;
  farmerOrgId: string;
  productId: string;
  declaredKg: number;
  weightKg: number;
  balanceKg: number;
  sacks: number;
  balanceSacks: number;
  quality: 'A' | 'B' | 'C';
  photoIds: string[];
  intakeAt: number;
  expiresOn: number;
  rate: number;
  status: 'WAITING_FARMER' | 'IN_DEPOSIT' | 'FOR_SALE' | 'CLOSED' | 'DISPUTE' | 'RETURNED';
  listingId?: string;
  receiptCode?: string;
  rated?: boolean;
  rentCollected?: number;     // alquiler cobrado por el almacén
}

export interface ReleaseOrder {
  id: string;
  code: string;               // OS-0201
  lotId: string;
  sacks: number;
  kg: number;
  picker: 'FARMER' | 'BUYER' | 'CARRIER';
  pickerName: string;
  subOrderId?: string;
  rentAmount: number;
  rentDeclaredAt?: number;
  rentPaidAt?: number;         // confirmado por el almacén (RN-46)
  expiresAt?: number;
  status: 'WAITING_RENT' | 'ACTIVE' | 'USED' | 'EXPIRED';
  usedAt?: number;
  kgOut?: number;
  createdAt: number;
}

export interface StoIncident { id: string; code: string; lotId: string; kind: string; kgNow: number; diffKg: number; diffPct: number; overTolerance: boolean; at: number; status: 'OPEN' | 'CLOSED'; note?: string }

export interface TranslationEntry { text: string; status: 'MACHINE_DRAFT' | 'DRAFT' | 'REVIEWED' | 'APPROVED'; by?: string; at?: number }

export interface World {
  version: number;
  t0: number;
  now: number;
  seq: Record<string, number>;
  settings: import('./settings').Settings;
  proposals: Record<string, SettingProposal>;
  users: Record<string, User>;
  orgs: Record<string, Org>;
  farms: Record<string, Farm>;
  cases: Record<string, VerifCase>;
  listings: Record<string, Listing>;
  movements: Movement[];
  orders: Record<string, Order>;
  subOrders: Record<string, SubOrder>;
  usedOps: Record<string, string>;
  messages: Record<string, Message[]>;
  reviews: Record<string, Review>;
  disputes: Record<string, Dispute>;
  complaints: Record<string, Complaint>;
  tickets: Record<string, Ticket>;
  notifs: Notif[];
  audit: AuditEntry[];
  statements: Record<string, Statement>;
  invoices: Record<string, SubInvoice>;
  shipments: Record<string, Shipment>;
  bookings: Record<string, Booking>;
  lots: Record<string, Lot>;
  releases: Record<string, ReleaseOrder>;
  stoIncidents: Record<string, StoIncident>;
  translations: Record<string, Partial<Record<Lang, TranslationEntry>>>;
  favorites: Record<string, { listings: string[]; sellers: string[]; carriers: string[] }>;
  rejected: Record<string, { code: string; message: string; type: string; actor: string }>;
  lastMonthClosed: string;
  monthlyGmv: Record<string, number>;
  /** desfase del reloj de la demo (suma de los «adelantar el tiempo») */
  clockOffset: number;
  /** padrón reducido de la SUNAT de prueba (RF-VER-03) */
  padron: Record<string, { name: string; estado: 'ACTIVO' | 'BAJA'; condicion: 'HABIDO' | 'NO HABIDO'; district: string }>;
  /** solicitudes de compra de las MYPE (R2) */
  requests: Record<string, PurchaseRequest>;
  /** pedidos programados (plan Pro, R2) */
  schedules: Record<string, Schedule>;
  /** productos que el equipo agregó al catálogo maestro (W-09) */
  catalogExtra: Record<string, import('./catalog').Product>;
}

/** Un evento: lo único que se guarda. El mundo se reconstruye aplicándolos en orden. */
export interface MEvent {
  id: string;
  type: string;
  actor: string;              // userId ('system' para la semilla)
  t: number;                  // hora simulada en que se creó
  lamport: number;
  device?: string;
  p: any;                     // carga útil (payload)
}
