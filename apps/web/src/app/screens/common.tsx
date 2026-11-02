/*
 * Pantallas comunes: mensajes y chat con respuestas rápidas (A-18), ayuda y Libro de
 * Reclamaciones (A-19), avisos (A-29, B-27, T-20), preferencias y privacidad.
 */
import { useEffect, useRef, useState } from 'react';
import { reg } from './registry';
import { useApp, type AppCtx } from '../ctx';
import { Screen, Btn, Icon, Field, Inp, Card, Chip, Seg, Tog, Av, ICirc, Empty, Note, SheetBody, Kv, Sel } from '../ui/kit';
import { conversations, orgName, itemsShort, notifsFor, NOTIF_ICON, groupByDay, when } from '../helpers';
import { hhmm, relDay, dateShort, dateNum, money, ago } from '@mesagri/shared/format';
import { uid } from '@mesagri/shared/ids';
import { docPdf } from '../pdf';
import { saveFile, SAVE_UNAVAILABLE } from '../platform';
import { addBusinessDays } from '@mesagri/shared/time';
import type { Notif } from '@mesagri/shared/types';

/* ---------- A-18 · Mensajes ---------- */
function Messages() {
  const A = useApp();
  const org = A.org!;
  const [q, setQ] = useState('');
  const list = conversations(A.w, org.id).filter(c => !q || orgName(A.w, c.other).toLowerCase().includes(q.toLowerCase()) || c.so.code.toLowerCase().includes(q.toLowerCase()));
  const tickets = Object.values(A.w.tickets).filter(t => t.orgId === org.id).sort((a, b) => b.at - a.at);
  return (
    <Screen title="Mensajes">
      <div className="stack">
        <Inp value={q} onInput={setQ} placeholder="Buscar conversación" suffix={<Icon n="search" />} label="Buscar conversación" mode="search" />
        <Card>
          {list.length === 0 && tickets.length === 0 && <Empty icon="message-circle" title="Sin conversaciones" text="Cuando tengas un pedido, aquí hablas con la otra parte." />}
          <div className="list">
            {list.map(c => {
              const o = A.w.orgs[c.other];
              const mine = c.last?.from === A.me!.id;
              return (
                <button key={c.id} className="li" onClick={() => A.go('CHAT', { id: c.id })}>
                  <Av org={o} />
                  <div className="grow"><div className="row between"><b className="bodym ell">{o?.name}</b><span className="cap nowrap">{c.last ? relDay(c.last.at, A.now) === 'hoy' ? hhmm(c.last.at) : relDay(c.last.at, A.now) : ''}</span></div>
                    <div className="cap ell">{c.last ? `${mine ? 'Tú: ' : ''}${c.last.text}` : `${c.so.code} · ${itemsShort(c.so)}`}</div></div>
                </button>
              );
            })}
            {tickets.map(t => (
              <button key={t.id} className="li" onClick={() => A.go('TICKET', { id: t.id })}>
                <span className="av" style={{ background: "#1E3F20" }}>M</span>
                <div className="grow"><div className="row between"><b className="bodym">Soporte Mesagri</b><span className="cap">{relDay(t.at, A.now)}</span></div><div className="cap ell">Tu consulta {t.code} {t.status === 'CLOSED' ? 'fue resuelta' : 'está abierta'}</div></div>
              </button>
            ))}
          </div>
        </Card>
        <p className="cap" style={{ margin: "0" }}>Tu número solo se muestra cuando hay un pedido confirmado.</p>
      </div>
    </Screen>
  );
}

const QUICK: Record<string, { k: string; t: string }[]> = {
  FARMER: [{ k: 'q.puedo', t: 'Sí, puedo' }, { k: 'q.tarde', t: 'Llego más tarde' }, { k: 'q.nocant', t: 'No tengo esa cantidad' }, { k: 'q.gracias', t: 'Gracias' }],
  BUYER: [{ k: 'q.hora', t: '¿A qué hora puedes entregar?' }, { k: 'q.peso', t: '¿Viene pesado y seco?' }, { k: 'q.pague', t: 'Ya pagué, revisa tu Yape' }, { k: 'q.gracias', t: 'Gracias' }],
  CARRIER: [{ k: 'q.llego', t: 'Estoy llegando' }, { k: 'q.tarde', t: 'Llego 20 minutos tarde' }, { k: 'q.afuera', t: 'Estoy afuera' }, { k: 'q.gracias', t: 'Gracias' }],
};

