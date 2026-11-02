# Arquitectura del MVP

Cómo se aplicaron las secciones 13 (modelo de datos) y 14 (arquitectura y API) del documento de
diseño v5, y qué se simplificó para el MVP.

## Piezas

```
Celulares y panel (React)  ──HTTP /api/v1 + Socket.IO /sync──▶  API (NestJS)  ──mysql2──▶  MySQL 8.4
        │                                                          │
        └──── mismas reglas: packages/shared (motor de reglas) ────┘
```

- **packages/shared** · reglas puras: máquina de estados del pedido (12.3), topes por nivel
  (10.6), comisión con 5 ventas gratis y 3 % desde la sexta (RN-14), efectivo con el envío
  incluido (D-02), fletes (RF-TRA-08), almacenes (RN-43 a RN-48), plazos (14.7). La app las usa
  para orientar antes de enviar; el servidor las impone.
- **apps/api** · NestJS con módulos por dominio, guardias por rol y pertenencia, errores
  `application/problem+json`, `Idempotency-Key`, OpenAPI en `/api/docs` y Socket.IO.
- **apps/web** · una sola app React con tres entradas: **`/`** es la app del celular (pantalla de
  inicio, registro e ingreso según el tipo de usuario, y los cuatro perfiles: agricultor, MYPE,
  almacén y transportista), **`/panel`** es el panel web del equipo y **`/demo`** el escenario de la
  demo. Se instala como app (manifiesto web e íconos con el logo de Mesagri).
- **db/migrations** · esquema versionado. Se aplica solo al arrancar (`schema_migrations`).

## Cómo se guarda cada acción

1. El celular hace la acción y la ve al instante (optimista). La acción va a una cola local con
   un id creado en el celular.
2. La API la recibe con el token del usuario: **el actor sale del token**, nunca del cliente.
3. El motor la aplica sobre una copia del mundo vigente. Si una regla no se cumple, responde el
   mismo mensaje que vería la app («Ese número de operación ya se usó en otro pago»).
4. Si pasa, en **una transacción** de MySQL se escriben solo las filas que cambiaron (se compara
   cada entidad antes y después) y la acción queda en `sync_events` con su número de orden.
5. Tras el `COMMIT`, el servidor adopta el mundo nuevo y difunde la acción por Socket.IO; cada
   celular la aplica con las mismas reglas y llega al mismo resultado.
6. Un reintento con el mismo id devuelve la misma respuesta sin duplicar (14.5).

Al arrancar, el servidor **arma el mundo leyendo las tablas** (no reproduce eventos): MySQL es la
fuente de la verdad. Las pruebas `apps/api/test/store.test.ts` guardan toda la historia de la demo
acción por acción (454 pasos), la vuelven a leer y comprueban que el resultado es idéntico.

### Del mundo a las tablas (13.3)

| Entidad | Tablas |
|---|---|
| Usuarios | `users`, `user_profiles`, `user_preferences`, `user_roles`, `consents` |
| Organizaciones | `organizations`, `organization_members`, `farmer_details`, `buyer_details`, `tax_profiles`, `addresses`, `org_service_areas`, `payout_accounts` (cifradas), `organization_stats` |
| Membresías | `plans`, `subscriptions`, `subscription_usage`, `subscription_invoices` |
| Verificación | `verification_cases`, `documents`, `verification_checks`, `farms` |
| Publicaciones | `listings`, `listing_photos`, `listing_price_tiers`, `inventory_movements`, `favorites` |
| Pedidos | `orders`, `sub_orders`, `sub_order_items`, `sub_order_status_history`, `payments`, `tax_documents`, `deliveries` (código cifrado y su huella), `delivery_events` |
| Relación | `conversations`, `messages`, `reviews`, `disputes`, `dispute_evidence` |
| Soporte | `support_tickets`, `ticket_messages`, `complaint_book_entries`, `notifications`, `audit_logs` |
| Cobros | `commission_statements` (+ `commission_statement_items`), `storage_statements`, `carrier_statements`, `billing_payments`, `operation_numbers` |
| Almacenes | `warehouse_details`, `storage_facilities`, `storage_rates`, `storage_inspections`, `storage_bookings`, `storage_lots`, `storage_receipts`, `storage_movements`, `storage_release_orders`, `storage_incidents` |
| Transporte | `carrier_details`, `carrier_drivers`, `vehicles`, `vehicle_documents`, `vehicle_inspections`, `shipping_routes`, `shipping_rates`, `carrier_routes`, `shipments`, `shipment_offers`, `shipment_events`, `shipment_incidents`, `carrier_ratings`, `carrier_favorites` |
| Configuración | `platform_settings`, `verification_level_limits`, `setting_change_requests`, `translations`, `sunat_ruc_registry` |
| Sesiones | `refresh_tokens`, `otp_codes`, `devices`, `idempotency_keys`, `files`, `privacy_requests`, `reports` |
| Catálogos de referencia | `ubigeo`, `units`, `product_categories`, `catalog_products`, `catalog_product_aliases`, `crop_references`, `market_prices`, `roles` |
| Sincronización | `sync_events` (cada acción con su número de orden), `system_state` (época, reloj de la demo, contadores) |
| Antes de la versión 2, ya en el MVP (migración 0008) | `requests` y `request_offers` (solicitudes de compra con ofertas, RF-ORD-09), `order_schedules` y `order_schedule_items` (pedidos programados del plan Pro, RF-ORD-10), `organization_members` con tipo, permisos y estado (equipo de la MYPE, quién publica por el agricultor, conductores del transportista), `addresses` con `uuid` (locales de la MYPE), `catalog_products.custom_definition` (productos que agrega el equipo, W-09) y `listings.request_uuid` (venta hecha para una solicitud, fuera del catálogo) |
| Para después del MVP | `carts` y `cart_items` (en el MVP el carrito vive en el celular), `endorsements` (avales), `voice_drafts` (el dictado arma el borrador en el celular). Ya están en el esquema |

