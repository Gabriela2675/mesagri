/*
 * Código de ingreso por WhatsApp (API de WhatsApp Business de Meta, «Cloud API»).
 *
 * Modo «responder» (el normal, sin costo): la persona escribe primero. La app abre WhatsApp con el
 * mensaje listo para el número de Mesagri («Hola Mesagri, quiero mi código…»); Meta avisa a este
 * servidor (webhook) y se le responde con el código. El mensaje llega desde su propio WhatsApp, así
 * que prueba que el número es suyo. Meta no cobra los mensajes que llegan, y las respuestas dentro
 * de las 24 horas tienen 1 000 gratis al mes por número.
 *
 * Modo «plantilla»: Mesagri escribe primero con una plantilla de autenticación («123456 es tu código
 * de verificación.», botón «Copiar código»). Meta cobra cada una. Si está WHATSAPP_WABA_ID, el
 * servidor crea la plantilla al arrancar.
 *
 * Hay un tope diario de mensajes (WHATSAPP_DAILY_MAX). Con el número de prueba de Meta solo se puede
 * hablar con los celulares agregados en la configuración (hasta 5).
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import crypto from 'node:crypto';
import { CONFIG } from '../config';

export class WhatsAppError extends Error {
  constructor(readonly userMessage: string, readonly metaCode?: number, detail?: string) { super(detail ?? userMessage); }
}

export interface WhatsAppStatus {
  configured: boolean;
  mode: 'responder' | 'plantilla';
  /** número de Mesagri (+51 …) al que se escribe para pedir el código */
  number?: string;
  webhook: boolean;
  template?: string;
  templateStatus?: string;
  presenter: boolean;
  sentToday: number;
  receivedToday: number;
  lastError?: string;
}

/** Un mensaje que una persona le escribió a Mesagri por WhatsApp. */
export interface Inbound { id: string; from: string; text: string; name?: string }

const WC = CONFIG.whatsapp;

/** Lo que entiende una persona de cada error de Meta. */
function explain(code: number | undefined, message: string): string {
  switch (code) {
    case 131030: return 'Ese número todavía no está habilitado para recibir mensajes de Mesagri (WhatsApp en versión de prueba).';
    case 131026: return 'No pudimos entregar el WhatsApp a ese número. Revisa que tenga WhatsApp.';
    case 132001: case 132000: case 132012: return 'El mensaje del código todavía no está aprobado por WhatsApp. Intenta en unos minutos.';
    case 190: case 10: case 200: return 'La conexión de Mesagri con WhatsApp no está activa.';
    case 130429: case 131056: case 4: case 80007: return 'WhatsApp está recibiendo muchos pedidos. Intenta en un minuto.';
    default: return /phone|number/i.test(message) ? 'Ese número no puede recibir WhatsApp de Mesagri.' : 'No pudimos enviar el WhatsApp en este momento.';
  }
}

@Injectable()
export class WhatsAppService implements OnModuleInit {
  private readonly log = new Logger('WhatsApp');
  private day = '';
  private count = 0;
  private received = 0;
  private templateStatus?: string;
  private checkedAt = 0;
  private lastError?: string;
  private number = WC.number;
  private seen = new Set<string>();

  get configured(): boolean { return !!(WC.token && WC.phoneId); }
  /** La persona escribe primero y se le responde (sin costo). */
  get responder(): boolean { return this.configured && WC.mode === 'responder'; }

  async onModuleInit() {
    if (!this.configured) return;
    if (WC.mode === 'responder') {
      this.log.log('Códigos por WhatsApp: la persona escribe a Mesagri y se le responde con el código');
      if (!WC.verifyToken) this.log.warn('Falta WHATSAPP_VERIFY_TOKEN: sin él no se puede conectar el webhook en Meta');
      if (!WC.appSecret) this.log.warn('Falta WHATSAPP_APP_SECRET: los mensajes que llegan no se pueden comprobar');
      void this.businessNumber().catch(e => this.log.warn(`Número de WhatsApp: ${e?.message ?? e}`));
    } else {
      this.log.log(`Códigos por WhatsApp con plantilla «${WC.template}» (${WC.lang})`);
      // no demora el arranque: la plantilla se revisa (y se crea si falta) por detrás
      void this.ensureTemplate().catch(e => this.log.warn(`Plantilla: ${e?.message ?? e}`));
    }
  }

