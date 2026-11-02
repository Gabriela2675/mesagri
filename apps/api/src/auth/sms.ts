/*
 * Código de ingreso por SMS sin costo por mensaje: un celular Android con chip (de preferencia con
 * SMS ilimitados) y la app gratuita «SMS Gateway for Android» (SMSGate, código abierto) en modo nube.
 * El servidor le pide al celular que mande el SMS; la persona lo recibe como un mensaje normal desde
 * ese número.
 *
 * El texto va sin tildes (así entra en un solo SMS) y termina con «@dominio #código»: en Chrome de
 * Android la app lo completa sola (WebOTP).
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CONFIG } from '../config';

export class SmsError extends Error {
  constructor(readonly userMessage: string, detail?: string) { super(detail ?? userMessage); }
}

const SC = CONFIG.sms;

@Injectable()
export class SmsService implements OnModuleInit {
  private readonly log = new Logger('SMS');
  private day = '';
  private count = 0;
  private lastError?: string;

  get configured(): boolean { return !!(SC.user && SC.password); }

  onModuleInit() {
    if (this.configured) this.log.log('Códigos por SMS desde el celular de Mesagri (SMS Gateway for Android)');
  }

  private today(): number {
    const d = new Date().toISOString().slice(0, 10);
    if (d !== this.day) { this.day = d; this.count = 0; }
    return this.count;
  }

  status() { return { configured: this.configured, sentToday: this.today(), lastError: this.lastError }; }

  /** Texto del SMS: corto, sin tildes y con la línea para que Chrome complete el código solo. */
  static text(code: string, host?: string): string {
    const base = `Tu codigo de Mesagri es ${code}. Vence en 5 min. No lo compartas con nadie.`;
    return host ? `${base}\n\n@${host} #${code}` : base;
  }

  /** Manda un SMS a un celular de Perú (9 dígitos). */
  async send(phone9: string, text: string): Promise<void> {
    if (!this.configured) throw new SmsError('Los SMS no están configurados.');
    if (this.today() >= SC.dailyMax) throw new SmsError('Hoy ya se enviaron todos los SMS que permite Mesagri. Intenta mañana.');
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 15_000);
    try {
      const r = await fetch(`${SC.url}/messages`, {
        method: 'POST',
        headers: { Authorization: 'Basic ' + Buffer.from(`${SC.user}:${SC.password}`).toString('base64'), 'Content-Type': 'application/json' },
        body: JSON.stringify({ textMessage: { text }, phoneNumbers: ['+51' + String(phone9).replace(/\D/g, '').slice(-9)], ttl: 300, ...(SC.sim ? { simNumber: SC.sim } : {}) }),
        signal: ctl.signal,
      });
      if (!r.ok) {
        const body = await r.text().catch(() => '');
        const why = r.status === 401 || r.status === 403 ? 'La conexión con el celular que envía los SMS no está activa.'
          : r.status === 429 || r.status === 503 ? 'El celular que envía los SMS está ocupado. Intenta en un minuto.'
          : 'No pudimos enviar el SMS en este momento.';
        throw new SmsError(why, `SMSGate ${r.status}: ${body.slice(0, 200)}`);
      }
      this.count++;
      this.lastError = undefined;
    } catch (e) {
      const err = e instanceof SmsError ? e : new SmsError('No pudimos conectar con el celular que envía los SMS.', String((e as Error)?.message ?? e));
      this.lastError = err.message;
      this.log.warn(`No se pudo mandar el SMS a ${String(phone9).slice(0, 3)}•••${String(phone9).slice(-2)}: ${err.message}`);
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}