Vistas para consultar: `v_active_listings` (catálogo del comprador), `v_verification_queue`
(bandeja del verificador), `v_seller_inbox` (pedidos de cada agricultor) y `v_monthly_sales`
(ventas conformes por mes, base de la comisión). En total: 105 tablas del modelo más
`schema_migrations`, 158 llaves foráneas y 49 restricciones `CHECK`.

Convenciones (13.4): llave interna `BIGINT` y `uuid` público, dinero en `DECIMAL(12,2)`,
cantidades en `DECIMAL(12,3)`, estados como `ENUM`, fechas en UTC con milisegundos,
`utf8mb4_0900_ai_ci`, `CHECK` y llaves foráneas donde la base puede imponer la regla (por ejemplo,
una orden de salida no pasa a activa sin el alquiler pagado, RN-46; un número de operación no paga
dos cargos, RF-PAY-05).

## Autenticación y seguridad (14.4, 14.9)

- Celular con código de 6 dígitos (hash SHA-256, 5 minutos, 5 intentos), registro con un permiso
  de 15 minutos tras verificar el código.
- **Ingreso según el tipo de usuario**: la app envía el tipo elegido. Si el celular es de otro tipo,
  el servidor responde `409 ROLE_MISMATCH` sin gastar el código y la app ofrece entrar con el tipo
  correcto; si es una cuenta del equipo, responde `409 USE_PANEL` y la app abre el panel web
  (el equipo solo entra al panel, con contraseña y doble factor).
- **Permisos dentro de una organización**: el titular es el primer miembro. Cada acción tiene el
  permiso que exige (`MEMBER_PERM` en `packages/shared/src/engine/r2.ts`: hacer pedidos, aprobar y
  recibir, pagar, publicar, atender pedidos o solo el titular) y el motor lo revisa antes de aplicar
  cualquier acción, en el celular y en el servidor. Un miembro en pausa no puede hacer nada.
- «Restablecer acceso» en el panel (W-05) cierra todas las sesiones de la organización (revoca los
  tokens de refresco) y queda en auditoría.
- Panel con contraseña **Argon2id** y doble factor **TOTP** (RFC 6238, compatible con Google o
  Microsoft Authenticator); 5 intentos fallidos bloquean la cuenta 15 minutos.
- Token de acceso JWT de 15 minutos y token de refresco rotativo guardado como hash: si se
  reutiliza uno ya rotado, se cierran todas las sesiones de ese usuario.
- Cuentas de cobro y códigos de entrega cifrados con **AES-256-GCM** (`DATA_KEY`); la base guarda
  además los últimos 4 dígitos y la huella del código.
- Los códigos de entrega, recojo y QR los genera el servidor al azar.
- DNI, selfie y documentos solo con enlace firmado de un minuto; cada acceso queda en auditoría.
- Usuario de MySQL con permisos solo sobre la base `mesagri`; MySQL escucha solo en `127.0.0.1`.
- Límite de intentos por IP y por celular, cabeceras de seguridad y CSP.

## Tareas programadas (14.7)

