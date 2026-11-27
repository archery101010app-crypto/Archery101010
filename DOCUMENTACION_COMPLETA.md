# Documentación Completa y Consolidada — ARCHERY 101010 THE APP

**Versión Actual: v2.172** · Consolidación de Auditoría Integral (`v2.159` → `v2.160`) · Noviembre 2026

Este documento reúne la arquitectura técnica real, el sistema de diseño oficial, el modelo de seguridad en la nube, el ecosistema de relojes deportivos y sensores biométricos, y las especificaciones funcionales de **ARCHERY 101010 THE APP**.

---

## 1. Stack Tecnológico y Arquitectura Real (`v2.160`)

| Capa | Tecnología / Versión | Detalle de Implementación |
| :--- | :--- | :--- |
| **Framework Web** | Next.js `16.2.6` (`output: "export"`) | Exportación estática pura (`SPA` sin rutas SSR ni endpoints `/api/*`), compatible con Firebase Hosting y contenedores móviles nativos. |
| ** Librería UI** | React `19.2.4` + TypeScript `5` | Componentes funcionales auditados por el guardián AST (`scripts/verify-no-regressions.js`) y protección del reconciliador Fiber ante traductores DOM (`src/lib/domMutationGuard.ts`). |
| **Estilos y Animación** | Tailwind CSS `v4` + Framer Motion `12.40` | Acabado **Negro OLED Puro** y **Titanio Mate** de alto contraste en campo, cero resplandores artificiales y animaciones fluidas a 60fps. |
| **Persistencia Local** | IndexedDB (`localforage` `1.10`) | Arquitectura **Offline-First de Latencia Cero**: lectura y escritura local inmediata más cola secuencial en segundo plano (`cola_sincronizacion`). |
| **Backend Serverless** | Firebase Auth, Firestore v12 y Cloud Functions v2 | Funciones en Node `22` (`functions/index.js`): `promoteToCoachClub`, `verifyStoreSubscription`, `restoreStoreSubscription`, `rotateCoachInviteCode`, `purgeDeletedUserAccount` y `watchCloudBridge`. |
| **Apps Móviles Nativas** | Capacitor `8.6` (Android API 36 + iOS 15+) | Paquete oficial `com.archery101010.app` con puentes nativos para autenticación, Bluetooth LE (`0x180D`), GPS/pasos, compartición nativa y sincronización con relojes. |
| **Ecosistema de Relojes** | Wear OS, watchOS, Relojes Deportivos GPS y `/watch` | Apps nativas dedicadas en Java (Android Wear), SwiftUI/HealthKit/WatchConnectivity (watchOS), Monkey C SDK `9.3.0` (87 variantes de relojes deportivos GPS) y vista web autónoma `/watch`. |
| **Calidad y CI/CD** | GitHub Actions Node `22` + `node:test` + Chrome CDP | Pipeline activo en `.github/workflows/ci.yml` con guardián AST, `tsc --noEmit`, ESLint (`0` errores), suites unitarias (`tests/*.test.ts`), pruebas de `functions/` y suite E2E de 4 niveles (`tests/e2e/`). |

---

## 2. Sistema de Diseño e Identidad de Marca (`GEMINI.md`)

### 2.1. Logotipo Oficial `ARCHERY 101010`
* **Activo Oficial 4K Retina:** Todo encabezado principal renderiza `/images/brand_logo_header.png` con `srcSet="/images/brand_logo_header.png 1x, /images/brand_logo_full.png 2x"` y `dir="ltr"`.
* En el logotipo oficial, **`ARCHERY`** utiliza tipografía **Good Times** blanca y **`101010`** conserva su geometría curva original en cian (`#00BFFF` / `#00A8F3`), rojo (`#FF0000` / `#FF1E1E`) y amarillo (`#FFE500`).
* **Regla Inquebrantable:** Está estrictamente prohibido escribir los dígitos `101010` como texto CSS con la fuente `Good Times` o fuentes de sistema. El subtítulo **`THE APP`** utiliza siempre `Good Times` (`font-good-times`).

