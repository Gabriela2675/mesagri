/*
 * Pagos que se pueden comprobar.
 *
 * - A dónde se le paga a Mesagri: las cuentas que el equipo pone en el panel (Cobros → Cuentas de
 *   Mesagri). Mientras sean las de ejemplo, se marcan como tales.
 * - Los datos de una constancia que ayudan a quien cobra a encontrar el pago en SU propia app: el
 *   número de operación, a nombre de quién sale y, en Yape, el código de seguridad de 3 dígitos (el
 *   mismo aparece en el detalle del movimiento de quien recibe). Una captura o un número de
 *   operación solos se pueden inventar con apps falsas: lo que vale es lo que se ve en la cuenta.
 */
import { useApp } from '../ctx';
import { Btn, Field, Inp, Card, Kv, Note, PhotoPick, Seg } from './kit';
import { mesagriData } from '@mesagri/shared/queries';
import type { CollectAccount } from '@mesagri/shared/settings';
import type { PayMethod } from '@mesagri/shared/types';
import { money } from '@mesagri/shared/format';
import { PAY_LABEL } from '../helpers';
import { LOCAL } from '../routes';

export type MesagriMethod = 'YAPE' | 'PLIN' | 'TRANSFER';

/** Cuenta de Mesagri para un medio de pago (el Yape también recibe Plin entre billeteras). */
export function mesagriAccount(accounts: CollectAccount[], m: MesagriMethod): CollectAccount | undefined {
  if (m === 'TRANSFER') return accounts.find(a => a.kind === 'BANK');
  return accounts.find(a => a.kind === m) ?? accounts.find(a => a.kind === 'YAPE' || a.kind === 'PLIN');
}

/** Medios con los que se le puede pagar a Mesagri según las cuentas que puso el equipo. */
export function mesagriMethods(accounts: CollectAccount[]): MesagriMethod[] {
  const out: MesagriMethod[] = [];
  if (accounts.some(a => a.kind === 'YAPE')) out.push('YAPE');
  if (accounts.some(a => a.kind === 'PLIN')) out.push('PLIN');
  if (accounts.some(a => a.kind === 'BANK')) out.push('TRANSFER');
  return out.length ? out : ['YAPE'];
}

export const fmtPhone = (n: string) => n.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3');
export const fmtCci = (n: string) => n.replace(/(\d{3})(\d{3})(\d{12})(\d{2})/, '$1 $2 $3 $4');

/** Dónde pagar: titular, número o CCI (con botón para copiar) y la referencia. */
export function MesagriAccountCard({ method, amount, reference }: { method: MesagriMethod; amount: number; reference?: string }) {
  const A = useApp();
  const data = mesagriData(A.w);
  const acc = mesagriAccount(data.accounts, method);
  const ex = data.example ? ' (ejemplo)' : '';
  if (!acc) return <Note icon="triangle-alert" tone="warn">Mesagri todavía no tiene una cuenta para {PAY_LABEL[method]}. Elige otro medio.</Note>;
  const number = acc.kind === 'BANK' ? acc.cci ?? acc.number : acc.number;
  const copy = () => { try { void navigator.clipboard.writeText(number); A.toast('Número copiado.', 'info'); } catch { A.toast(number, 'info'); } };
  return (
    <Card tone="soft">
      <Kv rows={[
        ['A nombre de', acc.holder],
        acc.kind === 'BANK' ? ['Banco', acc.bank ?? '—'] : null,
        [acc.kind === 'BANK' ? 'CCI' : acc.kind === 'PLIN' ? 'Plin' : 'Yape', `${acc.kind === 'BANK' ? fmtCci(number) : fmtPhone(number)}${ex}`],
        acc.kind === 'BANK' ? ['Cuenta', `${acc.number}${ex}`] : null,
        ['Monto', money(amount)],
        reference ? ['Referencia', reference] : null,
      ]} />
      <div className="row g8 wrap mt"><Btn xs kind="light" icon="copy" onClick={copy}>Copiar {acc.kind === 'BANK' ? 'CCI' : 'número'}</Btn></div>
      {data.example && <div className="cap mt">Son datos de ejemplo de la demo: en la app real, Mesagri pone aquí su cuenta.</div>}
    </Card>
  );
}

