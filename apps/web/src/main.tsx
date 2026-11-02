/* Mesagri · punto de entrada de la web: la app (/), el panel del equipo (/panel) y el escenario de la demo (/demo). */
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/nunito';
import '@fontsource-variable/fraunces';
import './styles.css';
import './app/screens/all';
import { Stage } from './app/stage';
import { LOCAL, IN_APK } from './app/routes';
import { captureInstall } from './app/install';

// App web instalable (versión autónoma): se guarda en el celular para abrirse sin señal
if (LOCAL && !IN_APK) {
  captureInstall();
  try {
    if ('serviceWorker' in navigator && window.isSecureContext) {
      addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => { /* sin service worker: igual funciona */ }); });
    }
  } catch { /* navegador antiguo */ }
}

const root = document.getElementById('mesagri-root');
if (root) createRoot(root).render(<Stage />);
