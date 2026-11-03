/*
 * Identidad (nivel 1 de verificación): el DNI con su dígito de verificación, el nombre como figura
 * en RENIEC, las fotos del DNI (frente y reverso) y del rostro en tres ángulos (de frente, girando a
 * su derecha y a su izquierda). Reglas puras: las usan el celular al tomar los datos, el panel al
 * revisarlos y el servidor al consultar el DNI.
 *
 * - El dígito de verificación del DNI es el que va después del guion, al lado del número.
 * - El código de abajo del reverso del DNI (MRZ, norma ICAO 9303, formato TD1) trae el número, los
 *   nombres, la fecha de nacimiento y el vencimiento, cada uno con su dígito de control: si los
 *   dígitos cuadran, la lectura es confiable.
 * - El ángulo del rostro (yaw) va en grados: positivo cuando la nariz se ve hacia la derecha de la
 *   foto sin espejo, es decir, cuando la persona giró hacia SU izquierda.
 */
import type { CaseIdentity, DocReview, Evidence, FacePose, FaceShot, RegistryCheck } from './types';

/* ---------- DNI ---------- */
const DNI_W = [3, 2, 7, 6, 5, 4, 3, 2];
const DNI_NUM = '67890112345';
const DNI_LET = 'KABCDEFGHIJ';

/** Dígito de verificación del DNI (número; algunos documentos usan la letra equivalente). */
export function dniCheck(dni: string): { num: string; letter: string } | null {
  if (!/^\d{8}$/.test(String(dni ?? ''))) return null;
  let s = 0;
  for (let i = 0; i < 8; i++) s += Number(dni[i]) * DNI_W[i];
  const k = 11 - (s % 11);
  const i = k === 11 ? 0 : k;
  return { num: DNI_NUM[i], letter: DNI_LET[i] };
}
/** ¿El dígito escrito corresponde al número? null si no se escribió. */
export function dniDigitOk(dni: string, digit?: string | null): boolean | null {
  const d = String(digit ?? '').trim().toUpperCase();
  if (!d) return null;
  const c = dniCheck(dni);
  if (!c) return false;
  return d === c.num || d === c.letter;
}

/* ---------- Nombres ---------- */
const PARTICLES = new Set(['DE', 'DEL', 'LA', 'LAS', 'LOS', 'Y', 'VDA', 'VIUDA']);
/** Mayúsculas, sin tildes (la Ñ queda como N), solo letras y espacios. */
export function normName(s: string): string {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
export const nameTokens = (s: string) => normName(s).split(' ').filter(t => t && !PARTICLES.has(t));
function lev(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const d = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0];
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return d[b.length];
}
/** Misma palabra, perdonando una letra en palabras largas (un error al escribir). */
const sameWord = (a: string, b: string) => a === b || (a.length >= 5 && b.length >= 5 && lev(a, b) <= 1);

export interface OfficialName { surnames: string; given: string }
export const officialFull = (o: OfficialName) => normName(`${o.given} ${o.surnames}`);

/**
 * Compara el nombre escrito con el oficial (el orden no importa).
 * MATCH: las mismas palabras. PARTIAL: no inventa palabras y tiene el primer apellido y el primer
 * nombre (le falta un segundo nombre o el segundo apellido). MISMATCH: lo demás.
 */
export function compareNames(declared: string, official: OfficialName | string): { status: 'MATCH' | 'PARTIAL' | 'MISMATCH'; score: number } {
  const D = nameTokens(declared);
  const O = typeof official === 'string' ? nameTokens(official) : [...nameTokens(official.given), ...nameTokens(official.surnames)];
  if (!D.length || !O.length) return { status: 'MISMATCH', score: 0 };
  const left = [...O];
  let hits = 0;
  const extra: string[] = [];
  for (const t of D) {
    const i = left.findIndex(o => sameWord(t, o));
    if (i >= 0) { hits++; left.splice(i, 1); } else extra.push(t);
  }
  const score = Math.round((hits / Math.max(D.length, O.length)) * 100) / 100;
  if (!extra.length && !left.length) return { status: 'MATCH', score };
  if (!extra.length && hits >= 2) {
    if (typeof official === 'string') return { status: 'PARTIAL', score };
    const g = nameTokens(official.given)[0], s = nameTokens(official.surnames)[0];
    if (!g || !s) return { status: 'PARTIAL', score };
    if (D.some(t => sameWord(t, g)) && D.some(t => sameWord(t, s))) return { status: 'PARTIAL', score };
  }
  return { status: 'MISMATCH', score };
}

