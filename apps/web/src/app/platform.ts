/*
 * Descargas generadas por la app (constancias, comprobantes y reportes en PDF o CSV).
 */
export const SAVE_UNAVAILABLE = 'Este navegador no permite descargar archivos desde aquí. Prueba con Chrome o Edge.';

/** Puente con el APK de Android (guardar y compartir archivos). */
interface AndroidBridge { saveFile(base64: string, filename: string, mime: string): void }
const android = (): AndroidBridge | undefined => (typeof window !== 'undefined' ? (window as any).MesagriAndroid : undefined);

function mimeOf(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  return ext === 'pdf' ? 'application/pdf' : ext === 'csv' ? 'text/csv' : ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'application/octet-stream';
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/** Descarga un archivo generado en el navegador (en el APK: guardar o compartir con el celular). */
export async function saveFile(filename: string, data: Blob | Uint8Array | string): Promise<'saved' | 'declined' | 'fallback' | 'error' | 'unavailable'> {
  try {
    const blob = data instanceof Blob ? data : new Blob([data as BlobPart]);
    const bridge = android();
    if (bridge) { bridge.saveFile(await toBase64(blob), filename, blob.type || mimeOf(filename)); return 'saved'; }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return 'saved';
  } catch { return 'error'; }
}

/** Llama por teléfono (en el celular abre el marcador). */
export function callPhone(phone?: string): boolean {
  const digits = String(phone ?? '').replace(/\D/g, '');
  if (digits.length < 9) return false;
  try { window.location.href = `tel:+51${digits.slice(-9)}`; return true; } catch { return false; }
}

/** Abre la navegación (Google Maps) hacia una dirección; en el celular se abre la app de mapas. */
export function openMap(destination: string): void {
  try { window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`, '_blank', 'noopener'); } catch { /* sin ventana */ }
}
