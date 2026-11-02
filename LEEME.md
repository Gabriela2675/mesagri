# Mesagri · MVP del piloto

Mercado agrícola directo de Arequipa: agricultores, compradores MYPE, almacenes aliados y
transportistas aliados, con el panel del equipo de Mesagri. Construido con el **documento de
diseño v5** (secciones 6, 8, 10, 12, 13, 14 y 15):

| Capa | Qué se usó | Sección |
|---|---|---|
| App y panel | React 19 + Vite (TypeScript) | 14.1, 15 |
| API | NestJS 11 (Node.js LTS), OpenAPI en `/api/docs`, Socket.IO | 14.1, 14.6 |
| Base de datos | **MySQL 8.4 LTS**: 105 tablas del modelo, 4 vistas, 158 llaves foráneas y 49 restricciones `CHECK` | 13 |
| Reglas de negocio | `packages/shared`: las usa la app para orientar y el servidor para imponer | 14.3 |

Es la **app final**: abre con la pantalla de inicio de Mesagri, cada quien se registra o ingresa
con su celular según su tipo de usuario (agricultor, comprador MYPE, almacén aliado o transportista
aliado) y el **equipo de Mesagri va al panel web**, con todas las pantallas de administración.

Viene de tres formas:

- **En la nube (la que se usa con el público)**: <https://mesagri.onrender.com>. El APK, la app en
  el navegador de cualquier celular y el panel web usan el mismo servidor (Render) y la misma base
  de datos (MySQL en Aiven): lo que hace uno lo ven los demás al instante, cada quien según su
  perfil. Ver [En la nube](#en-la-nube-render--aiven).
- **App autónoma**: dentro del APK («Probar sin internet») y como app web instalable (carpeta
  `Mesagri-web`). Todo corre en el celular, sin internet, con datos de ejemplo propios.
- **Con servidor en la laptop**: NestJS + MySQL 8.4 en Windows. Los celulares de la misma red Wi-Fi
  ven los mismos pedidos en vivo, y trae la **demo** para presentar (varios celulares y el panel en
  una pantalla, reloj que se adelanta, guía, modo sin señal).

## Qué se puede hacer

| Tipo de usuario | Funciones |
|---|---|
| Agricultor | Publicar cosecha (formulario o voz), pedidos con plazo y comisión a la vista, confirmar pagos, entregar con código, enviar con transportista (QR), almacén, estado de cuenta, chat, calificaciones, verificación por niveles, **solicitudes de compra** (ofrecer su precio) y **quién publica por mí** (familiar o promotor con permisos) |
| Comprador MYPE | Catálogo con filtros, carrito por agricultor, pago directo (Yape, Plin, transferencia, efectivo), seguimiento, conformidad, reclamos, comprobantes, reportes, favoritos, planes Básico y Pro, **solicitudes de compra**, **pedidos programados** (Pro), **equipo y locales** con permisos |
| Almacén aliado | Reservas, recepción con foto y peso, lotes y certificados, despachos, incidencias, cobros |
| Transportista aliado | Ofertas de envío, ruta del día, recojo con **QR de la cámara**, entrega con código, flete, cobros, **conductores** y **cambio de vehículo** (vuelve a revisión) |
| Equipo de Mesagri (panel web) | Inicio con indicadores, verificaciones (bandeja y expediente), almacenes y transportistas (verificación y red), usuarios y organizaciones (**restablecer acceso**), moderación de publicaciones, pedidos y disputas, reclamos, catálogo y traducciones (**agregar productos**), cobros y estados de cuenta, configuración con aprobación de dos personas, tarifas y rutas de envío, reportes y auditoría. Cada rol (administración, verificación, soporte, analista) ve solo lo suyo |

Botones reales del celular: llamar (abre el marcador), cómo llegar (Google Maps), ubicación de la
chacra (GPS), fotos con la cámara y lectura del QR desde la foto.

## En la nube (Render + Aiven)

| Dirección | Qué es |
|---|---|
| <https://mesagri.onrender.com> | La app: agricultor, comprador MYPE, almacén y transportista |
| <https://mesagri.onrender.com/panel> | Panel del equipo de Mesagri |
| <https://mesagri.onrender.com/demo> | Escenario de la demo (varios celulares y el panel a la vez): pide la **clave del equipo** |

- **Todo en vivo y guardado en la nube**: cada acción se guarda en MySQL (Aiven) y le llega a cada
  celular y al panel por Socket.IO. Las fotos y documentos también se guardan en la base.
- **Cada perfil ve lo suyo** (`packages/shared/src/privacy.ts`): cada quien recibe completo lo de
  su cuenta y lo de sus contrapartes (con quien tiene pedidos, envíos, reservas o solicitudes); de
  las demás cuentas reales, solo lo público (nombre, distrito, publicaciones, calificaciones), sin
  celular, DNI, dirección, cuentas de cobro, mensajes ni reclamos. El panel ve todo menos los
  códigos. Los códigos de entrega, recojo y QR le llegan **sellados** a quien solo debe
  comprobarlos: el celular del agricultor comprueba el código que le dicta el comprador, pero no
  puede leerlo. Las personas de ejemplo son públicas a propósito (se entra con ellas desde
  **Ver cuentas de prueba**).
- **Ingreso con código por WhatsApp** (cuando está configurado, ver abajo): la persona escribe su
  celular, toca **Abrir WhatsApp**, envía el mensaje que aparece listo para el número de Mesagri y
  le llega al instante su código de 6 dígitos. Como el mensaje sale de su propio WhatsApp, prueba
  que el número es suyo. Las **cuentas de prueba** siguen mostrando su código en pantalla (para
  presentar la app sin usuarios); en el celular de quien presenta (con la clave del equipo
  guardada) también se piden por WhatsApp, como sería de verdad. Sin WhatsApp configurado, el
  código se muestra en pantalla (en cuentas reales, solo en el celular donde se creó la cuenta; si
  alguien cambió de celular, el equipo usa **Restablecer acceso** en el panel).
- **Clave del equipo** (`TEAM_KEY`): la genera Render. Se ve en Render → servicio **mesagri** →
  **Environment**. Sirve para entrar a `/demo`, ver las cuentas de prueba del panel (con su
  contraseña y el código vigente del doble factor), adelantar el reloj y reiniciar los datos de
  ejemplo. No la compartas con el público.
- **Plan gratis**: Render duerme el servidor a los 15 minutos sin uso y tarda cerca de un minuto en
  despertarlo (el APK muestra «Conectando con Mesagri…» mientras tanto). Aiven puede apagar la base
  si pasa mucho tiempo sin uso: se vuelve a encender en Aiven → servicio → **Power on**.
- **Actualizar**: cada cambio que se sube a la rama `main` de GitHub se publica solo (Render vuelve
  a compilar). La configuración está en `render.yaml`; la base se conecta con `DATABASE_URL`.

### Código por WhatsApp (sin costo)

Meta no cobra los mensajes que las personas le escriben a Mesagri, y las respuestas (el código)
tienen **1 000 gratis al mes por número**; después, unos centavos cada una. Meta puede pedir un
medio de pago en la cuenta aunque no se pase de las 1 000. Se necesita una cuenta de Facebook
(puede ser nueva, solo para Mesagri) y un número para Mesagri que no esté usando WhatsApp en un
celular (un chip nuevo sirve).

1. **developers.facebook.com** → registrarse como desarrollador → **Crear app** → caso de uso
   **Conectar con clientes por WhatsApp** → crear el portafolio comercial «Mesagri».
2. **WhatsApp → Configuración de la API**: ahí está el número de prueba de Meta (sirve para probar
   con hasta 5 celulares). Para el público: **Agregar número de teléfono** con el número de
   Mesagri, verificarlo con el código por SMS y poner el nombre visible «Mesagri».
3. **Token permanente**: business.facebook.com → **Configuración → Usuarios del sistema** →
   Agregar (administrador) → **Asignar activos** (la app y la cuenta de WhatsApp) → **Generar
   token** con `whatsapp_business_messaging` y `whatsapp_business_management`.
4. **Render → mesagri → Environment**: `WHATSAPP_TOKEN` (el token), `WHATSAPP_PHONE_ID` (el
   identificador del número que se va a usar), `WHATSAPP_APP_SECRET` (en Meta: **Configuración de
   la app → Básica → Clave secreta de la app**) y `WHATSAPP_VERIFY_TOKEN` (una clave que inventes,
   por ejemplo `mesagri-verifica-2026`: la misma se escribe en Meta en el paso 5).
5. **Webhook** (en Meta: **WhatsApp → Configuración**): URL de devolución de llamada
   `https://mesagri.onrender.com/api/v1/whatsapp/webhook`, token de verificación = el valor de
   `WHATSAPP_VERIFY_TOKEN` en Render → **Verificar y guardar** → en **Campos del webhook**,
   suscribir **messages**.
6. **Publicar la app** (modo «Activo»): pide la política de privacidad, que ya está en
   <https://mesagri.onrender.com/privacidad>.

Para revisar que todo quedó bien: `GET /api/v1/demo/whatsapp` con la clave del equipo (número,
mensajes respondidos hoy y el último error).

## App para celulares

| Celular | Qué compartir | Cómo se instala |
|---|---|---|
| **Android 7 o más** | `Mesagri.apk` (por WhatsApp, Google Drive o un enlace) | Abrir el archivo → permitir **Instalar apps desconocidas** para la app con que se abrió (WhatsApp, Drive o Archivos) → **Instalar**. Si Play Protect avisa, **Más detalles → Instalar de todas formas** (la app no está en Play Store). |
| **iPhone** y cualquier celular | El enlace <https://mesagri.onrender.com> | Abrir el enlace en el navegador. En iPhone se puede dejar en la pantalla de inicio con **Compartir → Agregar a inicio**. |

- **El APK (versión 1.1.0) se conecta a la nube**: abre `https://mesagri.onrender.com` y todos ven
  lo mismo según su perfil. Sin internet ofrece **Probar sin internet**: la versión autónoma con
  datos de ejemplo guardados solo en ese celular (desde ahí, **Usar la versión en línea** vuelve a
  la nube). Si la dirección del servidor cambia, en la pantalla de conexión está **Cambiar la
  dirección**. Se instala encima del APK 1.0.0 (misma firma).
- En la versión autónoma **cada celular tiene sus propios datos de ejemplo**. Lo que se haga queda
  guardado en ese celular; en la pantalla de inicio está **Volver a los datos de ejemplo**.
- El código de 6 dígitos para entrar se muestra en pantalla (no hay proveedor de SMS); el panel
  del equipo se abre desde **Ya tengo cuenta → Equipo de Mesagri**, con las cuentas de prueba.
- En el APK funcionan la cámara (fotos y QR), el GPS de la chacra, las llamadas, los mapas, el
  dictado por voz y la guía de audio del celular, y los PDF y CSV se guardan o se comparten.
- **Actualizar el APK**: `MESAGRI_SERVER=https://mesagri.onrender.com bash apps/android/build.sh`
  en Linux (Ubuntu) deja un `Mesagri.apk` nuevo (requisitos en la cabecera del script; sin
  `MESAGRI_SERVER` sale solo la versión autónoma). Se firma con la llave de `apps/android/firma`
  (no está en GitHub): guárdala, porque las actualizaciones necesitan esa misma llave para
  instalarse encima.
- **Publicar la app web**: `npm run build:autonoma` arma la carpeta `apps/web/dist-app`
  (es la misma que `Mesagri-web`); se sube tal cual a cualquier hosting estático con https.

## Con servidor: instalar en Windows (una sola vez)

1. Si llegó como `.zip`, descomprímelo primero (clic derecho → **Extraer todo**), por ejemplo en
   `Documentos\PROYECTOS`. No lo ejecutes desde dentro del `.zip`.
2. Doble clic en **`INSTALAR.cmd`** (si Windows avisa que el archivo viene de internet, elige
   **Ejecutar**).
3. Espera a que termine (la primera vez descarga Node.js si falta y MySQL 8.4, unos 300 MB, y
   tarda de 5 a 15 minutos según la conexión). No necesita permisos de administrador; solo si
   falta el runtime de Visual C++ que pide MySQL, Windows pedirá permiso una vez para instalarlo.
4. Al final se abre el navegador con Mesagri y quedan dos accesos directos en el escritorio:
   **Mesagri (iniciar)** y **Mesagri (detener)**.

**Para actualizar** a una versión nueva: descomprime el `.zip` nuevo encima de la misma carpeta y
vuelve a ejecutar `INSTALAR.cmd`. Cierra solo la versión anterior que esté abierta, conserva los
datos y abre la nueva. Si quieres los datos de ejemplo de la versión nueva, ejecuta después
`REINICIAR-DEMO.cmd`.

Qué hace: deja Node.js y MySQL portátiles dentro de la carpeta `runtime`, crea la base `mesagri`
con un usuario que solo tiene permisos sobre esa base, genera claves al azar en `.env`, instala
las dependencias, compila y arranca. MySQL usa el puerto **3307** (no choca con otro MySQL que
tengas en el 3306) y solo escucha en esta laptop.

> Si Windows pregunta por el Firewall al arrancar, permite el acceso en **redes privadas**: así
> los celulares de la misma red Wi-Fi pueden abrir Mesagri.

## Usar

| Para | Haz |
|---|---|
| Encender | `INICIAR.cmd` (o el acceso directo). Abre <http://localhost:3000> |
| Apagar | `DETENER.cmd`. Los datos quedan guardados en MySQL |
| Volver a los datos de ejemplo | `REINICIAR-DEMO.cmd` (o desde el menú ⋮ de la demo) |

Direcciones (cambia `localhost` por la IP de la laptop para entrar desde un celular):

- **<http://localhost:3000/>** · **la app**: pantalla de inicio, registro e ingreso con código según tu
  tipo de usuario. Si eliges «Equipo de Mesagri», te lleva al panel web.
- **<http://localhost:3000/panel>** · **el panel web del equipo**: correo, contraseña y doble factor.
- **<http://localhost:3000/demo>** · escenario de la demo: 3 celulares y el panel web lado a lado, reloj, guía.
- **<http://localhost:3000/api/docs>** · el API documentado (OpenAPI/Swagger), para probar cada ruta.

Para tenerla como app en el celular: ábrela en Chrome y toca ⋮ → **Agregar a la pantalla principal**.

Cuentas de prueba (en la app: «Ya tengo cuenta» → tu tipo → «Ver cuentas de prueba», o escribe el
celular y toca «Pedir código»; el código de 6 dígitos sale en pantalla porque en la demo no hay
proveedor de WhatsApp o SMS; en el piloto llegaría por mensaje):

| Tipo | Cuenta | Celular |
|---|---|---|
| Agricultor | Don Héctor Mendoza (nivel 3, Camaná) | 951 234 678 |
| Agricultor | Wilber Huamaní (nivel 2, Yanque) | 987 654 321 |
| Agricultor | Doña Justina Mamani (nivel 1, Yanque) | 974 112 358 |
| Agricultor (ayuda) | Nayeli, hija de Wilber: publica y atiende por él | 973 214 568 |
| Comprador MYPE | Doña Charo · Picantería Los Geranios (plan Básico) | 959 300 412 |
| Comprador MYPE | Andrés · Hotel Los Andes (plan Pro, titular) | 984 551 230 |
| Comprador MYPE (equipo) | Rosa · cocina del Hotel Los Andes: solo hace pedidos | 958 741 236 |
| Almacén aliado | Don Ernesto · Molinera La Pampa | 954 109 870 |
| Transportista aliado | Julio Apaza · Transportes Majes | 942 615 418 |

- **Panel**: carlos@mesagri.pe, monica@mesagri.pe (administración), lucia@mesagri.pe (verificación),
  diana@mesagri.pe (soporte), ana@mesagri.pe (analista). Clave: `demo-mesagri`. El código del doble
  factor lo llenan los botones «Cuentas de prueba del equipo» (cambia cada 30 segundos).
- Si un celular está registrado con otro tipo, la app lo avisa y ofrece entrar con el tipo correcto.

Todo lo que se hace queda en MySQL y se ve en vivo en los demás celulares conectados.

## Ver la base de datos

MySQL 8.4 en `127.0.0.1:3307`, base `mesagri`, usuario `mesagri`; la clave está en `.env`
(`DB_PASSWORD`). Sirve cualquier cliente: MySQL Workbench, DBeaver o la extensión de MySQL de VS Code.
Consultas para empezar:

```sql
SELECT * FROM v_active_listings;          -- catálogo del comprador
SELECT * FROM v_verification_queue;       -- bandeja del verificador
SELECT * FROM v_seller_inbox;             -- pedidos de cada agricultor
SELECT * FROM v_monthly_sales;            -- ventas conformes por mes (base de la comisión)
SELECT seq, type, actor_uuid, simulated_at FROM sync_events ORDER BY seq DESC LIMIT 20;
```

## Cómo está armado

```
mesagri/
├─ apps/
│  ├─ api/        NestJS: auth, verificación, catálogo, pedidos, pagos, entrega, chat,
│  │              calificaciones, soporte, administración, almacenes, cobros, envíos, archivos
│  ├─ web/        React + Vite: app de los cuatro tipos de usuario, panel web y escenario de la demo
│  │              (src/app/local: el «servidor» que corre dentro del celular en la versión autónoma)
│  └─ android/    APK: WebView conectado a la nube (o con la app autónoma), cámara, GPS, voz, archivos (build.sh)
├─ packages/
│  └─ shared/     reglas puras (máquina de estados, topes, comisiones, fletes, plazos) y tipos
├─ db/migrations  esquema MySQL versionado (0001 a 0009)
├─ scripts/       instalación y arranque en Windows
├─ infra/         Docker Compose (MySQL 8.4 + API) para un servidor
└─ docs/          arquitectura y decisiones
```

- El servidor es la fuente de la verdad: aplica cada acción con las reglas de `packages/shared`,
  la guarda en MySQL **en una transacción** (solo las filas que cambiaron) y a cada celular le
  manda por Socket.IO solo las entidades que cambiaron y su perfil puede ver
  (`packages/shared/src/patch.ts` y `privacy.ts`). Al arrancar arma todo leyendo las tablas.
- La hora la pone el servidor (reloj de la demo); los códigos de entrega y recojo los genera él
  al azar; las cuentas de cobro y los códigos van cifrados con AES-256-GCM (14.9).
- Sin señal, el celular guarda lo que hace y lo envía al volver, sin duplicar (14.5).

Más detalle en [`docs/arquitectura.md`](docs/arquitectura.md).

## Para desarrollar

```bash
npm ci                 # dependencias
npm run build          # shared, API y web
npm run dev:api        # API en http://localhost:3000 (necesita MySQL y .env)
npm run dev:web        # web con recarga en http://localhost:5173 (usa la API del 3000)
npm test               # reglas y privacidad (33 pruebas), MySQL ida y vuelta y API completo (16 pruebas)
npm run e2e            # recorridos de punta a punta con el servidor (25 pruebas; con
                       # MESAGRI_TEAM_KEY=... prueba también la clave del equipo, como en la nube)
npm run build:autonoma # app autónoma en apps/web/dist-app (APK y app web instalable)
npm run apk            # Mesagri.apk (Linux, ver apps/android/build.sh)
# recorridos en la versión autónoma (21 pruebas): servir dist-app y
# MESAGRI_WEB=http://localhost:8090 MESAGRI_LOCAL=1 npx playwright test (en apps/web)
```

Variables en `.env` (ver `.env.example`): puertos, conexión a MySQL (o `DATABASE_URL`),
`JWT_SECRET`, `DATA_KEY`, `DEMO_MODE`, `DEMO_CLOCK` (`resume`: el reloj de la demo sigue donde quedó
al apagar), `TEAM_KEY` (clave del equipo; sin ella, como en la laptop, todo queda abierto),
`TRUST_PROXY` y `FILES_STORAGE`.

## Si algo falla

- **Sale «Falta reiniciar Mesagri» o una pantalla dice «no se pudo mostrar»**: quedó abierto el
  servidor de una versión anterior. Ejecuta `DETENER.cmd` y luego `INICIAR.cmd` (INICIAR también lo
  detecta y lo reemplaza solo).
- **Los registros** están en `logs/` (`instalar.log`, `api.log`) y el de MySQL en `runtime/mysql-error.log`.
- **Puerto ocupado**: el instalador elige el siguiente libre y lo anota en `.env`.
- **MySQL no arranca y falta VCRUNTIME140**: instala el «Visual C++ Redistributable 2015-2022 (x64)»
  de Microsoft y vuelve a ejecutar `INSTALAR.cmd`.
- **Volver a instalar desde cero**: `DETENER.cmd`, borra las carpetas `runtime` y `node_modules` y el
  archivo `.env`, y ejecuta `INSTALAR.cmd`.

---
Personas, negocios y montos son de ejemplo. Mesagri no mueve dinero: los pagos son directos entre
las partes. Proyecto académico (UCSM).