### 2.2. Paleta OLED y Titanio Mate (Cero Glow Artificial)
* **Fondos OLED Negros:** `#020305`, `#06080C` y `#07090E` para máxima legibilidad bajo luz solar directa y ahorro energético en pantallas AMOLED/OLED.
* **Superficies y Biseles en Titanio Mate:** `#12151C` con bordes nítidos de `1px` (`rgba(255, 255, 255, 0.08)` a `0.12`).
* **Cero Efecto Neón:** Prohibido el uso de `text-shadow` brillante, halos borrosos o sombras difusas saturadas (`--shadow-glow-*: none`).
* **Tipografía Deportiva Tabular (`Outfit`):** Todos los marcadores, puntajes, distancias (`m` / `yd`), calorías (`kcal`), pulsaciones (`BPM`) y cronómetros emplean `Outfit` con `tabular-nums`, nunca fuentes `monospace` de programación con ceros tachados.

### 2.3. Contención Geométrica, Idiomas y Cero Palabras Cortadas
* **Prohibición Absoluta de Truncamiento (`...`):** Ningún encabezado, botón, tarjeta, barra o insignia puede usar `truncate`, `text-ellipsis` ni `line-clamp`. Todo texto se muestra íntegro y centrado dentro de su contenedor.
* **Prohibición de Marcas Registradas de Terceros en UI:** La interfaz pública, el manual interactivo (`/manual/index.html`) y las tarjetas compartibles utilizan exclusivamente **`ARCHERY 101010`** / **`THE APP`** y descriptores genéricos (*"Reloj Inteligente"*, *"Smartwatch Deportivo"*, *"Reloj Deportivo GPS"*, *"Banda Cardíaca Bluetooth"*, *"Reproductor Musical"*, *"Redes Sociales"*, *"Tienda de Aplicaciones"*).
* **Soporte Multilingüe (13 Idiomas) y Unidades Regionales (`regionalUtils.ts`):** Español, Inglés, Portugués, Francés, Alemán, Italiano, Coreano, Japonés, Chino Simplificado, Hebreo, Ruso, Checo y Árabe (con soporte RTL automático y aislamiento `dir="ltr"` en logotipos), además de conversión automática entre sistema **Métrico** (`m`, `cm`, `kg`) e **Imperial** (`yd`, `ft/in`, `lbs`) y formato de fecha local sin desfase UTC (`getLocalISODate`).

---

## 3. Resiliencia Offline-First y Sincronización en Tiempo Real

1. **Escritura Instantánea en IndexedDB (`src/lib/db/indexedDB.ts`):** Sesiones, borradores en vivo, estrellas, macrociclos, eventos de calendario y ajustes se guardan localmente con latencia cero antes de cualquier llamada de red.
2. **Cola Secuencial Resiliente (`cola_sincronizacion` en `src/lib/db/syncManager.ts`):**
   * Procesa operaciones `INSERT`, `UPDATE` y `DELETE` en orden estricto con timeout de `15s` por operación y cota máxima de seguridad (`MAX_SYNC_QUEUE_ITEMS = 500`).
   * Aísla documentos rechazados permanentemente mediante `skippedIds` para nunca bloquear transacciones posteriores y mantiene registro de *tombstones* (`clearSessionTombstone`) para evitar resurrecciones de borradores eliminados.
   * Antes de aplicar una actualización OTA en caliente (`AppUpdateBanner.tsx`), vacía la cola pendiente (`runSync`) y realiza recarga interna (`window.location.reload()`) sin abrir navegadores externos.
3. **Suscripciones Acotadas (`src/lib/db/realtimeSync.ts`):**
   * Todas las lecturas y escuchas `onSnapshot` utilizan consultas filtradas con `limit <= 250` (verificado automáticamente en pruebas unitarias).
   * Ignora instantáneas obsoletas de caché (`!snapshot.metadata.fromCache`) al podar registros y preserva macrociclos asignados a arqueros independientes sin club (`assignedAthleteIds`).
