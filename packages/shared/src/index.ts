/*
 * @mesagri/shared · reglas de negocio puras (sección 14.3 del documento de diseño).
 * La app las usa para orientar al usuario antes de enviar; el servidor las impone.
 */
export * from './types';
export * from './settings';
export * from './catalog';
export * from './ubigeo';
export * from './time';
export * from './format';
export * from './ids';
export * from './rules';
export * from './identity';
export * from './queries';
export * from './voice';
export * from './i18n-keys';
export * from './seed';
export * from './engine/index';
export { HANDLERS, SYSTEM_USER, notify, audit, NOTIF_CAP, AUDIT_CAP } from './engine/core';
export { MSG_CAP } from './engine/orders';
export { nextDeadline, hasDue } from './engine/tick';
export { fmtVal, accruedRent } from './engine/billing';
export { canDo, isTitular, memberOf, isPro, FREQ_LABEL, nextWeekday, scheduleRunAt, draftExpiresAt, buildDraft, farmersFor, localOf, MEMBER_PERM, ADMIN_ROLE_INFO } from './engine/r2';
export { PROTOCOL } from './protocol';
export * from './privacy';
export * from './patch';
export { defaultPrefs } from './engine/accounts';
