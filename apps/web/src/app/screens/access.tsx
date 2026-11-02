/*
 * Piezas del acceso al panel que comparten el ingreso (W-01), Equipo (W-19) y Mi cuenta (W-20):
 * contraseña nueva, doble factor con Google Authenticator o Microsoft Authenticator y el primer
 * ingreso de una persona nueva del equipo con su clave temporal.
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { AppCtx } from '../ctx';
import { Icon, Btn, QR } from '../ui/kit';
import { ADMIN_ROLE_INFO } from '@mesagri/shared/engine/r2';
import { passwordProblem } from '@mesagri/shared/rules';
import { auth, type AdminSetup, type Session, type TotpSetup } from '../net';
import { panelUrl } from '../routes';
import type { AdminRole } from '@mesagri/shared/types';

export const ROLES: AdminRole[] = ['GENERAL', 'VERIFIER', 'SUPPORT', 'ANALYST'];
export const roleLabel = (r?: string) => ADMIN_ROLE_INFO[(r ?? 'GENERAL') as AdminRole]?.label ?? '—';
export const first = (name?: string) => (name ?? '').split(' ')[0] || 'Hola';

export function Fld({ label, help, children }: { label: string; help?: ReactNode; children: ReactNode }) {
  return <label className="fld"><span className="lbl">{label}</span>{children}{help && <span className="wnote" style={{ margin: 0 }}>{help}</span>}</label>;
}
export function TextIn({ value, onChange, type = 'text', mode, auto, placeholder, label }: { value: string; onChange: (v: string) => void; type?: string; mode?: 'text' | 'email' | 'tel' | 'numeric'; auto?: string; placeholder?: string; label?: string }) {
  return <input className="inp" type={type} inputMode={mode} autoComplete={auto ?? 'off'} value={value} placeholder={placeholder} aria-label={label} onChange={(e: any) => onChange(e.currentTarget.value)} />;
}
export function Err({ text }: { text: string }) { return text ? <div className="errt" role="alert"><Icon n="circle-alert" s="16" />{text}</div> : null; }

/** Contraseña nueva, dos veces. */
export function NewPassword({ pw, setPw, again, setAgain }: { pw: string; setPw: (v: string) => void; again: string; setAgain: (v: string) => void }) {
  const [show, setShow] = useState(false);
  return (
    <>
      <Fld label="Tu contraseña nueva" help="Al menos 10 caracteres, con letras y números. Solo tú la vas a saber.">
        <span className="inpwrap"><input className="inp" type={show ? 'text' : 'password'} autoComplete="new-password" value={pw} onChange={(e: any) => setPw(e.currentTarget.value)} /><button type="button" className="suf" style={{ pointerEvents: 'auto', border: 0, background: 'transparent', cursor: 'pointer' }} aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'} onClick={() => setShow(!show)}><Icon n={show ? 'eye-off' : 'eye'} s="18" /></button></span>
      </Fld>
      <Fld label="Escríbela otra vez"><input className="inp" type={show ? 'text' : 'password'} autoComplete="new-password" value={again} onChange={(e: any) => setAgain(e.currentTarget.value)} /></Fld>
    </>
  );
}
export const pwIssue = (pw: string, again: string) => passwordProblem(pw) || (pw !== again ? 'Las dos contraseñas no coinciden.' : '');

/** Activar el doble factor: QR para Google Authenticator o Microsoft Authenticator, la clave escrita y el código. */
export function TotpStep({ totp, code, setCode }: { totp: TotpSetup; code: string; setCode: (v: string) => void }) {
  return (
    <div className="stack tight">
      <div className="totpbox">
        <QR text={totp.uri} size={168} label="Código QR para tu app de autenticación" />
        <ol>
          <li>En tu celular, abre <b>Google Authenticator</b> o <b>Microsoft Authenticator</b> (se instalan gratis desde la tienda de apps).</li>
          <li>Toca <b>+</b> y escanea este código. Si no puedes, elige «Ingresar una clave» y escribe: <span className="totpkey">{totp.secret.replace(/(.{4})/g, '$1 ').trim()}</span></li>
          <li>Escribe aquí el código de 6 dígitos que aparece en la app.</li>
        </ol>
      </div>
      <Fld label="Código de tu app de autenticación">
        <input className="inp tnum" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e: any) => setCode(e.currentTarget.value.replace(/\D/g, '').slice(0, 6))} placeholder="6 dígitos" style={{ letterSpacing: '.3em', fontWeight: 900 }} />
      </Fld>
    </div>
  );
}

/** Copia un texto (con respaldo para navegadores sin portapapeles). */
export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* sin permiso */ }
  try {
    const t = document.createElement('textarea');
    t.value = text; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
    document.body.appendChild(t); t.select();
    const ok = document.execCommand('copy');
    t.remove();
    return ok;
  } catch { return false; }
}
export const fullPanelUrl = (email?: string) => { try { return new URL(panelUrl(email), location.href).href; } catch { return panelUrl(email); } };

export async function tokenOf(A: AppCtx): Promise<string | undefined> { return A.store.sessions.token(A.me!.id); }

/** Primer ingreso (W-01): la persona entró con su clave temporal; crea su contraseña y activa su doble factor. */
export function FirstAccess({ setup, temp, onDone, onCancel }: { setup: AdminSetup; temp: string; onDone: (r: { userId: string; session: Session }) => void; onCancel: (why?: string) => void }) {
  const [pw, setPw] = useState('');
  const [again, setAgain] = useState('');
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const p = pwIssue(pw, again) || (pw === temp ? 'Crea una contraseña distinta de la temporal.' : '');
    if (p) { setErr(p); return; }
    if (code.length !== 6) { setErr('Escribe el código de 6 dígitos de tu app de autenticación.'); return; }
    setBusy(true);
    try { onDone(await auth.adminSetup(setup.token, pw, code)); } catch (e: any) {
      if (e?.code === 'SETUP_EXPIRED') { onCancel(e.message); return; }
      setErr(e?.message ?? 'No pudimos guardar tu acceso.');
    } finally { setBusy(false); }
  };
  return (
    <form className="wlogin-card" aria-label="Primer ingreso" onSubmit={(e: any) => { e.preventDefault(); void save(); }}>
      <h1>Hola, {first(setup.name)}</h1>
      <p className="wnote" style={{ margin: 0 }}>Te damos la bienvenida al equipo de Mesagri{setup.adminRole ? <> ({roleLabel(setup.adminRole).toLowerCase()})</> : null}. Para entrar, crea tu contraseña y activa el doble factor en tu celular. Nadie más los va a conocer.</p>
      <div className="sect" style={{ margin: '4px 0 0' }}>1 · Tu contraseña</div>
      <NewPassword pw={pw} setPw={v => { setPw(v); setErr(''); }} again={again} setAgain={v => { setAgain(v); setErr(''); }} />
      <div className="sect" style={{ margin: '4px 0 0' }}>2 · Tu doble factor</div>
      <TotpStep totp={setup.totp} code={code} setCode={v => { setCode(v); setErr(''); }} />
      <Err text={err} />
      <Btn full kind="dark" type="submit" disabled={busy}>{busy ? <i className="spin" /> : null}Guardar y entrar</Btn>
      <button type="button" className="linkbtn" style={{ alignSelf: 'center' }} onClick={() => onCancel()}>Volver</button>
    </form>
  );
}
