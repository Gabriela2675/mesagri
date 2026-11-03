import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
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

/* Visión por computadora: los modelos del rostro (los usa la app al tomar las fotos: detector y
 * puntos de la cara) y, solo en la versión con servidor, lo del panel (parecido del rostro y lector
 * de texto para el código del reverso del DNI). Se copian desde node_modules a /vision y /ocr. */
const req = createRequire(import.meta.url);
const pkgDir = (name: string) => path.dirname(req.resolve(name + '/package.json'));
function visionFiles(mode: string): Record<string, string> {
  const face = path.join(pkgDir('@vladmandic/face-api'), 'model');
  const nets = ['tiny_face_detector_model', 'face_landmark_68_model', ...(mode === 'autonoma' ? [] : ['face_recognition_model', 'ssd_mobilenetv1_model'])];
  const out: Record<string, string> = {};
  for (const n of nets) for (const f of [`${n}-weights_manifest.json`, `${n}.bin`]) out[`vision/${f}`] = path.join(face, f);
  if (mode !== 'autonoma') {
    out['ocr/worker.min.js'] = path.join(pkgDir('tesseract.js'), 'dist/worker.min.js');
    out['ocr/tesseract-core-simd-lstm.wasm.js'] = path.join(pkgDir('tesseract.js-core'), 'tesseract-core-simd-lstm.wasm.js');
    out['ocr/tesseract-core-lstm.wasm.js'] = path.join(pkgDir('tesseract.js-core'), 'tesseract-core-lstm.wasm.js');
    out['ocr/eng.traineddata.gz'] = path.join(pkgDir('@tesseract.js-data/eng'), '4.0.0_best_int/eng.traineddata.gz');
  }
  return out;
}
function visionAssets(mode: string): Plugin {
  const files = visionFiles(mode);
  return {
    name: 'mesagri-vision',
    // en la compilación van como archivos del paquete (el service worker los ve en la lista)
    generateBundle() { for (const [fileName, from] of Object.entries(files)) this.emitFile({ type: 'asset', fileName, source: fs.readFileSync(from) }); },
    // en desarrollo se sirven directo de node_modules
    configureServer(server) {
      server.middlewares.use((rq, res, next) => {
        const u = (rq.url ?? '').split('?')[0].replace(/^\//, '');
        const from = files[u];
        if (!from) return next();
        res.setHeader('Content-Type', u.endsWith('.json') ? 'application/json' : u.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
        fs.createReadStream(from).pipe(res);
      });
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
  plugins: mode === 'autonoma' ? [react(), visionAssets(mode), offlineApp()] : [react(), visionAssets(mode)],
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