/* ---------- A-18 · Chat con respuestas rápidas ---------- */
function Chat() {
  const A = useApp();
  const id = A.top.p?.id as string;
  const so = A.w.subOrders[id];
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const msgs = A.w.messages[id] ?? [];
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs.length]);
  if (!so) return <Screen title="Chat"><Empty title="No encontramos la conversación" /></Screen>;
  const other = A.org!.id === so.buyerOrgId ? so.sellerOrgId : so.buyerOrgId;
  const send = (t: string, quick?: string) => {
    if (!t.trim()) return;
    const r = A.act('MSG_SEND', { msgId: 'm-' + uid(), conv: id, text: t.trim(), quick });
    if (r.ok) setText('');
  };
  const quick = QUICK[A.me!.role] ?? QUICK.BUYER;
  let lastDay = '';
  return (
    <Screen title={orgName(A.w, other)} sub={`Pedido ${so.code} · ${itemsShort(so).toLowerCase()}`} foot={
      <div className="stack tight">
        <div className="chips">{quick.map(q => <button key={q.k} className="chip line" onClick={() => send(q.t, q.k)}>{q.t}</button>)}</div>
        <div className="row g8">
          <div className="grow"><Inp value={text} onInput={setText} placeholder="Escribe un mensaje" label="Mensaje" /></div>
          <button className="spk" style={{ width: "3.2em", height: "3.2em", background: "var(--terra6)" }} aria-label="Enviar" onClick={() => send(text)}><Icon n="send" s="1.3em" /></button>
        </div>
      </div>
    }>
      <div className="stack tight">
        {msgs.length === 0 && <Empty icon="message-circle" title="Escribe el primer mensaje" text="Usa las respuestas rápidas: cada uno las ve en su idioma." />}
        {msgs.map(m => {
          const mine = m.from === A.me!.id;
          const day = relDay(m.at, A.now);
          const showDay = day !== lastDay;
          lastDay = day;
          const who = A.w.users[m.from];
          return (
            <div key={m.id} className="stack tight">
              {showDay && <div className="cap center" style={{ margin: ".4em 0" }}>{day === 'hoy' ? 'Hoy' : day[0].toUpperCase() + day.slice(1)}</div>}
              <div style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '82%' }}>
                <div className={'card ' + (mine ? '' : '')} style={{ background: mine ? 'var(--field)' : '#fff', color: mine ? '#fff' : 'var(--ink)', borderRadius: mine ? '1.1em 1.1em .3em 1.1em' : '1.1em 1.1em 1.1em .3em', padding: '.6em .85em' }}>
                  {!mine && who?.role === 'ADMIN' && <div className="cap b">Soporte Mesagri</div>}
                  <div className="bodym">{m.text}</div>
                  <div className="cap" style={{ color: mine ? '#cfe0c1' : undefined, fontSize: '.68em' }}>{hhmm(m.at)}{m.quick ? ' · respuesta rápida, la ves en tu idioma' : ''}</div>
                </div>
              </div>
            </div>
          );
        })}
        <div ref={end} />
      </div>
    </Screen>
  );
}

/* ---------- Consulta a Soporte ---------- */
function Ticket() {
  const A = useApp();
  const tk = A.w.tickets[A.top.p?.id as string];
  const [text, setText] = useState('');
  if (!tk) return <Screen title="Consulta"><Empty title="No encontramos la consulta" /></Screen>;
  return (
    <Screen title={`Consulta ${tk.code}`} sub={`${tk.topic} · ${tk.status === 'OPEN' ? 'abierta' : 'resuelta'}`} foot={tk.status === 'OPEN' ? <div className="row g8"><div className="grow"><Inp value={text} onInput={setText} placeholder="Escribe tu respuesta" label="Respuesta" /></div><Btn kind="dark" onClick={() => { if (A.act('TICKET_REPLY', { ticketId: tk.id, text }).ok) setText(''); }}>Enviar</Btn></div> : undefined}>
      <div className="stack tight">
        <Card><div className="cap">Tú · {dateShort(tk.at)} {hhmm(tk.at)}</div><div className="bodym">{tk.text}</div></Card>
        {tk.replies.map((r, i) => <Card key={i} tone={A.w.users[r.by]?.role === 'ADMIN' ? 'soft' : undefined}><div className="cap">{A.w.users[r.by]?.role === 'ADMIN' ? 'Soporte Mesagri' : 'Tú'} · {dateShort(r.at)} {hhmm(r.at)}</div><div className="bodym">{r.text}</div></Card>)}
      </div>
    </Screen>
  );
}