  /** Número de WhatsApp de Mesagri en dígitos (51987654321): de WHATSAPP_NUMBER o de Meta. */
  async businessNumber(): Promise<string | undefined> {
    if (this.number) return this.number;
    const r = await this.graph(`${WC.phoneId}?fields=display_phone_number,verified_name`);
    const digits = String(r?.display_phone_number ?? '').replace(/\D/g, '');
    if (digits) { this.number = digits; this.log.log(`Número de WhatsApp de Mesagri: +${digits}${r?.verified_name ? ` (${r.verified_name})` : ''}`); }
    return this.number || undefined;
  }

  /** Enlace que abre WhatsApp con el mensaje listo para Mesagri. */
  async link(text: string): Promise<{ link: string; number: string } | undefined> {
    const n = await this.businessNumber().catch(() => undefined);
    if (!n) return undefined;
    return { link: `https://wa.me/${n}?text=${encodeURIComponent(text)}`, number: '+' + n };
  }

  /** ¿El mensaje viene de Meta? (firma X-Hub-Signature-256 con el «App secret») */
  signatureOk(raw: Buffer | undefined, header: string | undefined): boolean {
    if (!WC.appSecret) return true;
    if (!raw || !header?.startsWith('sha256=')) return false;
    const want = Buffer.from(crypto.createHmac('sha256', WC.appSecret).update(raw).digest('hex'));
    const got = Buffer.from(header.slice(7));
    return want.length === got.length && crypto.timingSafeEqual(want, got);
  }

  /** Mensajes de personas en el aviso de Meta (sin repetir los que ya se atendieron). */
  inbound(payload: any): Inbound[] {
    const out: Inbound[] = [];
    for (const e of payload?.entry ?? []) for (const ch of e?.changes ?? []) {
      const v = ch?.value;
      if (ch?.field !== 'messages' || !v?.messages) continue;
      if (WC.phoneId && v?.metadata?.phone_number_id && String(v.metadata.phone_number_id) !== WC.phoneId) continue;
      const names = new Map<string, string>((v.contacts ?? []).map((c: any) => [String(c?.wa_id), String(c?.profile?.name ?? '')]));
      for (const m of v.messages) {
        const id = String(m?.id ?? '');
        if (!id || this.seen.has(id)) continue;
        this.seen.add(id);
        if (this.seen.size > 2000) this.seen.delete(this.seen.values().next().value as string);
        const text = String(m?.text?.body ?? m?.button?.text ?? m?.interactive?.button_reply?.title ?? m?.interactive?.list_reply?.title ?? '');
        out.push({ id, from: String(m?.from ?? '').replace(/\D/g, ''), text, name: names.get(String(m?.from)) || undefined });
        this.received++;
      }
    }
    return out;
  }

  /** Respuesta de texto dentro de las 24 horas después de que la persona escribió (sin plantilla). */
  async sendText(to: string, body: string): Promise<void> {
    if (!this.configured) throw new WhatsAppError('WhatsApp no está configurado.');
    if (this.today() >= WC.dailyMax) throw new WhatsAppError('Hoy ya se respondieron todos los mensajes que permite Mesagri. Intenta mañana.');
    try {
      await this.graph(`${WC.phoneId}/messages`, { body: { messaging_product: 'whatsapp', recipient_type: 'individual', to: String(to).replace(/\D/g, ''), type: 'text', text: { preview_url: false, body } } });
      this.count++;
      this.lastError = undefined;
    } catch (e) {
      this.lastError = (e as Error).message;
      this.log.warn(`No se pudo responder por WhatsApp: ${(e as Error).message}`);
      throw e;
    }
  }