/* ---------- Código de abajo del reverso del DNI (MRZ, TD1: 3 líneas de 30) ---------- */
const mrzVal = (c: string) => (c === '<' ? 0 : c >= '0' && c <= '9' ? c.charCodeAt(0) - 48 : c.charCodeAt(0) - 55);
/** Dígito de control ICAO (pesos 7, 3, 1). */
export function mrzDigit(s: string): string {
  const w = [7, 3, 1];
  let t = 0;
  for (let i = 0; i < s.length; i++) t += mrzVal(s[i]) * w[i % 3];
  return String(t % 10);
}
// confusiones típicas al leer una foto: en campos de números, letras que parecen números, y al revés
const TO_DIGIT: Record<string, string> = { O: '0', Q: '0', D: '0', U: '0', I: '1', L: '1', T: '7', Z: '2', S: '5', G: '6', B: '8', A: '4' };
const TO_ALPHA: Record<string, string> = { '0': 'O', '1': 'I', '2': 'Z', '4': 'A', '5': 'S', '6': 'G', '7': 'T', '8': 'B' };
const asDigits = (s: string) => s.split('').map(c => TO_DIGIT[c] ?? c).join('');
const asAlpha = (s: string) => s.split('').map(c => TO_ALPHA[c] ?? c).join('');

export interface MrzRead {
  lines: [string, string, string];
  dni: string;
  /** El 9.º carácter del número de documento (dígito de verificación del DNI o «<»). */
  ninth: string;
  docOk: boolean;
  birth: string;
  birthOk: boolean;
  sex: string;
  expiry: string;
  expiryOk: boolean;
  nationality: string;
  compositeOk: boolean;
  surnames: string[];
  given: string[];
  /** Todos los dígitos de control cuadran. */
  ok: boolean;
}