/* ---------- A-19 · Ayuda y reclamos ---------- */
const TOPICS = [
  { k: 'cobros', i: 'banknote', t: 'Cobros y pagos', s: 'Yape, efectivo, comisión', a: 'El comprador te paga directo a tu Yape, Plin o cuenta. Mesagri no guarda tu dinero. Tus 5 primeras ventas no pagan comisión; desde la 6.ª pagas 3 % una vez al mes, hasta el día 10.' },
  { k: 'pedidos', i: 'shopping-bag', t: 'Pedidos', s: 'Aceptar, entregar, reclamos', a: 'Tienes 12 horas para aceptar un pedido. Entregas con el código de 4 dígitos que te dicta el comprador. El comprador tiene 48 horas para dar su conformidad; si no responde, el pedido se da por conforme.' },
  { k: 'almacen', i: 'warehouse', t: 'Almacenes', s: 'Reservas y constancias', a: 'Puedes guardar tu cosecha en un almacén aliado verificado. Reservas con tarifa congelada, el almacén pesa y te da una constancia con QR. El alquiler se paga al almacén cuando sale tu cosecha.' },
  { k: 'cuenta', i: 'id-card', t: 'Mi cuenta', s: 'Verificación y datos', a: 'Tu nivel de verificación sube tus topes. Nivel 1: DNI y selfie. Nivel 2: Padrón de Productores o constancia de tu comunidad y fotos de tu chacra. Puedes pedir una copia o el borrado de tus datos en Perfil › Privacidad.' },
];
function Help() {
  const A = useApp();
  const [open, setOpen] = useState('');
  const [q, setQ] = useState('');
  const topics = TOPICS.filter(t => !q || (t.t + t.s + t.a).toLowerCase().includes(q.toLowerCase()));
  const ticket = () => A.sheet(<NewTicket />);
  return (
    <Screen title={A.t('help.title', 'Ayuda')}>
      <div className="stack">
        <Inp value={q} onInput={setQ} placeholder="¿En qué te ayudamos?" suffix={<Icon n="search" />} label="Buscar en la ayuda" mode="search" />
        <div className="grid2">
          {topics.map(t => (
            <button key={t.k} className={'card' + (open === t.k ? ' sel' : '')} onClick={() => setOpen(open === t.k ? '' : t.k)} aria-expanded={open === t.k ? 'true' : 'false'}>
              <div className="stack tight"><ICirc n={t.i} tone={t.k === 'pedidos' ? 'terra' : ''} /><b className="bodym">{t.t}</b><span className="cap">{t.s}</span></div>
            </button>
          ))}
        </div>
        {open && <Card tone="soft"><div className="row top g8"><div className="grow bodym">{TOPICS.find(t => t.k === open)!.a}</div><Spk2 text={TOPICS.find(t => t.k === open)!.a} /></div></Card>}
        <Card>
          <div className="row"><span className="icirc dark"><Icon n="smartphone" /></span><div className="grow"><b className="bodym">Escríbenos por WhatsApp</b><div className="cap">Lunes a sábado, 7:00 a 19:00 · en castellano o runasimi</div></div></div>
        </Card>
        <Btn full kind="dark" onClick={ticket}>Abrir una consulta</Btn>
        <button className="card soft" onClick={() => A.go('LIBRO')}>
          <div className="row"><Icon n="book-open" /><div className="grow"><b className="bodym">Libro de Reclamaciones</b><div className="cap">Respondemos en 15 días hábiles como máximo</div></div><Icon n="chevron-right" s="1.1em" /></div>
        </button>
      </div>
    </Screen>
  );
}
function Spk2({ text }: { text: string }) { const A = useApp(); return <button className="spk" aria-label="Escuchar" onClick={() => A.say(text)}><Icon n="volume-2" s="1.2em" /></button>; }