4. **Fusión No Destructiva de Perfiles (`src/lib/profileMerge.ts`):**
   * `mergeUserProfilesNonDestructive` protege alias personalizados, estatura, peso y configuraciones de arco frente a documentos remotos iniciales o cierres de sesión, y mantiene una lista acotada y sin duplicados de hasta **10 tokens push multi-dispositivo** (`fcmTokens`).
   * `buildOwnerSelfServiceProfilePatch` filtra estrictamente campos de autogestión personal/equipo excluyendo `role`, `plan`, `proExpiresAt`, `clubId`, `coachId` y `clubInviteCode`.

---

## 4. Seguridad Backend, Roles y Suscripciones Coach PRO

### 4.1. Sistema de Roles y Vinculación de Clubes
* **Roles:** `archer` (Arquero), `coach` (Entrenador), `team_admin` (Administrador de Club), `team_admin_coach` (Rol Dual) y `superadmin` (requiere correo autorizado con `email_verified == true` tanto en cliente como en Firestore Rules y Cloud Functions).
* **Anti-Escalamiento en Reglas (`firestore.rules`):** Ningún cliente puede auto-promoverse directamente a `coach`, `team_admin`, `team_admin_coach` ni `plan: "PRO"` modificando `users/{uid}`.
* **Promoción y Códigos de Invitación (`functions/index.js`):**
  * `promoteToCoachClub`: Cloud Function autenticada que verifica mayoría de edad (`>= 18` años) y asigna de forma atómica el rol organizacional, `clubId` canónico (`CLB-<uid>`) y código único de 6 dígitos en `coach_invite_codes/{code}` (sin exponer correo ni PII en `users_public`).
  * `rotateCoachInviteCode`: Regenera de forma atómica y libre de colisiones el código de 6 dígitos del entrenador, eliminando el código anterior.
  * `purgeDeletedUserAccount`: Elimina en lotes paginados los datos del usuario en todas las colecciones vinculadas y su credencial en Firebase Auth (`admin.auth().deleteUser`), cumpliendo las políticas de privacidad de las tiendas oficiales.

### 4.2. Suscripciones `COACH PRO` (`src/lib/billingService.ts` & `verifyStoreSubscription`)
Todos los módulos de puntuación, reloj WA, historial, calendario, duelos 1v1, pulso Bluetooth, relojes inteligentes y modo análisis son gratuitos para los arqueros. Las herramientas avanzadas de dirección técnica operan bajo **COACH PRO**:

| Plan | Identificador / SKU | Precio Regular | Promoción Lanzamiento | Duración |
| :--- | :--- | :---: | :---: | :---: |
| **COACH PRO Mensual** | `coach_pro_monthly` (`archery101010_coach_pro_monthly`) | **$9.99 USD / mes** | **$0.00 USD** | 30 días |
| **COACH PRO Anual (-25%)** | `coach_pro_annual` (`archery101010_coach_pro_annual`) | **$89.91 USD / año** | **$0.00 USD** | 365 días |

* **Validación Autorizada en Servidor:** `activateCoachLaunchPromo` y `restoreCoachStorePurchases` invocan las Cloud Functions `verifyStoreSubscription` y `restoreStoreSubscription`.
* **Protección Anti-Replay (`store_receipt_claims`):** Los recibos y tokens de compra de las tiendas oficiales se registran con hash criptográfico en `store_receipt_claims/{claimId}`, impidiendo reutilizar un mismo comprobante en múltiples cuentas. Los registros `subscription_audit_logs` son de escritura exclusiva para el servidor / `superadmin`.

---

## 5. Ecosistema de Relojes Inteligentes, Pulso Bluetooth y Modo Análisis 3D

