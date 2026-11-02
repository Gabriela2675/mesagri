// Íconos del APK a partir del logo de Mesagri (apps/web/public/brand/mesagri-mark.svg).
// Uso: node tools/iconos.cjs  (necesita Playwright con Chromium, que ya usa el proyecto para las pruebas)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const mark = fs.readFileSync(path.resolve(__dirname, '../../web/public/brand/mesagri-mark.svg'), 'utf8');
const inner = mark.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
const res = path.resolve(__dirname, '../res');
const DENS = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
function svg(size, { bg, radius, scale, color }) {
  const h = size * scale, w = h * 1600 / 1840;
  const x = (size - w) / 2, y = (size - h) / 2 + size * 0.01;
  const art = inner.replace(/fill="#[0-9A-Fa-f]{6}"/g, `fill="${color}"`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    (bg ? `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1E3F20"/><stop offset="1" stop-color="#2C5F2D"/></linearGradient></defs><rect width="${size}" height="${size}" rx="${radius * size}" fill="url(#g)"/>` : '') +
    `<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="80 80 1600 1840">${art}</svg></svg>`;
}
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  const shot = async (file, size, o) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await p.setViewportSize({ width: size, height: size });
    await p.setContent(`<html><body style="margin:0;background:transparent">${svg(size, o)}</body></html>`);
    await p.screenshot({ path: file, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  };
  for (const [d, k] of Object.entries(DENS)) {
    // ícono clásico (Android 7): cuadrado verde con esquinas redondeadas
    await shot(`${res}/mipmap-${d}/ic_launcher.png`, Math.round(48 * k), { bg: true, radius: 0.2, scale: 0.72, color: '#B0D6B2' });
    // ícono adaptable (Android 8 o más): solo el dibujo, dentro de la zona segura
    await shot(`${res}/mipmap-${d}/ic_launcher_fg.png`, Math.round(108 * k), { bg: false, radius: 0, scale: 0.5, color: '#B0D6B2' });
  }
  await b.close();
})();
