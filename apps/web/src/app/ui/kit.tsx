/*
 * Componentes de 15.5: botón, campo, cantidad, chip, tarjetas, línea de tiempo, barra superior,
 * hoja inferior, foto, QR, calificación, audio. Todos con área táctil de 48 o más.
 */
import { createElement, ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { ICONS } from '../icons.gen';
import { useApp } from '../ctx';
import { product } from '@mesagri/shared/catalog';
import type { Org } from '@mesagri/shared/types';
import { qrPath, compressImage, samplePhoto, seedPhoto, canSpeak, speak, stopSpeaking } from '../media';
import { uid } from '@mesagri/shared/ids';
import { duration } from '@mesagri/shared/format';

export function Icon({ n, s = '1.35em', w = 2, cls }: { n: string; s?: number | string; w?: number; cls?: string }) {
  const node = ICONS[n];
  return (
    <svg className={cls} width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" style={{ flex: "none" }}>
      {node ? node.map(([tag, attrs], i) => createElement(tag, { key: i, ...attrs } as any)) : null}
    </svg>
  );
}

/* ---------- Barra superior y pantalla ---------- */
export interface ScreenProps {
  title?: ReactNode;
  sub?: ReactNode;
  back?: boolean | (() => void);
  hello?: string;
  home?: boolean;
  right?: ReactNode;
  bar?: ReactNode | false;
  foot?: ReactNode;
  flush?: boolean;
  children?: ReactNode;
  cls?: string;
}

export function Screen(p: ScreenProps) {
  const A = useApp();
  const showBack = p.back !== false && !p.home && A.dev.stack.length > 1;
  const onBack = typeof p.back === 'function' ? p.back : () => A.back();
  return (
    <>
      {p.bar !== false && (p.bar ?? (
        <header className={'bar' + (p.home ? ' home' : '')}>
          {showBack || typeof p.back === 'function' ? <button className="back" onClick={onBack} aria-label="Volver"><Icon n="chevron-left" s="1.6em" w={2.4} /></button> : <span style={{ width: ".5em" }} />}
          <div className="tt">
            {p.hello && <p className="hello">{p.hello}</p>}
            <h1>{p.title}</h1>
            {p.sub && <p>{p.sub}</p>}
          </div>
          {p.right && <div className="acts">{p.right}</div>}
        </header>
      ))}
      <main className={'scroll' + (p.flush ? ' flush' : '') + (p.cls ? ' ' + p.cls : '')}>{p.children}</main>
      {p.foot && <div className="foot">{p.foot}</div>}
    </>
  );
}

export function BarAct({ icon, label, onClick, dot }: { icon: string; label: string; onClick: () => void; dot?: boolean }) {
  return <button className="act" onClick={onClick} aria-label={label} title={label}><Icon n={icon} s="1.3em" />{dot && <i className="dot" />}</button>;
}

/* ---------- Botones ---------- */
type BtnKind = 'primary' | 'dark' | 'forest' | 'sec' | 'ghost' | 'danger' | 'secd' | 'light' | 'mint';
export function Btn(p: { kind?: BtnKind; icon?: string; iconRight?: string; onClick?: (e: MouseEvent) => void; full?: boolean; sm?: boolean; xs?: boolean; disabled?: boolean; loading?: boolean; why?: string; children?: ReactNode; type?: 'button' | 'submit'; label?: string; cls?: string; id?: string }) {
  const cls = ['btn', p.kind && p.kind !== 'primary' ? p.kind : '', p.full ? 'full' : '', p.sm ? 'sm' : '', p.xs ? 'xs' : '', p.disabled ? 'dis' : '', p.cls ?? ''].filter(Boolean).join(' ');
  const b = (
    <button id={p.id} type={p.type ?? 'button'} className={cls} aria-disabled={p.disabled ? 'true' : undefined} aria-label={p.label}
      onClick={(e) => { if (p.disabled || p.loading) { e.preventDefault(); return; } p.onClick?.(e as any); }}>
      {p.loading ? <i className="spin" /> : p.icon ? <Icon n={p.icon} s="1.25em" /> : null}
      {p.loading ? 'Guardando...' : p.children}
      {p.iconRight && <Icon n={p.iconRight} s="1.15em" />}
    </button>
  );
  if (p.why && p.disabled) return <div className="stack tight" style={p.full ? { width: "100%" } : undefined}>{b}<div className="why">{p.why}</div></div>;
  return b;
}

/* ---------- Chips, segmentos, interruptores ---------- */
export function Chip({ tone, icon, children, title }: { tone?: string; icon?: string; children: ReactNode; title?: string }) {
  return <span className={'chip' + (tone ? ' ' + tone : '')} title={title}>{icon && <Icon n={icon} s="1.15em" w={2.4} />}{children}</span>;
}
export function ChipBtn({ on, onClick, children, icon }: { on?: boolean; onClick: () => void; children: ReactNode; icon?: string }) {
  return <button className={'chip line' + (on ? ' on' : '')} aria-pressed={on ? 'true' : 'false'} onClick={onClick}>{on && !icon && <Icon n="check" s="1.1em" w={2.6} />}{icon && <Icon n={icon} s="1.1em" />}{children}</button>;
}
export function Seg<T extends string | number>({ value, options, onChange, dark }: { value: T; options: { v: T; l: ReactNode }[]; onChange: (v: T) => void; dark?: boolean }) {
  return (
    <div className={'seg' + (dark ? ' dark' : '')} role="tablist">
      {options.map(o => <button key={String(o.v)} role="tab" aria-selected={o.v === value ? 'true' : 'false'} className={o.v === value ? 'on' : ''} onClick={() => onChange(o.v)}>{o.l}</button>)}
    </div>
  );
}
export function Tog({ on, onChange, label, sub, disabled }: { on: boolean; onChange: (v: boolean) => void; label: ReactNode; sub?: ReactNode; disabled?: boolean }) {
  return (
    <div className="togrow">
      <div className="grow"><div className="b" style={{ fontSize: ".92em" }}>{label}</div>{sub && <div className="cap">{sub}</div>}</div>
      <button className={'tog' + (on ? ' on' : '')} role="switch" aria-checked={on ? 'true' : 'false'} aria-label={typeof label === 'string' ? label : undefined} disabled={disabled} onClick={() => !disabled && onChange(!on)} />
    </div>
  );
}

/* ---------- Campos ---------- */
export function Field({ label, help, error, children }: { label?: ReactNode; help?: ReactNode; error?: string | false; children: ReactNode }) {
  return (
    <div className="fld">
      {label && <label>{label}</label>}
      {children}
      {error ? <div className="errt" role="alert"><Icon n="circle-alert" s="1.2em" />{error}</div> : help ? <div className="help">{help}</div> : null}
    </div>
  );
}
export function Inp(p: { value: string | number; onInput: (v: string) => void; type?: string; mode?: 'numeric' | 'decimal' | 'tel' | 'text' | 'email' | 'search'; placeholder?: string; suffix?: ReactNode; prefix?: string; err?: boolean; max?: number; area?: boolean; label?: string; autoFocus?: boolean; id?: string }) {
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  useEffect(() => { if (p.autoFocus) ref.current?.focus(); }, []);
  const common = { ref, id: p.id, className: 'inp' + (p.err ? ' err' : ''), value: p.value as any, placeholder: p.placeholder, 'aria-label': p.label, maxLength: p.max, onChange: (e: any) => p.onInput(e.currentTarget.value) };
  if (p.area) return <textarea {...common} />;
  const input = <input {...common} type={p.type ?? 'text'} inputMode={p.mode} autoComplete="off" />;
  if (!p.suffix && !p.prefix) return input;
  return <div className="inpwrap">{p.prefix && <span className="pre">{p.prefix}</span>}{input}{p.suffix && <span className="suf">{p.suffix}</span>}</div>;
}
export function Sel<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { v: T; l: string }[]; label?: string }) {
  return <select className="inp" value={value} aria-label={label} onChange={(e: any) => onChange(e.currentTarget.value)}>{options.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}</select>;
}
/** Cantidad con + y − (botones grandes; mantener presionado repite) */
export function Qty({ value, onChange, step = 1, min = 0, max, unit, decimals = 0 }: { value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; unit?: string; decimals?: number }) {
  const [txt, setTxt] = useState(String(value));
  useEffect(() => { if (Number(txt.replace(',', '.')) !== value) setTxt(String(value).replace('.', ',')); }, [value]);
  const timer = useRef<any>(null);
  const clamp = (v: number) => { let x = Math.round(v * 10 ** decimals) / 10 ** decimals; if (x < min) x = min; if (max !== undefined && x > max) x = max; return x; };
  const bump = (d: number) => onChange(clamp(value + d));
  const hold = (d: number) => { bump(d); let n = 0; timer.current = setInterval(() => { n++; if (n > 3) bump(d * (n > 12 ? 5 : 1)); }, 160); };
  const release = () => { clearInterval(timer.current); };
  useEffect(() => release, []);
  return (
    <div className="qty">
      <button aria-label="Menos" onPointerDown={() => hold(-step)} onPointerUp={release} onPointerLeave={release} onKeyDown={(e: any) => { if (e.key === 'Enter' || e.key === ' ') bump(-step); }}><Icon n="minus" w={3} /></button>
      <input aria-label="Cantidad" inputMode={decimals ? 'decimal' : 'numeric'} value={txt} onChange={(e: any) => { const v = e.currentTarget.value; setTxt(v); const n = Number(v.replace(',', '.')); if (isFinite(n) && v.trim() !== '') onChange(clamp(n)); }} onBlur={() => setTxt(String(value).replace('.', ','))} />
      {unit && <span className="u">{unit}</span>}
      <button aria-label="Más" onPointerDown={() => hold(step)} onPointerUp={release} onPointerLeave={release} onKeyDown={(e: any) => { if (e.key === 'Enter' || e.key === ' ') bump(step); }}><Icon n="plus" w={3} /></button>
    </div>
  );
}