Cada 20 segundos el servidor revisa si venció algún plazo (pedidos sin respuesta, conformidad
automática a las 48 h, calificaciones a los 7 días, publicaciones, reservas y lotes, ofertas de
envío, cierre de mes el día 1, cuentas vencidas el día 11, membresías, solicitudes de compra que
dejan de recibir ofertas, pedidos programados que se arman 2 días antes a las 8:00 y vencen sin
aprobar el día anterior a las 18:00) y, si hay algo, aplica una acción `CLOCK_TICK` que se guarda y
difunde como cualquier otra.

## Lo propio de la demo

- **Escenario de varios celulares** (`/demo`): el canal `/sync` entrega el mundo completo para mostrar
  varias personas en una pantalla. Solo existe con `DEMO_MODE=true`; en el piloto real la app
  móvil usa los endpoints REST, que ya filtran por rol y organización.
- **Reloj de la demo**: arranca el martes 3 de noviembre de 2026, 8:30 (hora de Lima) y se puede
  adelantar. Con `DEMO_CLOCK=resume` sigue donde quedó al apagar el servidor.
- **Códigos visibles**: sin proveedor de WhatsApp o SMS, el código de ingreso se muestra en pantalla.

## Versión autónoma (APK y app web instalable)

Para repartir la app al público sin depender de la laptop ni de internet, la misma app React se
compila con `vite build --mode autonoma` (carpeta `apps/web/dist-app`, rutas relativas):

- **El servidor corre dentro del celular** (`apps/web/src/app/local/server.ts`): responde las mismas
  rutas del API que usa la app (`/auth`, `/sync`, `/demo`, `/admin`) con el mismo motor de reglas de
  `packages/shared`. Ingreso con código y por tipo de usuario (`ROLE_MISMATCH`, `USE_PANEL`), panel
  con clave y código de 6 dígitos que cambia cada 30 s, registro con permiso tras verificar el código,
  códigos de entrega, recojo y QR al azar, plazos que se procesan solos y reinicio de los datos.
  El canal en vivo es local (sin Socket.IO) y la réplica de la app funciona igual que con servidor.
- **Guardado**: el mundo se guarda en IndexedDB (`mesagri-local`) unos milisegundos después de cada
  acción y al cerrar la app; el reloj de la demo sigue donde quedó. Si hay dos pestañas abiertas, se
  avisan por `BroadcastChannel` y la otra se pone al día. Las fotos quedan en el celular.
- **App web instalable**: manifiesto con íconos del logo y un service worker que guarda todos los
  archivos de la compilación (se genera con la lista exacta y se actualiza solo al publicar otra).
  Botón «Instalar la app» en Android y la indicación «Agregar a inicio» en iPhone.
- **APK** (`apps/android`): un `WebView` que sirve la app desde los archivos del APK en
  `https://appassets.androidplatform.net` (origen seguro: IndexedDB, GPS y cámara funcionan). Fotos con
  la app de cámara o la galería (un `ContentProvider` propio, sin permisos de almacenamiento), GPS con
  permiso en tiempo de ejecución, llamadas, mapas y WhatsApp con la app del celular, PDF y CSV para
  guardar o compartir, dictado por voz y texto a voz de Android (el WebView no trae los del navegador)
  y el botón atrás que vuelve pantalla por pantalla. Se compila con `aapt`, `javac`, `dx`,
  `zipalign` y `apksigner` (paquetes de Ubuntu), Android 7 o más, firmado con esquema v2 y v3.
- Cada celular tiene sus propios datos. Para que varios celulares compartan pedidos en vivo se usa
  la versión con servidor.

## Simplificaciones respecto del documento

| Documento | MVP | Para el piloto |
|---|---|---|
| App móvil en React Native (Expo) | APK de Android (WebView) y app web instalable, con la cámara, el GPS, la voz, el marcador y los mapas del celular | Publicar en Play Store y App Store; reusar `packages/shared` y la API |
| Archivos en almacenamiento S3 (MinIO) | Carpeta `storage/files` con la misma interfaz (enlaces firmados) | Cambiar el adaptador |
| Trabajos con BullMQ y Redis | Revisión de plazos dentro del servidor (una acción a la vez) | BullMQ si hay varios servidores |
| Prisma o Drizzle | `mysql2` con SQL explícito y migraciones versionadas | — |
| WhatsApp/SMS y push | Código en pantalla; avisos dentro de la app | Proveedor de mensajes y FCM |
| Despliegue en K3s | Laptop con Windows (`INSTALAR.cmd`) o Docker Compose (`infra/`) | Manifiestos de K3s |