export interface Proof { op: string; payer: string; code: string; photo?: string }
export const emptyProof = (payer = ''): Proof => ({ op: '', payer, code: '' });

/** Qué falta para enviar la constancia (o vacío si está completa). */
export function proofMissing(p: Proof, method: PayMethod, opts: { photo?: boolean } = {}): string {
  if (opts.photo && !p.photo) return 'Falta la captura de tu constancia.';
  if (p.op.length < 4) return 'Escribe el número de operación.';
  if (p.payer.trim().length < 3) return 'Escribe a nombre de quién sale el pago.';
  if (method === 'YAPE' && p.code && p.code.length !== 3) return 'El código de seguridad de Yape tiene 3 números.';
  return '';
}

/** Lo que va en la acción: número, titular, código (solo Yape) y captura. */
export function proofPayload(p: Proof, method: PayMethod) {
  return { operation: p.op, payerName: p.payer.trim(), ...(method === 'YAPE' && p.code ? { securityCode: p.code } : {}), ...(p.photo ? { photoId: p.photo } : {}) };
}

/**
 * Campos de la constancia. La captura de ejemplo solo existe en la demo (escenario de varios
 * celulares o versión sin internet): en la app real se sube la de verdad.
 */
export function ProofFields({ value, onChange, method, to, amount, photo = 'optional' }: { value: Proof; onChange: (p: Proof) => void; method: PayMethod; to: string; amount: number; photo?: 'required' | 'optional' | 'none' }) {
  const A = useApp();
  const set = (patch: Partial<Proof>) => onChange({ ...value, ...patch });
  const sample = A.store.mode === 'stage' || LOCAL;
  return (
    <div className="stack">
      {photo !== 'none' && <PhotoPickProof value={value.photo} onChange={(id) => set({ photo: id })} label={photo === 'required' ? 'Captura de tu constancia' : 'Captura de tu constancia (opcional)'} sample={sample} stamp={value.op || '05123987'} to={to} amount={amount} />}
      <Field label="N.º de operación" help="Está en tu constancia. No sirve para dos pagos.">
        <Inp value={value.op} onInput={(v) => set({ op: v.replace(/\D/g, '').slice(0, 14) })} mode="numeric" placeholder="05123987" label="Número de operación" />
      </Field>
      <Field label="¿A nombre de quién sale el pago?" help={`Como aparece en tu constancia (el titular de tu ${method === 'TRANSFER' ? 'cuenta' : PAY_LABEL[method]}). Así ${to} lo encuentra en sus movimientos.`}>
        <Inp value={value.payer} onInput={(v) => set({ payer: v.slice(0, 80) })} placeholder="Rosario Valdivia" label="A nombre de quién sale el pago" />
      </Field>
      {method === 'YAPE' && (
        <Field label="Código de seguridad de Yape (3 números)" help={`Sale en tu constancia de Yape. ${to} ve el mismo código en el detalle del movimiento: si coincide, el pago es real.`}>
          <Inp value={value.code} onInput={(v) => set({ code: v.replace(/\D/g, '').slice(0, 3) })} mode="numeric" placeholder="472" label="Código de seguridad de Yape" />
        </Field>
      )}
    </div>
  );
}

function PhotoPickProof({ value, onChange, label, sample, stamp, to, amount }: { value?: string; onChange: (id?: string) => void; label: string; sample: boolean; stamp: string; to: string; amount: number }) {
  return <PhotoPick value={value} onChange={onChange} label={label} kind="pago" sample={{ value: money(amount), label: `a ${to}`, stamp }} sampleOk={sample} />;
}

/** Medio de pago a Mesagri (solo los que tienen cuenta). */
export function MethodSeg({ value, onChange, methods }: { value: MesagriMethod; onChange: (m: MesagriMethod) => void; methods: MesagriMethod[] }) {
  if (methods.length < 2) return null;
  return <Seg value={value} onChange={onChange} options={methods.map(m => ({ v: m, l: PAY_LABEL[m] }))} />;
}