function NewTicket() {
  const A = useApp();
  const [topic, setTopic] = useState('Pedidos');
  const [text, setText] = useState('');
  return (
    <SheetBody title="Abrir una consulta" sub="Te respondemos aquí y por WhatsApp.">
      <Field label="Tema"><Sel value={topic} onChange={setTopic} options={['Pedidos', 'Cobros y pagos', 'Almacenes', 'Envíos', 'Mi cuenta', 'Otro'].map(v => ({ v, l: v }))} label="Tema" /></Field>
      <Field label="Cuéntanos"><Inp area value={text} onInput={setText} placeholder="Escribe tu consulta" label="Consulta" /></Field>
      <Btn full kind="dark" onClick={() => { const r = A.act('TICKET_OPEN', { ticketId: 'tk-' + uid(), topic, text }); if (r.ok) { A.sheet(null); A.toast(`Consulta ${r.result.code} enviada. Te respondemos pronto.`); } }}>Enviar consulta</Btn>
    </SheetBody>
  );
}

/* ---------- A-19 · Libro de Reclamaciones (RN-20) ---------- */
function Complaints() {
  const A = useApp();
  const [type, setType] = useState<'RECLAMO' | 'QUEJA'>('RECLAMO');
  const [related, setRelated] = useState('');
  const [amount, setAmount] = useState('');
  const [detail, setDetail] = useState('');
  const [req, setReq] = useState('');
  const mine = Object.values(A.w.complaints).filter(c => c.orgId === A.org?.id).sort((a, b) => b.at - a.at);
  const next = String((A.w.seq.complaint ?? 229) + 1).padStart(6, '0');
  const send = () => {
    const r = A.act('COMPLAINT_FILE', { complaintId: 'cmp-' + uid(), type, related, amount: amount ? Number(amount.replace(',', '.')) : undefined, detail, request: req });
    if (!r.ok) return;
    A.toast(`Hoja N.º ${r.result.number} registrada. Te enviamos una copia.`);
    setDetail(''); setReq(''); setAmount(''); setRelated('');
  };
  return (
    <Screen title="Libro de Reclamaciones" sub={`Hoja N.º ${next} · Mesagri S.A.C.`} foot={<Btn full onClick={send}>Enviar y recibir copia</Btn>}>
      <div className="stack">
        <Seg value={type} options={[{ v: 'RECLAMO', l: 'Reclamo' }, { v: 'QUEJA', l: 'Queja' }]} onChange={setType} />
        <p className="cap" style={{ margin: "0" }}>Reclamo: disconformidad con un producto o servicio. Queja: malestar con la atención.</p>
        <Field label="Servicio o pedido relacionado"><Inp value={related} onInput={setRelated} placeholder="Estado de cuenta · noviembre 2026" suffix={<Icon n="file-text" />} label="Servicio relacionado" /></Field>
        {type === 'RECLAMO' && <Field label="Monto reclamado (opcional)"><Inp value={amount} onInput={setAmount} mode="decimal" prefix="S/" placeholder="4,50" label="Monto" /></Field>}
        <Field label="Detalle"><Inp area value={detail} onInput={setDetail} placeholder="Cuéntanos qué pasó" label="Detalle" /></Field>
        <Field label="¿Qué pides?"><Inp area value={req} onInput={setReq} placeholder="Qué solución esperas" label="Pedido" /></Field>
        {mine.length > 0 && <div className="sect">Tus hojas</div>}
        {mine.map(c => (
          <Card key={c.id}>
            <div className="row between"><b className="bodym">Hoja N.º {c.number} · {c.type === 'RECLAMO' ? 'reclamo' : 'queja'}</b><Chip tone={c.status === 'ANSWERED' ? 'leaf' : 'warn'}>{c.status === 'ANSWERED' ? 'Respondida' : 'En plazo'}</Chip></div>
            <div className="cap">{dateNum(c.at)} · respuesta hasta el {dateNum(c.dueAt)}</div>
            <div className="bodym mt">{c.detail}</div>
            {c.answer && <Note icon="message-circle">{c.answer}</Note>}
            <div className="mt"><Btn sm kind="sec" icon="download" onClick={() => downloadComplaint(A, c.id)}>Copia en PDF</Btn></div>
          </Card>
        ))}
      </div>
    </Screen>
  );
}