### 5.1. Emparejamiento Seguro de 6 Dígitos + Token de 256 Bits (`biometricsEngine.ts`)
Para proteger las sesiones en vivo sin requerir login completo en la pantalla pequeña del reloj, el protocolo en la nube utiliza un handshake de dos etapas:
1. **`watch_pairings/{pairingCode}` (Efímero `<= 120s`, Uso Único):** El teléfono autenticado publica un código numérico de 6 dígitos (`100000`–`999999`) con `ownerHash` SHA-256 de 64 caracteres (cero PII y cero puntajes) y ventana `pairingOpenUntil <= 120s`. El reloj reclama el código una sola vez (`claimed: true`, `watchDeviceId`, `watchSource`) obteniendo el `sessionToken`.
2. **`watch_sessions/{sessionToken}` (256 Bits URL-Safe):** Toda sincronización posterior de flechas, tandas, distancia caminada, calorías, pulsaciones y vectores de análisis ocurre sobre el documento indexado por el token de alta entropía (`^[A-Za-z0-9_-]{32,64}$`, 43 caracteres base64url), bloqueado al `watchDeviceId` reclamante y prohibido ante listados (`allow list: if false`).
3. **Colas Offline FIFO Persistentes en Relojes:** Tanto en Wear OS (`SharedPreferences`), como en watchOS (`pendingCloudQueue` serializada) y en Relojes Deportivos GPS (`Application.Storage` hasta 24 comandos en `mPendingCmdQueue`), los tiros y puntajes registrados sin cobertura se encolan en orden FIFO y esperan confirmación HTTP `200` / puente nativo antes de limpiar contadores al finalizar sesión. Los relojes sin pantalla táctil soportan navegación completa de puntajes (`X`, `10`..`1`, `M`) y deshacer flecha mediante botones físicos.

### 5.2. Frecuencia Cardíaca en Tiempo Real (`bleHeartRateService.ts` & `BleHeartRateModal.tsx`)
* **Bloque 1 · Reloj Vinculado:** Recibe pulsaciones ópticas continuas desde la app compañera del reloj (vía puente nativo `DataClient` / `WCSession` o sincronización en nube cada 5–6s) incluso cuando `sessionActive === false` (permitiendo verificar pulso en vivo desde Configuración de Sesión antes de empezar).
* **Bloque 2 · Bandas y Sensores Cardíacos Bluetooth:** Conexión directa GATT al servicio estándar `0x180D` (característica `0x2A37`), decodificando formatos `UINT8` y `UINT16`, detección de contacto con la piel (limpiando el BPM instantáneo a `0` al retirar la banda sin perder promedio ni máximo de sesión), intervalos `RR` y promedio ponderado al reanudar borradores.

### 5.3. Modo Análisis Biomecánico 3D (`shotAnalysisEngine.ts` & `AnalysisView.tsx`)
Permite evaluar la técnica de tiro con muestreo inercial de muñeca (acelerómetro + giroscopio de 3 ejes a 50–100Hz):
* **Ventana Manual `INICIO → FINAL`:** Activación desde el teléfono o con el botón físico lateral del reloj (hasta 30s para posturas prolongadas). Recorta automáticamente el tiempo muerto previo al levante del arco y el descenso del brazo / toque del botón posterior a la suelta.
* **Física 3D y Separación de Fases:**
  * **Elevación 3D del Antebrazo (`forePitchWeight`):** Captura el ángulo vertical del eje `X` junto con `Y`/`Z` tanto para arqueros diestros (`bowWrist: "LEFT"`) como zurdos (`bowWrist: "RIGHT"`).
  * **Histéresis Disjunta de `650ms`:** Evita que micro-vibraciones del clicker dividan artificialmente la Fase de Apuntado, manteniendo separadas la **Fase Preparatoria** (trazo discontinuo blanco, segundos) y la **Fase de Apuntado** (trazo sólido cian, segundos).
  * **Calibración de Vector Cero (`zeroGravityVec`):** Soporta tanto calibración en postura de reposo (*"setear el inicio"*) como en postura de anclaje a mitad de sesión.
  * **Métricas por Flecha y Transporte Compacto:** Calcula `% de Estabilidad` (normalizado al radio reglamentario World Archery: `20cm` a 18m, `30cm` a 25m, `40cm` Compuesto 50m / 30m, `61cm` Recurvo/Desnudo 50m–70m), radio de oscilación RMS (`cm`), salto de suelta en los últimos `0.5s` (`cm`) y pulso cardíaco al soltar. Cada tiro se codifica en JSON compacto (`< 1.5 KB`, límite estricto `<= 3500` caracteres) y nunca contamina los promedios de puntuación competitiva.