  private async graph(path: string, init: { method?: string; body?: unknown } = {}): Promise<any> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 15_000);
    try {
      const r = await fetch(`${WC.apiBase}/${WC.apiVersion}/${path}`, {
        method: init.method ?? (init.body ? 'POST' : 'GET'),
        headers: { Authorization: `Bearer ${WC.token}`, 'Content-Type': 'application/json' },
        body: init.body ? JSON.stringify(init.body) : undefined,
        signal: ctl.signal,
      });
      const text = await r.text();
      let j: any;
      try { j = text ? JSON.parse(text) : {}; } catch { j = { raw: text.slice(0, 200) }; }
      if (!r.ok || j?.error) {
        const code = Number(j?.error?.code) || undefined;
        const msg = String(j?.error?.error_data?.details ?? j?.error?.message ?? `HTTP ${r.status}`);
        throw new WhatsAppError(explain(code, msg), code, `Meta ${code ?? r.status}: ${msg}`);
      }
      return j;
    } catch (e) {
      if (e instanceof WhatsAppError) throw e;
      throw new WhatsAppError('No pudimos conectar con WhatsApp en este momento.', undefined, String((e as Error)?.message ?? e));
    } finally {
      clearTimeout(timer);
    }
  }

  /** Revisa la plantilla del código y, si falta y se conoce la cuenta de WhatsApp Business, la crea. */
  async ensureTemplate(): Promise<string | undefined> {
    if (!this.configured || !WC.wabaId) return this.templateStatus;
    const list = await this.graph(`${WC.wabaId}/message_templates?name=${encodeURIComponent(WC.template)}&fields=name,status,language,category&limit=50`);
    const mine = (list?.data ?? []).find((t: any) => t.name === WC.template && t.language === WC.lang);
    if (mine) {
      this.templateStatus = String(mine.status);
    } else {
      const created = await this.graph(`${WC.wabaId}/message_templates`, {
        body: {
          name: WC.template,
          language: WC.lang,
          category: 'authentication',
          components: [
            { type: 'body', add_security_recommendation: true },
            { type: 'footer', code_expiration_minutes: 5 },
            { type: 'buttons', buttons: [{ type: 'otp', otp_type: 'copy_code', text: 'Copiar código' }] },
          ],
        },
      });
      this.templateStatus = String(created?.status ?? 'PENDING');
      this.log.log(`Plantilla «${WC.template}» creada: ${this.templateStatus}`);
    }
    this.checkedAt = Date.now();
    return this.templateStatus;
  }

  async status(): Promise<WhatsAppStatus> {
    if (this.configured && WC.mode === 'plantilla' && WC.wabaId && Date.now() - this.checkedAt > 60_000) {
      try { await this.ensureTemplate(); } catch (e: any) { this.lastError = e?.message; }
    }
    const n = this.configured ? await this.businessNumber().catch(() => undefined) : undefined;
    return {
      configured: this.configured, mode: WC.mode, number: n ? '+' + n : undefined, webhook: !!WC.verifyToken,
      ...(WC.mode === 'plantilla' ? { template: WC.template, templateStatus: this.templateStatus } : {}),
      presenter: WC.mode === 'plantilla' ? WC.demoTo.length > 0 : this.configured, sentToday: this.today(), receivedToday: this.received, lastError: this.lastError,
    };
  }

  private today(): number {
    const d = new Date().toISOString().slice(0, 10);
    if (d !== this.day) { this.day = d; this.count = 0; this.received = 0; }
    return this.count;
  }

  /** Manda el código a un número (con código de país, sin +: 51987654321). */
  async sendCode(to: string, code: string): Promise<void> {
    if (!this.configured) throw new WhatsAppError('WhatsApp no está configurado.');
    if (this.today() >= WC.dailyMax) throw new WhatsAppError('Hoy ya se enviaron todos los códigos por WhatsApp que permite Mesagri. Intenta mañana.');
    const digits = String(to).replace(/\D/g, '');
    try {
      await this.graph(`${WC.phoneId}/messages`, {
        body: {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: digits,
          type: 'template',
          template: {
            name: WC.template,
            language: { code: WC.lang },
            components: [
              { type: 'body', parameters: [{ type: 'text', text: code }] },
              { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] },
            ],
          },
        },
      });
      this.count++;
      this.lastError = undefined;
    } catch (e) {
      const err = e as WhatsAppError;
      this.lastError = err.message;
      this.log.warn(`No se pudo mandar el código a ${digits.slice(0, 4)}•••${digits.slice(-2)}: ${err.message}`);
      if (err.metaCode && [132001, 132000].includes(err.metaCode)) void this.ensureTemplate().catch(() => undefined);
      throw err;
    }
  }
}
