import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/* App web instalable: un service worker que guarda la app en el celular para abrirla sin señal.
 * Lleva la lista de archivos de esta compilación; al publicar una versión nueva, se actualiza solo. */
function offlineApp(): Plugin {
  let outDir = 'dist-app';
  return {
    name: 'mesagri-sin-senal',
    apply: 'build',
    configResolved(c) { outDir = c.build.outDir; },
    writeBundle() {
      const root = path.resolve(__dirname, outDir);
      const files: string[] = [];
      const walk = (d: string) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else files.push(path.relative(root, p).split(path.sep).join('/')); } };
      walk(root);
      const list = files.filter(f => f !== 'sw.js').sort();
      const version = createHash('sha256').update(list.join('|') + fs.readFileSync(path.join(root, 'index.html'))).digest('hex').slice(0, 12);
      const tpl = fs.readFileSync(path.resolve(__dirname, 'sw.template.js'), 'utf8');
      fs.writeFileSync(path.join(root, 'sw.js'), tpl.replace('__VERSION__', version).replace('__FILES__', JSON.stringify(['./', ...list.map(f => './' + f)])));
    },
  };
}

const shared = fileURLToPath(new URL('../../packages/shared/src', import.meta.url));
const api = process.env.MESAGRI_API ?? 'http://localhost:3000';

/* App de los cuatro perfiles, panel web y escenario de la demo. En desarrollo, /api y /socket.io van a la API.
 * «vite build --mode autonoma» arma la versión que corre sola en el celular (APK y app web instalable):
 * rutas relativas, sin servidor y en la carpeta dist-app. */
export default defineConfig(({ mode }) => ({
  base: mode === 'autonoma' ? './' : '/',
  define: mode === 'autonoma' ? { 'import.meta.env.VITE_LOCAL': JSON.stringify('1') } : {},
  plugins: mode === 'autonoma' ? [react(), offlineApp()] : [react()],
  resolve: { alias: [{ find: /^@mesagri\/shared$/, replacement: shared + '/index.ts' }, { find: /^@mesagri\/shared\/(.*)$/, replacement: shared + '/$1' }] },
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: api, changeOrigin: false },
      '/socket.io': { target: api, ws: true },
    },
  },
  preview: { host: true, port: 5173, strictPort: true, proxy: { '/api': { target: api }, '/socket.io': { target: api, ws: true } } },
  build: { outDir: mode === 'autonoma' ? 'dist-app' : 'dist', sourcemap: false, chunkSizeWarningLimit: 2000 },
}));