---

## 6. Módulos Funcionales Principales

1. **Configuración de Sesión (`SessionConfigView.tsx`):** Tipos *Control*, *Práctica* y *Volumen*; formatos *Libre*, *WA 300*, *Vegas 300*, *WA 360* y *WA 720* (asignando automáticamente `12 × 6 = 72` flechas a `50m` para Compuesto y `70m` para Recurvo/Arco Desnudo); soporte de distancias en metros (`m`) o yardas (`yd`) y reanudación de borradores activos.
2. **Puntuación Táctil, Teclado y Volumen (`ScoringView.tsx`):** Diana vectorial interactiva con lupa acotada al viewport móvil (`360px`), teclado numérico rápido, modo contador de volumen puro (neutralizado a `0` puntos competitivos en `sessionMetrics.ts`), caminata fusionada GPS + cadencia de pasos (`walkingTracker.ts`) y autoguardado con debounce libre de escrituras duplicadas.
3. **Reloj Reglamentario World Archery (`FloatingClock.tsx`):** Fases configurables de Preparación y Tiro con transiciones puras en React 19, señales acústicas Web Audio API (2 pitidos de entrada, 1 de inicio, aviso a 30s, 3 de cierre) y cuenta regresiva por voz (`SpeechSynthesis`) en el idioma activo.
4. **Estrellas 101010 (`starsManager.ts`):** 8 niveles desde Bronce (`500+`) hasta Diamante (`700+`) en rondas oficiales WA 720 (`70m` Recurvo y `50m` Compuesto), conservando logros independientes por tipo de arco (`bowStats`) y propagando `clubId` para visibilidad inmediata del entrenador.
5. **Matchplay 1v1 en Vivo (`MatchplayLobbyView.tsx` & `MatchplayGameView.tsx`):** Salas con código e invitaciones directas, Set System (Recurvo/Arco Desnudo a 6 pts) y Acumulativo 15 flechas (Compuesto a 150 pts), desempate *Shoot-Off* por cercanía a la cruceta (`matchplayScoring.ts`), audio en tiempo real WebRTC y protección de fase de verificación entre tandas.
6. **Portal del Entrenador (`CoachPortalView.tsx`):** 5 paneles integrados (*Resumen*, *Atletas*, *Sesiones*, *Duelos* y *Macrociclos PRO*), ficha técnica deslizable (`AthleteDetailSheet.tsx`) con notas técnicas, restauración de sesiones y exportación de reportes compatible con WebView nativa (`downloadOrShareFile`).
7. **Consola SuperAdmin (`AdminPortalView.tsx`):** Métricas globales, gestión de usuarios y clubes, auditoría de suscripciones, campañas internas con validación de protocolo seguro `https:` y telemetría de errores (`client_error_logs`).

---

## 7. Distribución Móvil Android (`.firebaseapp.com`) y Control de Versiones

* **Descargas de Un Toque en Android (`GEMINI.md` Regla 6):** Dado que `archery101010-c0bb4.web.app` declara `Android App Links` (`autoVerify="true"`), todo binario descargable (`.aab` móvil, `.aab` Wear OS, paquete `.iq` de relojes GPS y guías PDF) se sirve desde el dominio espejo **`https://archery101010-c0bb4.firebaseapp.com/<archivo>`** con cabecera `Content-Disposition: attachment` y regla de reescritura `regex: "^/[^.]*$"` que devuelve `404` real si un binario no existe en lugar de entregar `index.html`.
* **Sincronización Centralizada de Versión (`npm run bump-version`):** `scripts/increment-version.js` actualiza en un solo paso `package.json`, `src/lib/version.ts`, `public/sw.js`, `android/app/build.gradle`, `android/wear/build.gradle`, `garmin-ciq/manifest.xml`, `ios/App/App.xcodeproj/project.pbxproj`, `ios-watchos/WatchApp/Info.plist`, `public/{ota-version,version,app-version}.json`, `ios/App/App/public/ota-version.json`, `firebase.json`, `DOCUMENTACION_COMPLETA.md` y `public/manual/index.html`.
