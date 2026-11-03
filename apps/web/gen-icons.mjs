// Genera src/app/icons.gen.ts con los íconos de Lucide que usa la app (licencia ISC).
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const names = `house shopping-bag plus warehouse user bell mic camera banknote truck shield-check star globe volume-2
circle-question-mark building chevron-left chevron-right chevron-down chevron-up check x clock map-pin phone send message-circle
triangle-alert info search sliders-horizontal shopping-cart chart-column package calendar file-text qr-code scale sprout
store repeat download share-2 lock eye wifi-off wifi refresh-cw log-out settings percent users clipboard-list route
navigation wallet circle-check circle circle-alert play square trash pencil copy layout-dashboard clock-arrow-left languages
list badge-check heart image upload timer trending-up flag book-open smartphone credit-card landmark wheat leaf map wrench
siren minus arrow-right receipt hand-coins box boxes file-check scroll-text gauge user-check user-x ban circle-dot
fast-forward rotate-ccw monitor sparkles megaphone tag external-link menu ellipsis-vertical mail key-round id-card scan-line
tractor cloud-upload signal bike container thumbs-up headphones square-pen hourglass circle-x clipboard-check
file-exclamation-point map-pinned undo-2 save notebook-pen calendar-clock circle-user circle-play pause audio-lines
arrow-left trending-down zap eye-off scan-face aperture arrow-big-left arrow-big-right`.split(/\s+/).filter(Boolean);
const dir = path.resolve('node_modules/lucide/dist/esm/icons');
const out = {};
for (const n of names) {
  const mod = await import(pathToFileURL(path.join(dir, n + '.mjs')).href);
  out[n] = mod.default;
}
const header = `/* Íconos de Lucide v1.48.0 (https://lucide.dev), licencia ISC. Generado por scripts/gen-icons.mjs. */\n`;
fs.writeFileSync('src/app/icons.gen.ts', header + 'export const ICONS: Record<string, [string, Record<string, string | number>][]> = ' + JSON.stringify(out) + ';\n');
console.log('icons', names.length);