/** Limpia una línea leída: mayúsculas, sin espacios, solo A-Z, 0-9 y «<». */
function cleanLine(l: string): string {
  return l.toUpperCase().replace(/[«‹(\[{]/g, '<').replace(/\s+/g, '').replace(/[^A-Z0-9<]/g, '');
}

/** Lee las 3 líneas del código (las busca en el texto que devuelve el lector de texto). */
export function parseMrz(text: string): MrzRead | null {
  const cand = String(text ?? '').split(/\r?\n/).map(cleanLine).filter(l => l.length >= 24);
  const i1 = cand.findIndex(l => /^[I1][A-Z0-9<]P[E3]R/.test(l) || /^I<PER/.test(l));
  if (i1 < 0 || i1 + 2 >= cand.length) return null;
  const raw1 = cand[i1], raw2 = cand[i1 + 1], raw3 = cand[i1 + 2];
  const l1 = (raw1 + '<'.repeat(30)).slice(0, 30);
  // línea 2: los primeros 18 son fijos; el último carácter es el dígito compuesto aunque falte o sobre un «<» en el medio
  const comp = raw2[raw2.length - 1];
  const l2 = (raw2.slice(0, 18) + (raw2.slice(18, -1) + '<'.repeat(11)).slice(0, 11) + comp).slice(0, 30);
  const l3 = (raw3 + '<'.repeat(30)).slice(0, 30);
  const dni = asDigits(l1.slice(5, 13));
  const docCheck = asDigits(l1[14]);
  // el 9.º carácter del número: un dígito (verificación del DNI) o «<» (a veces se lee como K o C)
  const ninthRaw = l1[13];
  const ninthOpts = [...new Set([ninthRaw, asDigits(ninthRaw), '<'])];
  const ninth = ninthOpts.find(n => mrzDigit(dni + n) === docCheck) ?? ninthRaw;
  const docOk = mrzDigit(dni + ninth) === docCheck && /^\d{8}$/.test(dni);
  const birth = asDigits(l2.slice(0, 6)), expiry = asDigits(l2.slice(8, 14));
  const birthOk = /^\d{6}$/.test(birth) && mrzDigit(birth) === asDigits(l2[6]);
  const expiryOk = /^\d{6}$/.test(expiry) && mrzDigit(expiry) === asDigits(l2[14]);
  const sexRaw = l2[7];
  const sex = sexRaw === 'M' || sexRaw === 'H' ? 'M' : sexRaw === 'F' || sexRaw === 'E' ? 'F' : '<';
  const nationality = asAlpha(l2.slice(15, 18));
  const opt1 = l1.slice(15, 30), opt2 = l2.slice(18, 29);
  const compositeOk = mrzDigit(dni + ninth + docCheck + opt1 + birth + asDigits(l2[6]) + expiry + asDigits(l2[14]) + opt2) === asDigits(l2[29]);
  // nombres: APELLIDO1<APELLIDO2<<NOMBRE1<NOMBRE2; en el Perú la Ñ va como NXX
  const names = asAlpha(l3).replace(/NXX/g, 'Ñ').replace(/<+$/, '');
  const [sur, giv = ''] = names.split(/<<+/);
  const words = (s: string) => s.split('<').map(w => w.trim()).filter(Boolean);
  const ok = docOk && birthOk && expiryOk && compositeOk;
  return { lines: [l1, l2, l3], dni, ninth: ninth === '<' ? '' : ninth, docOk, birth, birthOk, sex, expiry, expiryOk, nationality, compositeOk, surnames: words(sur ?? ''), given: words(giv), ok };
}

/** Fecha de una línea MRZ (AAMMDD). Nacimiento: siglo pasado si el año todavía no llega; vencimiento: siempre 20xx. */
export function mrzDate(yymmdd: string, kind: 'birth' | 'expiry', now = Date.now()): string | undefined {
  if (!/^\d{6}$/.test(yymmdd)) return undefined;
  const yy = Number(yymmdd.slice(0, 2)), mm = Number(yymmdd.slice(2, 4)), dd = Number(yymmdd.slice(4, 6));
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return undefined;
  const cur = new Date(now).getUTCFullYear() % 100;
  const year = kind === 'expiry' ? 2000 + yy : yy > cur ? 1900 + yy : 2000 + yy;
  return `${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}
/** Años cumplidos a la fecha (fecha en formato AAAA-MM-DD). */
export function ageOn(iso: string, now = Date.now()): number {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(now);
  let a = t.getUTCFullYear() - y;
  if (t.getUTCMonth() + 1 < m || (t.getUTCMonth() + 1 === m && t.getUTCDate() < d)) a--;
  return a;
}

/* ---------- Rostro en tres ángulos ---------- */
/** Grados del giro de la cabeza: de frente hasta 12; girado desde 18 (y hasta 75, más ya no se ve la cara). */
export const FACE_ANGLES = { frontMax: 12, turnMin: 18, turnMax: 75 };
export const POSE_LABEL: Record<FacePose, string> = { FRONT: 'De frente', RIGHT: 'Girando a su derecha', LEFT: 'Girando a su izquierda' };

/**
 * ¿La foto corresponde al ángulo pedido? Con la cámara en vivo la imagen no tiene espejo y se sabe
 * hacia dónde giró. Con una foto del celular (que a veces se guarda como espejo) basta que gire
 * hacia un lado; que las dos giradas vayan a lados opuestos lo revisa facesConsistent.
 */
export function poseOk(pose: FacePose, yaw: number | undefined, knownSide: boolean): boolean {
  if (yaw === undefined || !isFinite(yaw)) return false;
  const a = Math.abs(yaw);
  if (pose === 'FRONT') return a <= FACE_ANGLES.frontMax;
  if (a < FACE_ANGLES.turnMin || a > FACE_ANGLES.turnMax) return false;
  if (!knownSide) return true;
  return pose === 'LEFT' ? yaw > 0 : yaw < 0;
}

/** Las tres fotos: una de frente y dos giradas hacia lados opuestos, todas con una sola cara. */
export function facesConsistent(faces: Pick<FaceShot, 'pose' | 'auto'>[]): boolean {
  const by = (p: FacePose) => faces.find(f => f.pose === p);
  const f = by('FRONT'), r = by('RIGHT'), l = by('LEFT');
  if (!f?.auto?.ok || !r?.auto?.ok || !l?.auto?.ok) return false;
  if (r.auto.yaw === undefined || l.auto.yaw === undefined) return false;
  return Math.sign(r.auto.yaw) !== Math.sign(l.auto.yaw);
}

/* ---------- Padrón de prueba (la demo no consulta RENIEC) ---------- */
export interface PadronPersona { dni: string; surnames: string; given: string; deceased?: boolean; note: string }
export const TEST_DNIS: PadronPersona[] = [
  { dni: '41235876', surnames: 'QUISPE MAMANI', given: 'TEODORA', note: 'Teodora Quispe Mamani' },
  { dni: '44871209', surnames: 'HUAMANI CONDORI', given: 'RUBEN DARIO', note: 'Rubén Darío Huamaní Condori' },
  { dni: '40817263', surnames: 'CCAPA HUAMANI', given: 'MARIO', deceased: true, note: 'figura como fallecido' },
];
export const testDni = (dni: string) => TEST_DNIS.find(p => p.dni === dni);

/** Resultado de una consulta para alguien que se registra: sin el nombre oficial (lo ve solo el equipo). */
export function registryFor(person: PadronPersona | undefined, dni: string, name: string, digit: string | undefined, at: number, source: RegistryCheck['source'], provider?: string): RegistryCheck {
  const digitOk = dniDigitOk(dni, digit);
  if (!person) return { status: 'NOT_FOUND', source, provider, digitOk, deceased: null, at };
  const cmp = compareNames(name, { surnames: person.surnames, given: person.given });
  const officialName = officialFull(person);
  if (person.deceased) return { status: 'DECEASED', source, provider, officialName, score: cmp.score, digitOk, deceased: true, at };
  return { status: cmp.status === 'MISMATCH' ? 'NAME_MISMATCH' : cmp.status, source, provider, officialName, score: cmp.score, digitOk, deceased: source === 'PADRON_PRUEBA' ? false : person.deceased ?? null, at };
}

/* ---------- Alertas del expediente ---------- */
export const ID_ALERTS = {
  name: 'NOMBRE NO COINCIDE CON RENIEC',
  notFound: 'DNI NO FIGURA EN RENIEC',
  deceased: 'DNI DE PERSONA FALLECIDA',
  digit: 'DÍGITO DEL DNI NO COINCIDE',
  faces: 'ROSTRO POR REVISAR',
  docDni: 'DNI DE LA FOTO NO COINCIDE',
  docName: 'NOMBRE DE LA FOTO NO COINCIDE',
  expired: 'DNI VENCIDO',
  minor: 'MENOR DE EDAD',
  faceMatch: 'ROSTRO NO COINCIDE CON EL DNI',
  account: 'DNI DISTINTO AL DE LA CUENTA',
};
const ALL_ID_ALERTS = new Set(Object.values(ID_ALERTS));
export const isIdentityAlert = (a: string) => ALL_ID_ALERTS.has(a);

/** Alertas que salen de la identidad (se recalculan cada vez que llega una consulta o una revisión). */
export function identityAlerts(id: CaseIdentity, now: number, accountDni?: string): string[] {
  const out: string[] = [];
  if (dniDigitOk(id.dni, id.digit) === false || id.registry?.digitOk === false) out.push(ID_ALERTS.digit);
  if (accountDni && accountDni !== id.dni) out.push(ID_ALERTS.account);
  if (id.faces.length && !facesConsistent(id.faces)) out.push(ID_ALERTS.faces);
  const r = id.registry;
  if (r?.status === 'NAME_MISMATCH') out.push(ID_ALERTS.name);
  if (r?.status === 'NOT_FOUND' && r.source === 'PROVEEDOR') out.push(ID_ALERTS.notFound);
  if (r?.status === 'DECEASED' || r?.deceased) out.push(ID_ALERTS.deceased);
  const v = id.review;
  if (v?.mrz?.read && v.mrz.checks) {
    if (v.mrz.dni && v.mrz.dni !== id.dni) out.push(ID_ALERTS.docDni);
    if (v.mrz.surnames && compareNames(id.name, { surnames: v.mrz.surnames, given: v.mrz.given ?? '' }).status === 'MISMATCH') out.push(ID_ALERTS.docName);
    const exp = v.mrz.expiry ? mrzDate(v.mrz.expiry, 'expiry', now) : undefined;
    if (exp && Date.parse(exp + 'T23:59:59-05:00') < now) out.push(ID_ALERTS.expired);
    const born = v.mrz.birth ? mrzDate(v.mrz.birth, 'birth', now) : undefined;
    if (born && ageOn(born, now) < 18) out.push(ID_ALERTS.minor);
  }
  if (v?.faceMatch?.level === 'BAJA') out.push(ID_ALERTS.faceMatch);
  return [...new Set(out)];
}

/** Las fotos de la identidad como evidencias del expediente (las ve el equipo de verificación). */
export function identityEvidence(id: Pick<CaseIdentity, 'dni' | 'dniFront' | 'dniBack' | 'faces'>): Evidence[] {
  const ev: Evidence[] = [];
  const masked = id.dni && id.dni.length === 8 ? `DNI ${id.dni[0]}•••••${id.dni.slice(6)}` : undefined;
  if (id.dniFront) ev.push({ key: 'dni', label: 'DNI · frente', photoId: id.dniFront, detail: masked });
  if (id.dniBack) ev.push({ key: 'dni2', label: 'DNI · reverso', photoId: id.dniBack });
  const key: Record<FacePose, string> = { FRONT: 'rostro', RIGHT: 'rostro-der', LEFT: 'rostro-izq' };
  for (const p of ['FRONT', 'RIGHT', 'LEFT'] as FacePose[]) {
    const f = id.faces.find(x => x.pose === p);
    if (f) ev.push({ key: key[p], label: `Rostro · ${POSE_LABEL[p].toLowerCase()}`, photoId: f.photoId });
  }
  return ev;
}
export const IDENTITY_KEYS = new Set(['dni', 'dni2', 'selfie', 'rostro', 'rostro-der', 'rostro-izq']);

/** Parecido de dos rostros (distancia entre sus descriptores): menos es más parecido. */
export function faceMatchLevel(distance: number): 'ALTA' | 'MEDIA' | 'BAJA' {
  return distance <= 0.45 ? 'ALTA' : distance <= 0.58 ? 'MEDIA' : 'BAJA';
}

export type { DocReview };