export async function downloadComplaint(A: AppCtx, id: string) {
  const c = A.w.complaints[id];
  if (!c) return;
  const org = A.w.orgs[c.orgId];
  const bytes = docPdf({
    kicker: 'Libro de Reclamaciones', badge: `Hoja N.º ${c.number}`, title: `Hoja de ${c.type === 'RECLAMO' ? 'reclamación' : 'queja'} N.º ${c.number}`,
    subtitle: 'Mesagri S.A.C. · Libro de Reclamaciones virtual (D. S. N.º 011-2011-PCM y modificatorias).',
    rows: [['Fecha', `${dateNum(c.at)} ${hhmm(c.at)}`], ['Consumidor', `${A.w.users[c.userId]?.name ?? ''} · ${org?.name ?? ''}`], ['Tipo', c.type === 'RECLAMO' ? 'Reclamo' : 'Queja'], ['Servicio relacionado', c.related || '—'], ['Monto reclamado', c.amount ? money(c.amount) : '—'], ['Plazo de respuesta', `${dateNum(c.dueAt)} (15 días hábiles)`], ['Estado', c.status === 'ANSWERED' ? 'Respondida' : 'En plazo']],
    notes: [`Detalle: ${c.detail}`, `Pedido del consumidor: ${c.request}`, ...(c.answer ? [`Respuesta de Mesagri: ${c.answer}`] : [])],
  });
  const r = await saveFile(`hoja-reclamacion-${c.number}.pdf`, bytes);
  if (r === 'declined') A.toast('No se descargó la copia.', 'info');
  else if (r === 'error' || r === 'unavailable') A.toast(r === 'unavailable' ? SAVE_UNAVAILABLE : 'No pudimos descargar la copia.', 'err');
}

/* ---------- A-29 · Avisos ---------- */
function Notifications() {
  const A = useApp();
  const list = notifsFor(A.w, A.org!.id).slice(0, 60);
  useEffect(() => { A.patch(d => { d.flow = { ...d.flow, seenNotifs: A.now }; }); }, []);
  const groups = groupByDay(list, A.now);
  const open = (n: Notif) => { if (n.link && n.link.screen !== 'VERIF') A.go(n.link.screen, n.link.params); else if (n.link?.screen === 'VERIF') A.go(A.me!.role === 'BUYER' ? 'B-04' : 'A-17V'); };
  const tone = (k: Notif['kind']) => (k === 'PAYMENT' || k === 'BILLING' ? 'terra' : k === 'ORDER' || k === 'DELIVERY' ? 'terra' : k === 'VERIFICATION' || k === 'STORAGE' ? 'dark' : '');
  return (
    <Screen title="Avisos">
      <div className="stack">
        {list.length === 0 && <Empty icon="bell" title="Sin avisos" text="Aquí verás tus pedidos, pagos, entregas y estados de cuenta." />}
        {groups.map(g => (
          <div key={g.label} className="stack tight">
            <div className="sect">{g.label}</div>
            <Card>
              <div className="list">
                {g.items.map(n => (
                  <button key={n.id} className="li" onClick={() => open(n)} style={{ alignItems: "flex-start" }}>
                    <ICirc n={NOTIF_ICON[n.kind]} tone={tone(n.kind)} />
                    <div className="grow"><div className="row between top"><b className="bodym">{n.title}</b><span className="cap nowrap">{relDay(n.at, A.now) === 'hoy' ? hhmm(n.at) : relDay(n.at, A.now)}</span></div><div className="cap">{n.body}</div></div>
                  </button>
                ))}
              </div>
            </Card>
          </div>
        ))}
      </div>
    </Screen>
  );
}