/* ---------- Tarjetas y datos ---------- */
export function Card({ tone, children, onClick, cls, label }: { tone?: string; children: ReactNode; onClick?: () => void; cls?: string; label?: string }) {
  const c = 'card' + (tone ? ' ' + tone : '') + (cls ? ' ' + cls : '');
  if (onClick) return <button className={c} onClick={onClick} aria-label={label}>{children}</button>;
  return <div className={c}>{children}</div>;
}
export function Kv({ rows, total }: { rows: ([ReactNode, ReactNode] | false | null | undefined)[]; total?: boolean }) {
  return <div className={'kv' + (total ? ' total' : '')}>{rows.filter(Boolean).map((r, i) => <div key={i}><span>{(r as any)[0]}</span><span>{(r as any)[1]}</span></div>)}</div>;
}
export function Sect({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return right ? <div className="row between"><div className="sect">{children}</div>{right}</div> : <div className="sect">{children}</div>;
}
export function Tile({ pid, size }: { pid: string; size?: 'sm' | 'lg' }) {
  const p = product(pid);
  return <span className={'tile' + (size ? ' ' + size : '')} style={{ background: p.color }} aria-hidden="true">{p.letter}</span>;
}
export function Av({ org, name, color, size }: { org?: Org; name?: string; color?: string; size?: 'lg' }) {
  const ini = org?.initials ?? (name ?? '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  return <span className={'av' + (size ? ' ' + size : '')} style={{ background: color ?? org?.color ?? '#A66633' }} aria-hidden="true">{ini}</span>;
}
export function ICirc({ n, tone }: { n: string; tone?: string }) { return <span className={'icirc' + (tone ? ' ' + tone : '')}><Icon n={n} s="1.25em" /></span>; }
export function Prog({ v, tone }: { v: number; tone?: string }) {
  return <div className={'prog' + (tone ? ' ' + tone : '')} role="progressbar" aria-valuenow={Math.round(v * 100)} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${Math.max(0, Math.min(1, v)) * 100}%` }} /></div>;
}
export function Steps({ n, of }: { n: number; of: number }) {
  return <div className="steps" aria-label={`Paso ${n} de ${of}`}>{Array.from({ length: of }, (_, i) => <i key={i} className={i < n ? 'on' : ''} />)}</div>;
}
export function Stat({ n, l, tone, onClick }: { n: ReactNode; l: ReactNode; tone?: string; onClick?: () => void }) {
  const inner = <><span className={'n' + (tone ? ' ' + tone : '')}>{n}</span><span className="l">{l}</span></>;
  return onClick ? <button className="stat" onClick={onClick}>{inner}</button> : <div className="stat">{inner}</div>;
}
export function Stars({ v, size = '1em', onChange }: { v: number; size?: string; onChange?: (n: number) => void }) {
  return (
    <span className="row g4" role={onChange ? 'radiogroup' : 'img'} aria-label={`${v} de 5 estrellas`} style={{ fontSize: size, color: '#C97C3E', display: 'inline-flex' }}>
      {[1, 2, 3, 4, 5].map(i => onChange
        ? <button key={i} role="radio" aria-checked={i === v ? 'true' : 'false'} aria-label={`${i} estrellas`} onClick={() => onChange(i)} style={{ border: "0", background: "transparent", color: "inherit", padding: ".15em", minWidth: "2.4em", minHeight: "2.4em" }}><svg width="1.7em" height="1.7em" viewBox="0 0 24 24" fill={i <= v ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.6"><path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z" /></svg></button>
        : <svg key={i} width="1em" height="1em" viewBox="0 0 24 24" fill={i <= Math.round(v) ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8"><path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z" /></svg>)}
    </span>
  );
}
export interface TlStep { t: ReactNode; s?: ReactNode; state: 'done' | 'cur' | 'pend' | 'fail' }
export function Timeline({ steps }: { steps: TlStep[] }) {
  return (
    <div className="tl">
      {steps.map((st, i) => (
        <div key={i} className={'st ' + st.state}>
          <span className="dotc">{st.state === 'done' ? <Icon n="check" s="1.1em" w={3} /> : st.state === 'cur' ? <Icon n="clock" s="1.1em" w={2.5} /> : st.state === 'fail' ? <Icon n="x" s="1.1em" w={3} /> : null}</span>
          <div><b>{st.t}</b>{st.s && <span>{st.s}</span>}</div>
        </div>
      ))}
    </div>
  );
}
export function Empty({ icon = 'sprout', title, text, children }: { icon?: string; title: ReactNode; text?: ReactNode; children?: ReactNode }) {
  return <div className="empty"><ICirc n={icon} /><b>{title}</b>{text && <div className="bodym">{text}</div>}{children}</div>;
}
export function Note({ icon = 'info', tone = 'soft', children }: { icon?: string; tone?: string; children: ReactNode }) {
  return <div className={'card ' + tone}><div className="row top g8"><span style={{ marginTop: ".1em" }}><Icon n={icon} s="1.15em" /></span><div className="bodym grow">{children}</div></div></div>;
}
/** Plazo con texto y color («vence en 2 h») */
export function Due({ at, now, prefix = 'Responde en' }: { at: number; now: number; prefix?: string }) {
  const left = at - now;
  if (left <= 0) return <Chip tone="danger" icon="clock">Venció</Chip>;
  return <Chip tone={left < 2 * 3600_000 ? 'danger' : 'warn'} icon="clock">{prefix} {duration(left)}</Chip>;
}

/* ---------- Audio (RF-IDI-04) ---------- */
export function Spk({ text, label = 'Escuchar' }: { text: string; label?: string }) {
  const [on, setOn] = useState(false);
  if (!canSpeak()) return null;
  return <button className={'spk' + (on ? ' on' : '')} aria-label={label} title={label} onClick={() => { if (on) { stopSpeaking(); setOn(false); return; } setOn(true); if (!speak(text, () => setOn(false))) setOn(false); }}><Icon n={on ? 'square' : 'volume-2'} s="1.25em" /></button>;
}

/* ---------- QR ---------- */
export function QR({ text, size = 120, dark }: { text: string; size?: number | string; dark?: boolean }) {
  const { d, n } = qrPath(text);
  return (
    <svg width={size} height={size} viewBox={`-2 -2 ${n + 4} ${n + 4}`} role="img" aria-label={`Código QR ${text}`} style={{ background: '#fff', borderRadius: '10px', flex: 'none', boxShadow: dark ? undefined : 'inset 0 0 0 1px #D5DFD1' }}>
      <path d={d} fill="#1E3F20" shapeRendering="crispEdges" />
    </svg>
  );
}

/* ---------- Fotos ---------- */
export function Photo({ id, label, onClick }: { id?: string; label?: string; onClick?: () => void }) {
  const A = useApp();
  const [src, setSrc] = useState<string | undefined>(id ? (seedPhoto(id) ?? A.photos.peek(id)) : undefined);
  useEffect(() => {
    let alive = true;
    const now = id ? (seedPhoto(id) ?? A.photos.peek(id)) : undefined;
    setSrc(now);
    if (id && !now) A.photos.get(id).then(v => { if (alive) setSrc(v); });
    return () => { alive = false; };
  }, [id]);
  const inner = <>{src ? <img src={src} alt={label ?? 'Foto'} loading="lazy" /> : <Icon n="camera" s="2em" w={1.6} />}{label && <span className="lab">{label}</span>}</>;
  return onClick ? <button className="photo" onClick={onClick} aria-label={label}>{inner}</button> : <div className="photo">{inner}</div>;
}

/** Tomar o elegir una foto (se comprime a 300 KB) o usar una de ejemplo de la demo. */
export function PhotoPick({ value, onChange, label, kind = 'producto', sample }: { value?: string; onChange: (id: string | undefined) => void; label: string; kind?: string; sample?: Parameters<typeof samplePhoto>[1] }) {
  const A = useApp();
  const inp = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const choose = async (f?: File | null) => {
    if (!f) return;
    setBusy(true);
    try {
      const data = await compressImage(f, 1280, 300_000);
      const id = 'ph-' + uid();
      await A.photos.put(id, data, { kind, userId: A.dev.userId });
      onChange(id);
    } catch { A.toast('No pudimos leer esa foto. Prueba con otra.', 'err'); }
    setBusy(false);
  };
  const useSample = async () => {
    const data = samplePhoto(kind, { label, ...(sample ?? {}) });
    if (!data) return;
    const id = 'ph-' + uid();
    await A.photos.put(id, data, { kind, userId: A.dev.userId });
    onChange(id);
  };
  if (value) return (
    <div className="stack tight">
      <Photo id={value} label={label} />
      <button className="linkbtn" onClick={() => onChange(undefined)} style={{ alignSelf: "flex-start", fontSize: ".85em" }}>Repetir</button>
    </div>
  );
  return (
    <div className="stack tight">
      <button className="photo add" onClick={() => inp.current?.click()} aria-label={`Tomar foto: ${label}`}>
        <div className="stack tight" style={{ alignItems: "center" }}>{busy ? <i className="spin" /> : <Icon n="camera" s="1.8em" w={1.6} />}<span className="cap" style={{ padding: "0 .5em" }}>{label}</span></div>
      </button>
      <button className="linkbtn" onClick={useSample} style={{ alignSelf: "flex-start", fontSize: ".8em", padding: ".2em" }} aria-label={`Usar foto de ejemplo: ${label}`}>Usar ejemplo</button>
      <input ref={inp} type="file" accept="image/*" capture="environment" className="sr" tabIndex={-1} onChange={(e: any) => { choose(e.currentTarget.files?.[0]); e.currentTarget.value = ''; }} />
    </div>
  );
}

/* ---------- Hoja inferior ---------- */
export function SheetBody({ title, children, sub }: { title?: ReactNode; sub?: ReactNode; children: ReactNode }) {
  return <div className="stack">{title && <div><h2 className="h2">{title}</h2>{sub && <p className="bodym muted" style={{ margin: ".3em 0 0" }}>{sub}</p>}</div>}{children}</div>;
}

export function Badge({ n }: { n: number }) { return n > 0 ? <span className="badge">{n > 99 ? '99+' : n}</span> : null; }

export function Spinner() { return <i className="spin" style={{ borderColor: "rgba(44,95,45,.25)", borderTopColor: "#2C5F2D", width: "1.4em", height: "1.4em", display: "inline-block", borderRadius: "99px", borderWidth: "3px", borderStyle: "solid", animation: "spin .8s linear infinite" }} />; }