/* ---------- Preferencias (A-20) ---------- */
export function PrefsSheet() {
  const A = useApp();
  const p = A.me!.prefs;
  const set = (patch: any) => A.act('PREFS_SET', { prefs: patch });
  const enabled = A.w.settings.languages.enabled;
  return (
    <SheetBody title="Idioma y lectura">
      <Field label="Idioma">
        <Seg value={p.lang} options={[{ v: 'es', l: 'Castellano' }, { v: 'qu', l: 'Runasimi' }, { v: 'ay', l: 'Aymar aru' }]} onChange={(v) => set({ lang: v })} />
      </Field>
      {p.lang !== 'es' && !enabled.includes(p.lang) && <Note tone="warn">Este idioma se activa cuando hablantes aprueben las pantallas críticas (RN-32). Mientras tanto ves castellano.</Note>}
      <Card>
        <Tog on={p.audioGuide} onChange={(v) => set({ audioGuide: v })} label="Guía de audio" sub="Lee en voz alta lo importante" />
        <Tog on={p.bilingual} onChange={(v) => set({ bilingual: v })} label="Mostrar también en castellano" />
        <Tog on={p.dataSaver} onChange={(v) => set({ dataSaver: v })} label="Ahorro de datos" sub="Fotos pequeñas y sin precarga" />
      </Card>
      <Field label="Tamaño de letra"><Seg value={p.textScale} options={[{ v: 1, l: 'Normal' }, { v: 1.25, l: 'Grande' }, { v: 1.5, l: 'Extra' }]} onChange={(v) => set({ textScale: v })} /></Field>
      <Field label="Números" help="Prueba cuál se entiende mejor (decisión pendiente de las pruebas con usuarios)."><Seg value={p.numFmt} options={[{ v: 'coma', l: 'S/ 1,50' }, { v: 'punto', l: 'S/ 1.50' }]} onChange={(v) => set({ numFmt: v })} /></Field>
      <Btn full kind="dark" onClick={() => A.sheet(null)}>Listo</Btn>
    </SheetBody>
  );
}

export function PrivacySheet() {
  const A = useApp();
  const download = async () => {
    const me = A.me!, org = A.org!;
    const data = {
      generado: new Date().toISOString(), aviso: 'Copia de tus datos en la demo de Mesagri (Ley 29733, derecho de acceso).',
      usuario: { nombre: me.name, celular: me.phone, dni: me.dni, preferencias: me.prefs, consentimientos: me.consents },
      organizacion: { nombre: org.name, ruc: org.ruc, distrito: org.district, nivel: org.level, cuentas: org.payout.map(a => ({ tipo: a.kind, titular: a.holder, relacion: a.relation })) },
      pedidos: Object.values(A.w.subOrders).filter(s => s.buyerOrgId === org.id || s.sellerOrgId === org.id).map(s => ({ codigo: s.code, estado: s.status, total: s.total, fecha: new Date(s.createdAt).toISOString() })),
    };
    const r = await saveFile('mis-datos-mesagri.json', JSON.stringify(data, null, 2));
    if (r === 'error' || r === 'unavailable') A.toast(r === 'unavailable' ? SAVE_UNAVAILABLE : 'No pudimos generar la copia.', 'err');
  };
  return (
    <SheetBody title="Privacidad y mis datos" sub="Tus derechos ARCO (Ley 29733): acceso, rectificación, cancelación y oposición.">
      <Kv rows={[['Distrito visible', 'Sí (obligatorio)'], ['Ubicación exacta de la chacra', 'Nunca se muestra'], ['Foto del DNI', 'Solo la ve verificación'], ['Avisos por WhatsApp', A.me!.consents?.items.whatsapp ? 'Sí' : 'No'], ['Ventas sin nombre para precios', A.me!.consents?.items.precios ? 'Sí' : 'No']]} />
      <Btn full kind="sec" icon="download" onClick={download}>Descargar una copia de mis datos</Btn>
      <Btn full kind="secd" onClick={async () => { const ok = await A.confirm({ title: '¿Pedir el borrado de tu cuenta?', text: 'Guardamos solo lo que la ley obliga (comprobantes y Libro de Reclamaciones). Tus pedidos en curso deben terminar antes.', ok: 'Pedir borrado', danger: true }); if (ok) A.toast('Recibimos tu pedido. Te respondemos en 10 días hábiles (Ley 29733).', 'info'); }}>Pedir que borren mi cuenta</Btn>
    </SheetBody>
  );
}

reg('A-18', Messages, { nav: true, tab: 'A-12' });
reg('CHAT', Chat);
reg('TICKET', Ticket);
reg('A-19', Help, { nav: true, tab: 'A-20' });
reg('LIBRO', Complaints);
reg('A-29', Notifications, { nav: true, tab: 'A-08' });

void Chip; void ago; void when; void addBusinessDays;
