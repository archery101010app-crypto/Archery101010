# Documentación Completa y Consolidada: Archery 101010

Este documento reúne todas las especificaciones visuales, técnicas y funcionales del proyecto **Archery 101010**. Ha sido diseñado bajo la filosofía **SaaS Premium 2025** y desarrollado con un enfoque **Offline-First (Resiliencia y Sincronización)** y **Mobile-First**.

---

## 🛠️ Stack Tecnológico
La aplicación se construyó utilizando las siguientes tecnologías modernas:
1. **Framework:** Next.js (App Router) con TypeScript.
2. **Estilos:** Tailwind CSS con configuración avanzada de modo oscuro y variables neón.
3. **Componentes UI:** shadcn/ui como sistema base de componentes accesibles y personalizables.
4. **Animaciones:** Framer Motion para transiciones fluidas y microinteracciones de interfaz.
5. **Base de Datos Local:** localForage (IndexedDB) para persistencia síncrona y almacenamiento offline.
6. **Base de Datos en la Nube:** Firebase Firestore con suscripciones en tiempo real (`onSnapshot`).
7. **Autenticación:** Firebase Auth (Email/Password, Google, Facebook).
8. **Notificaciones Push:** Firebase Cloud Messaging (FCM).
9. **Email Transaccional:** Firebase Extensions (Trigger Email) o Resend/SendGrid vía API Routes.
10. **WhatsApp (Opcional):** WhatsApp Cloud API (Meta) — tier gratuito de 1,000 conversaciones de servicio/mes para clubes pequeños; alternativa: enlaces `wa.me` directos para notificaciones manuales del entrenador.
11. **Pagos:** PayPal SDK (JavaScript Client-Side + Webhooks Server-Side) para suscripciones Pro.

---

## 🎨 Especificaciones Visuales Globales

### 1. Paleta de Colores Oficiales (HEX)
Para un contraste de nivel olímpico en modo oscuro, se define la siguiente paleta estricta:

| Color | Código HEX | Uso Principal | Clase Tailwind |
| :--- | :--- | :--- | :--- |
| **Negro Absoluto (OLED)** | `#000000` | Fondo general de la aplicación | `bg-black` |
| **Cian Neón / Activo** | `#00E5FF` | Acciones principales, bordes activos, resplandores | `text-[#00E5FF]` / `bg-[#00E5FF]` |
| **Cian Base / Marca** | `#00A2E8` | Bordes secundarios, textos de control, iconos | `text-[#00A2E8]` / `border-[#00A2E8]` |
| **Amarillo Puro / Oro** | `#FFF200` | Puntuaciones máximas (X, 10, 9), progreso premium | `text-[#FFF200]` / `bg-[#FFF200]` |
| **Rojo Vibrante / Rival**| `#FF3B30` | Puntuaciones de rivales en duelos, alertas físicas | `text-[#FF3B30]` / `bg-[#FF3B30]` |
| **Verde Éxito** | `#00C853` | Confirmaciones de pago, estados exitosos, badge activo | `text-[#00C853]` / `bg-[#00C853]` |
| **Gris Fondo / Glass** | `#1A1D20` | Fondos de paneles y tarjetas Bento | `bg-[#1A1D20]/75` |
| **Gris Borde Sutil** | `#2C2F33` | Bordes inactivos o divisorias secundarias | `border-[#2C2F33]` |
| **Gris Apagado / Textos**| `#8E8E93` | Leyendas secundarias y placeholders | `text-[#8E8E93]` |
| **Blanco Puro** | `#FFFFFF` | Títulos principales e información crítica | `text-white` |

### 2. Estilos de Contenedores y Glassmorphism
Las tarjetas y modales utilizan:
* **Fondo de Vidrio Translúcido:** `backdrop-filter: blur(12px); background-color: rgba(26, 29, 32, 0.75);` (`bg-[#1A1D20]/75 backdrop-blur-md`).
* **Borde Fino de Cristal:** Borde de `1px` con opacidad sutil en blanco o cian (`border border-white/10` o `border-[#00A2E8]/20`).
* **Radios de Curvatura:**
  * Tarjetas estándar y Paneles Bento: `rounded-2xl` (16px).
  * Inputs y botones pequeños: `rounded-xl` (12px) o `rounded-lg` (8px).
  * Botones principales y cápsulas de navegación: `rounded-full` (completamente esférico).

### 3. Efecto Glow (Sombras de Neón)
* **Glow Cian:** `box-shadow: 0 0 15px rgba(0, 229, 255, 0.35);` (`shadow-[0_0_15px_rgba(0,229,255,0.35)]`).
* **Glow Amarillo:** `box-shadow: 0 0 15px rgba(255, 242, 0, 0.3);` (`shadow-[0_0_15px_rgba(255,242,0,0.3)]`).
* **Glow Rojo:** `box-shadow: 0 0 15px rgba(255, 59, 48, 0.3);` (`shadow-[0_0_15px_rgba(255,59,48,0.3)]`).
* **Glow Verde (Éxito):** `box-shadow: 0 0 15px rgba(0, 200, 83, 0.3);` (`shadow-[0_0_15px_rgba(0,200,83,0.3)]`).

### 4. Simulación de Dispositivo (Desktop Frame)
Para visualización en escritorio, la app se renderiza dentro de un simulador de iPhone centrado:
* **Fondo del Desktop:** Degradado radial de malla con dos focos de luz suave y desenfocada: cian (#00A2E8/15) a la izquierda y amarillo (#FFF200/10) a la derecha, con partículas en movimiento.
* **Marco de iPhone:** Esquema de tamaño `w-[390px] h-[844px]` con esquinas redondeadas (`rounded-[48px]`), notch superior e indicador de barra de inicio. En pantallas móviles, se expande a pantalla completa mediante media queries.

---

## 👥 Sistema de Roles y Registro

### Roles de la Aplicación
La app maneja tres roles principales: **Archer** (Arquero), **Coach** (Entrenador) y **Admin** (Administrador).

### Lógica de Asignación de Rol Coach
* **Un usuario se convierte en Coach automáticamente** cuando cumple **dos condiciones simultáneas**:
  1. Es **mayor de edad** (≥18 años) al momento del registro.
  2. Es la **primera persona en registrarse** dentro de un **Club que él mismo crea**.
* El creador del club es su primer Coach por defecto. Los siguientes miembros que se unan al mismo club se registran como Archers.
* **Transferencia de rol Coach:** El Coach actual puede transferir su rol de entrenador a otro miembro mayor de edad del club desde la configuración del club. Al transferir, el ex-Coach pasa a ser Archer y el receptor se convierte en el nuevo Coach del club.
* **Un Coach también puede tirar:** El Coach tiene acceso tanto a las funcionalidades de Scoring/Sesiones como a las de gestión del equipo. Su cuenta es dual (arquero + entrenador).
* **Campo en Firestore:** `users/{uid}: { role: "archer" | "coach" | "admin", clubId: string, isClubCreator: bool, dateOfBirth: timestamp }`.

### Tipos de Arco Soportados
La app soporta los siguientes tipos de arco globalmente (Onboarding, Configuración de Sesión, Matchplay, Filtros):
1. **Recurve** (Recurvo)
2. **Compound** (Compuesto)
3. **Barebow** (Arco Desnudo)

---

## ⚡ Criterios Obligatorios de Sincronización y Resiliencia (Offline-First)
Para garantizar una experiencia fluida, robusta e ininterrumpida, se implementó el siguiente sistema:

1. **UX de Latencia Cero:** Toda acción de guardar, editar o borrar se ejecuta primero en **IndexedDB (localForage)** de forma síncrona, actualizando la interfaz al instante.
2. **Cola de Sincronización (`cola_sincronizacion`):** Las escrituras/borrados se encolan localmente. El proceso de subida (`runSync`) opera en segundo plano de manera secuencial para evitar condiciones de carrera, usando banderas (`isSyncing`, `syncPending`) para programar nuevas ejecuciones si se llama al sincronizador mientras ya hay una en curso.
3. **Resiliencia ante Fallos:** Reintenta automáticamente los elementos fallidos debido a cortes de red temporales. Las escrituras en la nube están protegidas con un timeout robusto de **15 segundos** para evitar bloqueos por conexiones lentas.
4. **Escuchas en Tiempo Real (`onSnapshot`):** Conectadas a las colecciones de Firebase. Al recibir cambios externos, se actualiza IndexedDB local y se refresca únicamente la vista activa en pantalla, sin recargar la página.
5. **IDs Resilientes:** Los identificadores principales son textos únicos basados en prefijos y marcas de tiempo (ej: `PES-1716800...`) para evitar colisiones entre dispositivos sin depender de enteros autoincrementales.
6. **Reconexión por Foco:** Escucha el evento `visibilitychange`. Al enfocar o reabrir la app, fuerza una reconexión instantánea a la nube (invocando secuencialmente `disableNetwork` y `enableNetwork`) para anular los retrasos de reconexión del sistema operativo.
7. **Service Worker Inteligente:** Registrado de tal forma que detecta nuevas versiones del software en caliente, envía la directiva `SKIP_WAITING` y recarga la página una sola vez para mantener el código al día sin dejar recursos obsoletos en la caché.
8. **Indicador de Sincronización Interactivo:** El Header cuenta con un botón Wifi que muestra la conectividad y el total de elementos pendientes de subir. Al hacer clic, actúa como un botón interactivo (cursor pointer) que fuerza la sincronización manual y proporciona feedback visual instantáneo (ej: "Conectando...") mientras valida.

---

## 📱 Funcionalidad y Especificaciones por Pantalla

### 1. Inicio de Sesión (Login)
* **Visual:** Logotipo oficial con los bloques `101010` en cian, rojo y amarillo, seguidos del texto `ARCHERY` con un amplio espaciado entre letras. Fondo negro absoluto (`#000000`).
* **Selector de Idioma (Página de Inicio y Header):**
  * Posición: Esquina superior derecha de la pantalla de inicio (Login/Welcome) y también accesible dentro de la cabecera principal (Header) del Dashboard.
  * Dos botones tipo pill/chip lado a lado: `ES` / `EN`.
  * Inactivo: `bg-transparent border border-[#2C2F33] text-[#8E8E93] rounded-full px-3 py-1 text-xs font-medium`.
  * Activo: `bg-[#00E5FF]/10 border-[#00E5FF] text-[#00E5FF] rounded-full px-3 py-1 text-xs font-bold`.
  * Al cambiar idioma, toda la interfaz se actualiza dinámicamente (i18n). La preferencia se guarda en localStorage e IndexedDB.
* **Campos de Entrada:**
  * Inputs con contornos `1px solid #00A2E8` (cian base), esquinas `rounded-xl`, padding interno `px-4 py-3`.
  * Cursor de escritura en amarillo `#FFF200`.
  * Placeholder en gris apagado `#8E8E93`.
  * Al recibir foco: borde se intensifica a `#00E5FF` con glow cian sutil `shadow-[0_0_8px_rgba(0,229,255,0.25)]`.
* **Enlace "Sign Up":** Color amarillo brillante `#FFF200`, texto con `font-weight: 600`, subrayado al hover con transición `transition-all duration-200`.
* **Botón "Login":** Fondo degradado lineal de cian base a cian neón (`from-[#00A2E8] to-[#00E5FF]`), texto interno en amarillo neón `#FFF200`, tamaño `w-full py-3`, esquinas `rounded-full`, glow cian al hover, micro-presión al tap (`scale: 0.98`).
* **Login Social:** Dos botones separados con iconos SVG oficiales de Google y Facebook. Fondos `bg-[#1A1D20]/75` con borde `border-white/10`, iconos en color original de cada marca. Al hover, borde se ilumina a `border-[#00A2E8]/40`.
* **Footer:** Texto "Copyright Archery101010 2026" en gris apagado `#8E8E93`, `text-xs`, centrado.

### 2. Registro y Onboarding
* **Paso 1 — Datos de Cuenta:** Email, contraseña, confirmación de contraseña. Mismos estilos de inputs del Login.
* **Paso 2 — Datos Personales:** Nombre completo, fecha de nacimiento (el sistema calcula automáticamente si es mayor de edad para lógica de Coach), país (selector con banderas), género.
* **Paso 3 — Crear o Unirse a Club:**
  * Opción A: "Crear Club" — Input para nombre del club. Si el usuario es ≥18 años, se asigna automáticamente como **Coach** del club creado. Se muestra badge "Serás el Entrenador de este club" en `bg-[#00E5FF]/10 text-[#00E5FF] rounded-xl p-3 text-sm`.
  * Opción B: "Unirse a Club" — Input de código de invitación del club. El usuario se une como **Archer** independientemente de su edad.
  * Opción C: "Sin Club" — Registro como arquero independiente.
* **Paso 4 — Configuración del Arco:** Tipo de arco (Recurve / Compound / Barebow) como selector de cards grandes con iconos SVG. Datos adicionales: marca, modelo, poundaje, distancia predeterminada.
* **Paso 5 — Datos Físicos del Arquero:** Altura, peso, ojo dominante (Izquierdo / Derecho), mano dominante (Izquierda / Derecha).
* **Navegación:** Indicador de progreso por pasos `1-2-3-4-5` con círculos conectados por líneas. Paso activo en cian `bg-[#00E5FF]`, completado con check ✓, pendiente en gris `bg-[#2C2F33]`. Botones "Anterior" y "Siguiente" al pie.

### 3. Dashboard Principal
* **Visual:** Cuadrícula estilo Bento Grid vertical sobre fondo negro absoluto.
* **Componentes Bento:**
  * *Última Sesión (Ancho Completo):* Tarjeta `bg-[#1A1D20]/75 backdrop-blur-md rounded-2xl border border-white/10` de ancho `w-full`. Score gigante (ej: 285/300) en `text-4xl font-bold text-white`. Velocímetro SVG semicircular: arco de fondo en `stroke: #2C2F33`, arco de progreso en `stroke: #00E5FF` con animación `pathLength` de 0 a valor real en 1.2s. Porcentaje centrado en `text-2xl text-[#FFF200]`.
  * *Puntos Totales (1/3 Ancho):* Borde degradado de `#2C2F33` a `#FFF200` (gradiente en el borde usando pseudo-elemento o `border-image`), puntuación en `text-3xl font-bold text-white`.
  * *Mejor Sesión (1/3 Ancho):* Borde degradado de `#2C2F33` a `#00E5FF`. Onda senoidal SVG cian (`stroke: #00E5FF`, `stroke-width: 2`, `fill: none`) con animación de trazo de derecha a izquierda continua.
  * *Análisis Avanzado - PRO (1/3 Ancho):* Bloqueado para usuarios Free. Borde amarillo brillante `border-[#FFF200]` con glow oro `shadow-[0_0_15px_rgba(255,242,0,0.3)]`. Badge "PRO" en la esquina superior: fondo amarillo `bg-[#FFF200]`, texto negro `text-black`, `text-xs font-bold px-2 py-0.5 rounded-full`. Icono candado SVG en `stroke: #FFF200` centrado. Overlay oscuro `bg-black/50` sobre el contenido.
  * *Clubs y Programas:* Accesos rápidos simplificados con iconos cian y texto blanco.
  * *Progreso (2/3 Ancho):* Gráfico lineal ascendente interactivo con línea en `stroke: #00E5FF`, área bajo la curva en `fill: rgba(0, 229, 255, 0.08)`. Puntos de datos: círculos `r=4` en `fill: #00E5FF` con glow al hover. Ejes en `stroke: #2C2F33`, labels en `fill: #8E8E93`.
* **Navegación:** Menú inferior estilo cápsula flotante `fixed bottom-4 left-1/2 -translate-x-1/2`. Contenedor: `bg-[#1A1D20]/85 backdrop-blur-xl rounded-full border border-white/10 px-6 py-2`. Cinco botones con iconos SVG de 24px: **Home** (Dashboard), **Target** (Nueva Sesión), **History** (Historial), **Calendar** (Asistencia), **Profile** (Perfil/Settings). Inactivos en `#8E8E93`, activo en `#00E5FF` con glow punto cian debajo `w-1 h-1 rounded-full bg-[#00E5FF] shadow-[0_0_6px_rgba(0,229,255,0.5)]`.

### 4. Configuración de Sesión
* **Funciones:** Selección de parámetros de tiro antes de iniciar.
  * *Practice Type:* Selectores interactivos tipo chip/pill. Tres opciones: "Control", "Práctica", "Volumen". Inactivo: `bg-transparent border border-[#2C2F33] text-[#8E8E93] rounded-full px-4 py-2`. Activo: `bg-[#00E5FF]/10 border-[#00E5FF] text-[#00E5FF]` con glow sutil. Transición `transition-all duration-200`.
  * *Format:* Configuración basada en normativas WA (WA 300, WA 720). Selector tipo dropdown con fondo glass `bg-[#1A1D20]/85 backdrop-blur-md`, borde `border-[#00A2E8]/30`. El sistema carga automáticamente el número de Ends y flechas exactos según el formato elegido. Texto de info en `text-xs text-[#8E8E93]` debajo del selector mostrando desglose (ej: "10 ends × 3 arrows = 30 arrows").
  * *Tipo de Arco:* Tres chips para Recurve, Compound, Barebow. Pre-seleccionado según la configuración del perfil del usuario. El usuario puede cambiarlo para esta sesión específica.
  * *Toggles de Control:*
    * **Auto-Score:** Toggle tipo switch personalizado: pista inactiva `bg-[#2C2F33]`, pista activa `bg-[#00E5FF]`. Indicador circular blanco con sombra. Label en `text-sm text-white`. Al activar, borde del contenedor padre brilla a `border-[#00E5FF]/30`.
    * **Include Notes:** Toggle para habilitar la escritura de notas durante y después de la sesión. Mismos estilos de toggle.
  * *Detalles del Campo:* Configuración rápida de distancia de tiro. Botones presets: `18m`, `30m`, `50m`, `60m`, `70m`, `90m`. Estilo chip similar a Practice Type. Campo de rondas: input numérico compacto con botones +/- en cian.

### 5. Scoring: Modo Diana
* **Visual:** Diana SVG vectorial interactiva en la mitad superior (60% de la pantalla) y controles de avance en la mitad inferior (40%).
* **Mecánica Táctil:**
  * La diana reproduce los colores reglamentarios de la World Archery (WA): Blanco (1,2), Negro (3,4), Azul (5,6), Rojo (7,8) y Amarillo (9,10,X). Cada anillo es un `<circle>` SVG con `stroke-width` proporcional.
  * El usuario presiona directamente en las zonas de la diana para registrar el impacto. Se dibuja un marcador amarillo (`fill: #FFF200`, `r=6`) en la coordenada exacta con el número de flecha correspondiente (texto `font-size: 8px`, `fill: black`, `font-weight: bold` centrado en el marcador) y una guía de conexión al centro (línea `stroke: #FFF200/40`, `stroke-width: 1`, `stroke-dasharray: 2 2`).
  * Todo el fondo exterior negro actúa como hitbox para registrar un "Miss" (M).
  * Panel de desglose lateral de flechas del End: columna vertical a la derecha con las puntuaciones individuales del end actual. Cada flecha en un chip `w-8 h-8 rounded-lg` con fondo coloreado según la zona de impacto y texto de la puntuación en blanco o negro según contraste. Totalizador gigante en amarillo neón `text-3xl font-bold text-[#FFF200]` al pie del desglose.

#### 5.1. 📝 Sistema de Notas en Sesión
Si el toggle "Include Notes" está activo en la Configuración de Sesión, el usuario puede escribir notas en dos momentos:

* **Nota por End (durante la sesión):**
  * Al finalizar cada end (después de registrar las flechas y antes de confirmar), aparece un campo de texto expandible debajo del desglose de flechas.
  * Input: `bg-[#1A1D20]/60 border border-[#2C2F33] rounded-xl px-3 py-2 text-sm text-white placeholder-[#8E8E93]`. Placeholder: "Notes for this end... (optional)".
  * Altura mínima de una línea, expandible hasta 3 líneas (`min-h-[36px] max-h-[80px] resize-none`).
  * Botón "Skip" (saltar) en gris sutil a la derecha para no escribir nada.
  * La nota se guarda asociada al end específico: `sessions/{sid}/ends/{endNum}/note: string`.

* **Nota post-sesión (al finalizar):**
  * Al completar el último end y antes de ver el resumen final, se presenta una pantalla intermedia de "Session Notes".
  * Textarea grande: `bg-[#1A1D20]/60 border border-[#2C2F33] rounded-2xl px-4 py-3 text-white` con `min-h-[120px]`.
  * Placeholder: "How did this session feel? Equipment changes? Weather conditions? Mental state?".
  * Título: "Session Summary Notes" en `text-lg font-bold text-white`.
  * Subtítulo: "These notes will be saved with your session and visible to your coach" en `text-xs text-[#8E8E93]`.
  * Se guarda en `sessions/{sid}/sessionNote: string`.

#### 5.2. ⏱️ Reloj Flotante de Scoring (Basado en Adetao)
Componente de reloj/cronómetro configurable presente tanto en **Modo Diana** como en **Modo Teclado**. Basado en el diseño del reloj WA de la app Adetao: **ajuste libre** en segundos (sin presets), dos fases (Preparación + Tiro), con un **FAB (Floating Action Button) para acceso directo** y un **botón de inicio sobredimensionado**.

##### 5.2.1. FAB Flotante (Acceso al Reloj)
* **Visible solo durante las pantallas de scoring** (Modo Diana y Modo Teclado).
* **Posición:** `fixed bottom-[72px] right-4` (encima de la navegación flotante). `z-40`.
* **Tamaño:** `w-[62px] h-[62px]` — circular, prominente.
* **Visual:** Círculo `rounded-full bg-[#00A2E8] text-white` con icono de reloj SVG `⏱` centrado (`text-[1.55rem]`).
* **Sombra:** `shadow-[0_4px_18px_rgba(0,0,0,0.35)]`.
* **Animación de pulso** cuando el reloj NO está activo (invitando al usuario a configurarlo):
  ```css
  @keyframes fabPulse {
    0%, 100% { box-shadow: 0 4px 18px rgba(0,0,0,.35), 0 0 0 0 rgba(0,162,232,.5); }
    50%      { box-shadow: 0 4px 18px rgba(0,0,0,.35), 0 0 0 14px rgba(0,162,232,0); }
  }
  ```
  Ciclo: `animation: fabPulse 2.4s ease-in-out infinite`.
* **Cuando el reloj ESTÁ activo:** El FAB cambia a verde `bg-[#00C853]`, la animación de pulso se detiene (`animation: none`), y muestra el tiempo restante en formato compacto.
* **Al tap:** Abre la pantalla completa del reloj (overlay full-screen).
* **Al presionar (active):** `transform: scale(0.9)`.

##### 5.2.2. Pantalla Completa del Reloj (Overlay Full-Screen)
Overlay que cubre toda la pantalla al estilo Tabata/competición, directamente tomado del patrón de Adetao.

* **Overlay base:** `position: fixed; inset: 0; z-index: 99999`. Fondo sólido que cambia según la fase activa (no transparente — bloquea la vista de scoring mientras está abierto).
* **Colores de fondo por fase:**
  * Preparación/Entrada: `background: #0A2A0A` (verde oscuro profundo).
  * Tiro: `background: #0A0F1A` (azul oscuro profundo, tono naval).
  * Advertencia (últimos 30s): `background: #2A1A00` (ámbar oscuro).
  * Tiempo agotado: `background: #2A0A0A` (rojo oscuro).
  * Transición entre colores: `transition: background 0.4s`.

* **Panel de Configuración (visible cuando el reloj NO está corriendo):**
  * Centrado vertical y horizontal. `max-w-[360px] w-full`.
  * Título: "Configurar Reloj WA" en `text-[1.2rem] font-extrabold text-white/90` centrado.
  * **Dos campos de entrada de ajuste libre (SIN PRESETS):**
    * Campo izquierdo: Label "Preparación (seg)" en `text-xs text-white/70`. Input `type="number"` con `min=5 max=30 value=10`. Estilo: `bg-white/10 border border-white/20 text-white text-center text-[1.1rem] font-bold rounded-xl`. El usuario escribe **libremente** los segundos deseados.
    * Campo derecho: Label "Tiro (seg)" en `text-xs text-white/70`. Input `type="number"` con `min=30 max=300 value=120`. Mismo estilo. El usuario escribe los segundos totales de tiro **sin restricción a valores predefinidos**.
    * Los valores se persisten en `localStorage` para que la próxima vez el reloj recuerde la última configuración usada.
  * **Botón de Inicio — SOBREDIMENSIONADO:**
    * **Tamaño: `w-[140px] h-[140px]`** — intencionalmente el botón más grande de toda la aplicación, diseñado para ser presionado con facilidad incluso en condiciones de campo.
    * Forma: Círculo perfecto `rounded-full`.
    * Fondo: Degradado cian `bg-gradient-to-br from-[#00A2E8] to-[#00E5FF]`.
    * Borde: `border-4 border-white/15`.
    * Sombra intensa: `shadow-[0_10px_25px_rgba(0,162,232,0.4)]`.
    * Contenido: Icono Play SVG (triángulo) `text-[2.2rem]` arriba + texto "INICIAR" `text-[1.2rem] font-extrabold` abajo, ambos en blanco. Layout `flex flex-col items-center justify-center gap-[6px]`.
    * Hover: `transform: scale(1.06); shadow-[0_12px_30px_rgba(0,162,232,0.6)]; bg-[#2563eb]`.
    * Active: `transform: scale(0.9)`.
    * Centrado horizontalmente con `mx-auto my-5`.
  * Botón "Cerrar" debajo: `bg-white/15 text-white rounded-xl w-full py-3 font-bold`. Icono `✕` + "Cerrar".

* **Panel de Ejecución (visible cuando el reloj ESTÁ corriendo):**
  * **Label de fase:** "Entrada al arco" / "Tiempo de tiro" en `text-[1.1rem] font-extrabold text-white/75 uppercase tracking-[0.12em]`.
  * **Texto informativo:** "Preparate para tirar" / "¡Adelante!" en `text-[1.2rem] font-bold text-white/70 tracking-[0.02em]`.
  * **Display del tiempo restante:**
    * Tamaño GIGANTE que ocupa gran parte de la pantalla: `font-size: min(38vw, 32vh)`. `font-weight: 900`. `line-height: 1`. `letter-spacing: -0.03em`.
    * Color normal: `text-white` con `text-shadow: 0 0 60px rgba(255,255,255,0.18)`.
    * Color advertencia (≤30s): `text-[#FFF200]` con `text-shadow: 0 0 40px rgba(251,191,36,0.4)`.
    * Color agotado (0s): `text-[#FF3B30]` con `text-shadow: 0 0 40px rgba(248,113,113,0.4)`.
    * Formato: `M:SS` (ej: `2:00`, `1:45`, `0:08`).
  * **Barra de progreso horizontal:**
    * `w-full max-w-[500px] h-[18px] bg-white/12 rounded-[10px] overflow-hidden`.
    * Relleno: `h-full rounded-[10px] transition-width duration-100`.
    * Color normal: `bg-[#00C853]` (verde). Advertencia: `bg-[#FFF200]`. Agotado: `bg-[#FF3B30]`.
    * Se vacía de 100% a 0% conforme avanza el tiempo.
  * **Botones de control:** Fila horizontal con gap `12px`, centrada, wrapping si no cabe:
    * **Pausar/Reanudar:** `px-6 py-4 rounded-[14px] bg-[#FFF200]/90 text-black font-extrabold`. Icono pausa ⏸ + "Pausar" / icono play ▶ + "Reanudar". Alterna entre ambos estados al tap.
    * **Reiniciar fase:** `px-6 py-4 rounded-[14px] bg-[#00C853]/85 text-white font-extrabold`. Icono ↻ + "Reiniciar". Resetea la fase actual (entrada o tiro) a su duración original.
    * **Minimizar:** `px-6 py-4 rounded-[14px] bg-white/15 text-white font-extrabold`. Icono ⊟ + "Minimizar". Cierra el overlay pero **el reloj sigue corriendo en segundo plano**. El FAB muestra el tiempo restante.
    * **Cerrar/Detener:** `px-6 py-4 rounded-[14px] bg-[#FF3B30]/85 text-white font-extrabold`. Icono ■ + "Cerrar". Detiene completamente el reloj y vuelve a la interfaz de scoring.

##### 5.2.3. Reloj Mini (en la pantalla de Scoring)
Cuando el reloj está corriendo y el overlay está minimizado, se muestra un widget compacto inline en la pantalla de scoring:
* Posición: Dentro del área de scoring, arriba del contenido, como un banner compacto.
* Visual: `bg-[#1A1D20] border border-[#2C2F33] rounded-[10px] px-3 py-2 flex items-center gap-[10px]`.
* Tiempo en `text-[1.6rem] font-black min-w-[52px]`. Color normal blanco, warn amarillo, over rojo.
* Texto informativo: "Entrada (0:08)" o "Tiro (1:45)" en `text-xs text-[#8E8E93]`.
* Barra de progreso mini integrada (`h-[5px]`) con los mismos colores del overlay.
* Al tap en el mini-reloj: reabre el overlay full-screen.

##### 5.2.4. Señales de Audio WA (Web Audio API)
Las señales acústicas se generan con la Web Audio API (`AudioContext`) para no depender de archivos de audio:
* **2 pitidos largos (660Hz, 1.0s cada uno, gap 1.2s):** Señal de entrada al arco. Se emiten al iniciar la fase de Preparación.
* **1 pitido largo (880Hz, 1.2s):** Señal de inicio de tiro. Se emite al transicionar de Preparación a Tiro.
* **3 pitidos cortos (440Hz, 0.9s cada uno, gap 1.05s):** Señal de tiempo agotado. Se emiten cuando el timer llega a 0:00.
* **Pitido de aviso corto (550Hz, 0.18s):** Se emite a los 30 segundos restantes y en los últimos 3 segundos de la fase de entrada.
* **Voz sintética de cuenta regresiva:** En los últimos 10 segundos de la fase de tiro, se usa `SpeechSynthesis` para anunciar el número restante en voz (10, 9, 8... 1) en el idioma configurado.
* El reloj es **no bloqueante**: el usuario puede seguir registrando puntos incluso si el timer llega a cero.

##### 5.2.5. Opción "Sin Reloj"
* Botón disponible en el panel de configuración: "SIN RELOJ" en `bg-[#FFF200]/90 text-black rounded-xl`.
* Al activarlo, se oculta el FAB y la sesión transcurre sin cronómetro. Se muestra un toast: "🔕 Sin reloj — La sesión transcurrirá sin cronómetro."

### 6. Scoring: Modo Teclado
* **Visual:** Tabla estructurada de rondas en la parte superior (55% pantalla) y teclado en la parte inferior (45%).
* **Reloj Flotante:** Mismo FAB y componente del reloj descrito en la sección **5.2**, funcionalidad idéntica.
* **Mecánica Rápida:**
  * Tabla con cuadrícula de arqueros donde una barra cian brillante vertical (`w-[3px] bg-[#00E5FF] shadow-[0_0_8px_rgba(0,229,255,0.5)]`) actúa como cursor de edición del casillero activo. La celda activa tiene fondo `bg-[#00E5FF]/8`.
  * Estructura de la tabla: Header con `End #` en la primera columna, luego columnas para cada flecha (1-3 o 1-6 según formato), columna `End Total`, columna `Running Total`. Header en `bg-[#1A1D20] text-[#8E8E93] text-xs font-medium`. Filas alternas con `bg-transparent` y `bg-white/[0.02]`. Bordes de celda en `border-[#2C2F33]/50`.
  * Teclado 4x4 táctil: Grilla `grid grid-cols-4 gap-2 p-3`.
    * Botones de puntuación máxima (`X`, `10`, `9`): `bg-transparent border-2 border-[#FFF200] text-[#FFF200] rounded-xl font-bold text-lg` con glow oro `shadow-[0_0_10px_rgba(255,242,0,0.2)]`. Al tap: `bg-[#FFF200]/15 scale-0.95`.
    * Botones estándar (`8` a `1` y `M`): `bg-transparent border border-[#00A2E8]/60 text-white rounded-xl font-medium text-lg`. Al tap: `bg-[#00A2E8]/10 scale-0.95`.
    * Botón `M` (Miss): Mismo estilo estándar pero texto en `text-[#FF3B30]` y borde `border-[#FF3B30]/40`.
    * Tecla Retroceso (⌫): `col-span-1 bg-[#1A1D20] border border-[#2C2F33] text-[#8E8E93] rounded-xl`. Icono SVG de flecha izquierda.
    * Tecla Intro (↵): `col-span-1 bg-gradient-to-br from-[#00A2E8] to-[#00E5FF] text-white rounded-xl font-bold` con glow cian.

### 7. Historial de Sesiones
Pantalla dedicada que permite al usuario consultar **todas** sus sesiones pasadas con detalle completo.

* **Acceso:** Desde el botón "History" (icono reloj/lista) en la navegación flotante inferior.
* **Filtros superiores:**
  * Selector de rango de fechas: pills "Last 7 days", "This month", "All time" + date picker personalizado. Estilos chip igual que Practice Type.
  * Filtro por tipo de práctica: "All", "Control", "Práctica", "Volumen".
  * Filtro por formato: "All", "WA 300", "WA 720", etc.
  * Filtro por tipo de arco: "All", "Recurve", "Compound", "Barebow".
* **Lista de sesiones:**
  * Cada sesión es una card compacta: `bg-[#1A1D20]/75 rounded-2xl border border-white/10 p-4 mb-3`.
  * **Fila superior:** Fecha en `text-xs text-[#8E8E93]` (ej: "May 27, 2026 · 14:30") + Badge de tipo de práctica (chip cian/amarillo/rojo según tipo).
  * **Fila central:** Score total en `text-2xl font-bold text-white` (ej: "285 / 300") + Porcentaje de precisión en `text-lg font-bold text-[#FFF200]` (ej: "95%").
  * **Fila inferior:** Formato en `text-xs text-[#8E8E93]` (ej: "WA 300 · Recurve · 70m") + Mini-gráfico sparkline SVG de distribución de puntos (8 barras mini que representan los ends).
  * **Indicador de récord:** Si la sesión es un récord personal, badge `"🏆 Personal Best"` en `bg-[#FFF200]/15 text-[#FFF200] rounded-full px-2 py-0.5 text-xs font-bold`.
* **Vista de detalle de sesión (al tocar una card):**
  * Pantalla expandida con:
    * Score total y porcentaje gigante en la parte superior.
    * **Desglose por End:** Tabla completa con cada end (número, flechas individuales con chips coloreados, total del end, acumulado). Incluye la nota del end si existe (texto en `text-xs text-[#8E8E93] italic` debajo de las flechas).
    * **Nota post-sesión:** Si existe, se muestra en una card `bg-[#1A1D20]/50 rounded-xl p-3 border border-[#2C2F33]` con icono de nota 📝 y texto en `text-sm text-white`.
    * **Gráfico de distribución:** Gráfico de barras mostrando cuántas flechas cayeron en cada zona (X, 10, 9, 8... M).
    * **Datos de la sesión:** Formato, distancia, tipo de arco, tipo de práctica, fecha/hora, duración.
    * **Mapa de impactos:** Si se usó Modo Diana, muestra una diana SVG con todos los impactos registrados de toda la sesión sobrepuestos.
  * Botón "Share" para compartir como imagen o PDF.
  * Botón "Delete" en rojo con doble confirmación.

### 8. Asistencia y Calendario de Entrenamientos
* **Visual:** Vista mensual con cuadrícula de días sobre fondo negro.
* **Funciones:**
  * Navegación de meses: Flechas `<` `>` en `text-[#00E5FF]` con el nombre del mes en `text-xl font-bold text-white` centrado.
  * Días de la semana: Header de `Lu Ma Mi Ju Vi Sa Do` en `text-xs text-[#8E8E93] font-medium`.
  * Celdas de día: `w-10 h-10 rounded-full` centradas. Día actual: anillo `ring-1 ring-[#00E5FF]`. Días fuera del mes: `text-[#2C2F33]`.
  * Los días de entrenamiento asistido se destacan: fondo `bg-[#00E5FF]/15`, texto `text-[#00E5FF] font-bold`, y una mini-diana vectorial SVG (`w-3 h-3`) en la esquina superior derecha de la celda con los anillos concéntricos simplificados en cian.
  * Widget lateral de porcentaje de asistencia (ej: 92%) animado con un medidor circular SVG: anillo de fondo `stroke: #2C2F33`, arco de progreso `stroke: #00E5FF` hasta el 75% y `stroke: #FFF200` del 75% al 100%, animación `pathLength` de 0 a valor real en 1.5s. Número centrado `text-3xl font-bold text-[#FFF200]` con el símbolo `%` en `text-lg text-[#8E8E93]`.
  * Esta pantalla es visible para el arquero en su perfil y auditable por el entrenador para evaluar el progreso y la constancia del atleta.

### 9. Perfil y Ajustes del Usuario (Settings)
Pantalla completa de configuración personal accesible desde el botón "Profile" en la navegación flotante.

* **Layout:** Scroll vertical con secciones separadas por dividers sutiles `border-b border-[#2C2F33]/30`.

* **9.1. Header del Perfil:**
  * Avatar circular grande: `w-20 h-20 rounded-full border-3 border-[#00A2E8]` con imagen de perfil o iniciales sobre fondo `bg-[#00A2E8]/20`. Botón de edición de foto: icono cámara en un circle overlay `w-7 h-7 bg-[#00E5FF] rounded-full absolute bottom-0 right-0`.
  * Nombre del usuario en `text-xl font-bold text-white`.
  * Badge de rol: "Archer" en `bg-[#00E5FF]/15 text-[#00E5FF] rounded-full px-3 py-0.5 text-xs font-medium` o "Coach" en `bg-[#FFF200]/15 text-[#FFF200]` o "Admin" en `bg-[#FF3B30]/15 text-[#FF3B30]`.
  * Badge de plan: "FREE" gris o "PRO ✦" amarillo.
  * Nombre del club debajo en `text-sm text-[#8E8E93]`.

* **9.2. Datos Personales:**
  * Cards editables con iconos: Nombre, Email (solo lectura), Fecha de nacimiento, País (con bandera), Género.
  * Cada campo: fila horizontal `flex justify-between items-center py-3`. Label a la izquierda en `text-sm text-[#8E8E93]`, valor a la derecha en `text-sm font-medium text-white`. Icono lápiz `✏️` para editar.

* **9.3. Configuración del Arco:**
  * Tipo de arco: Selector de 3 cards (Recurve / Compound / Barebow) con icono SVG. Card activa: `border-[#00E5FF] bg-[#00E5FF]/8`.
  * Campos editables: Marca, Modelo, Poundaje (lbs), Distancia predeterminada (m).

* **9.4. Datos Físicos:**
  * Altura (cm), Peso (kg), Ojo dominante (L/R toggle), Mano dominante (L/R toggle).

* **9.5. Card de Suscripción:**
  * Si es Free: Card con borde gris `border-[#2C2F33]`, texto "Free Plan" en blanco, lista de limitaciones, botón "Upgrade to PRO ✦" en `bg-gradient-to-br from-[#FFF200] to-[#FFD600] text-black rounded-full px-6 py-3 font-bold` que abre el modal de paywall.
  * Si es PRO: Card con borde amarillo `border-[#FFF200]/30` y glow sutil. Badge "PRO ✦ Active" + fecha próxima facturación + email PayPal + botón "Manage on PayPal" + botón "Cancel Subscription" en `text-sm text-[#FF3B30]`.

* **9.6. Notificaciones:**
  * Toggle: "Push Notifications" (activa/desactiva FCM).
  * Toggle: "Email Notifications" (recibir recordatorios y resúmenes por correo).
  * Toggle: "WhatsApp Notifications" (si el coach del club configuró su número).
  * Cada toggle: pista inactiva `bg-[#2C2F33]`, activa `bg-[#00E5FF]`.

* **9.7. Gestión del Club (solo visible para Coach):**
  * "Transfer Coach Role" — botón en `text-sm text-[#FF3B30]` que abre un modal con la lista de miembros del club mayores de edad para seleccionar al nuevo Coach.
  * "Club Invite Code" — muestra el código de invitación en `font-mono text-lg text-[#FFF200] tracking-[0.2em]` con botón de copiar.
  * "Club WhatsApp" — Input para que el Coach ingrese su número de WhatsApp para notificaciones del club.

* **9.8. Herramienta de Diagnóstico (Dev Only):**
  * Visible solo si `process.env.NODE_ENV === 'development'` o si el usuario tiene flag `devMode: true`.
  * Toggle "DEV: Simulate PRO" en `text-xs text-[#FF3B30] font-mono`. Borde rojo discontinuo `border border-dashed border-[#FF3B30]/30 rounded-xl p-3`.

* **9.9. Cerrar Sesión:**
  * Botón: `bg-transparent border border-[#FF3B30]/40 text-[#FF3B30] rounded-xl w-full py-3 font-medium`. "Log Out" con icono de salida. Confirmación al tap.

### 10. Dashboard del Entrenador (Coach View)

El Dashboard del Entrenador implementa un **modelo de suscripción escalonado Free / PRO**, análogo al del arquero pero adaptado a las necesidades del preparador.

#### 10.1. Coach Free (Funcionalidades Base)
* **Panel de Atletas (Izquierda):**
  * Listado vertical scrollable de los atletas a cargo del entrenador.
  * Cada tarjeta de atleta: `bg-[#1A1D20]/75 backdrop-blur-md rounded-2xl border border-white/10 p-4 mb-3`.
    * Avatar circular `w-12 h-12 rounded-full border-2 border-[#00A2E8]`.
    * Nombre en `text-base font-semibold text-white`.
    * Tipo de arco en `text-xs text-[#8E8E93]` (ej: "Recurve · 70m").
    * Insignia de rendimiento: chip `rounded-full px-2 py-0.5 text-xs font-medium`. Colores: Oro `bg-[#FFF200]/15 text-[#FFF200]` para rendimiento >90%, Cian `bg-[#00E5FF]/15 text-[#00E5FF]` para >75%, Gris `bg-[#2C2F33] text-[#8E8E93]` para <75%.
    * Mini-onda SVG de progresión: `w-[80px] h-[24px]`, polyline cian mostrando tendencia de últimas 5 sesiones.
    * Enlace "View Details →" en `text-xs text-[#00A2E8]`.
  * Búsqueda rápida: Input en la parte superior con icono lupa en cian.
* **Vista de Detalle del Atleta:**
  * Historial de sesiones recientes, gráfico de progresión, calendario de asistencia del atleta.
* **Planificador Semanal Básico (Derecha):**
  * Calendario semanal: cuadrícula de 7 columnas (Lun-Dom) con celdas para entrenamientos simples.
  * El entrenador puede crear eventos: tipo de práctica, distancia y hora.
  * Los eventos se muestran como chips cian en la celda.

#### 10.2. Coach PRO (Funcionalidades Premium) 🔒
* **Acceso a Macrociclos de Entrenamiento:**
  * Todo el módulo de planificación de macrociclos (pantalla 15) está **exclusivamente disponible** para entrenadores con suscripción PRO.
  * Botón de acción rápida: "Assign Macrocycle Plan" — `bg-gradient-to-br from-[#00A2E8] to-[#00E5FF] text-white rounded-full px-6 py-3 font-semibold`.
  * Si el entrenador es **Free**, el botón aparece deshabilitado con overlay de candado 🔒 y badge "PRO". Al tocarlo, se despliega el modal de paywall.
* **Analytics Avanzados del Equipo:**
  * Promedio de scores, gráfico comparativo entre atletas, heatmap de asistencia colectiva.
* **Exportación de Informes:**
  * Botón "Export Report" (PDF/CSV) disponible solo en PRO.

#### 10.3. Indicadores Visuales de Tier en Coach View
* Badge visible en el header: "FREE" gris o "PRO ✦" amarillo con glow.
* Banner de upgrade discreto para Free: "Unlock Macrocycles & Advanced Analytics → Upgrade to PRO" en `text-xs text-[#FFF200]`.

### 11. Matchplay (Duelos): Lobby
* **Funciones:**
  * Crear salas ("CREATE ROOM") con código de invitación único.
  * Unirse a salas ("JOIN ROOM") mediante código.
  * Salas públicas visibles con tipo de arco (Recurve/Compound/Barebow), distancia y bandera de nacionalidad.
  * Filtrado por tipo de arco y distancia.

### 12. Matchplay Recurvo (Set System)
* **Mecánica:** Lógica reglamentaria WA para arco recurvo (sistema de sets).
  * Pantalla dividida cian (Jugador 1) y roja (Rival).
  * Puntos de set gigantes. Ganador del end = 2 pts, empate = 1 pt, primero en 6 pts de set gana.
  * Desglose de flechas por end en paneles inferiores.

### 13. Matchplay Compuesto (Cumulative System)
* **Mecánica:** Lógica reglamentaria WA para arco compuesto (acumulación de puntos).
  * Avatares con indicadores de tiros en tiempo real.
  * Sumatoria acumulada central (ej: `148 - 146 / 150`).

### 14. Tuning: Spine Matching (PRO) 🔒
* Gráfico cartesiano de calibración. Curvas logarítmicas cian. Contraste Bare Shaft Test (triángulos amarillo) vs Fletched Grouping (círculos cian). Badge PRO y overlay de bloqueo.

### 15. Macrociclos de Entrenamiento (PRO) 🔒
* Eje temporal horizontal, barras de carga, planificación por Mesociclo/Microciclo. Accesible SOLO para PRO (arquero y entrenador).

### 16. Guía de Ejercicios (PRO) 🔒
* Tarjetas multimedia de rutinas: General Strength, Specific Mobility, Bow Holding Drills. Badge PREMIUM y botón de reproducción.

### 17. Integración Spotify (FREE)
* **Visual:** Reproductor flotante con fondo difuminado de cristal `bg-[#1A1D20]/85 backdrop-blur-xl rounded-2xl border border-white/10`, controles en cian y logotipo de Spotify en verde oficial `#1DB954`.
* **Posición:** `fixed bottom-20 left-4 right-4` (encima de la navegación flotante). `z-40`.
* **Funciones:** Permite vincular la cuenta personal del arquero para reproducir música durante el entrenamiento o compartir playlists recomendadas con los miembros del club.
* **Disponible para TODOS los usuarios (Free y PRO).** Es parte integral de la experiencia de entrenamiento de la app.

---

## 🔔 Sistema de Notificaciones y Recordatorios

### 18.1. Notificaciones Push (Firebase Cloud Messaging)
* **Activación:** El usuario acepta el permiso de notificaciones en el primer uso (prompt nativo del navegador). Se almacena el token FCM en `users/{uid}/fcmTokens: [string]` (puede tener múltiples dispositivos).
* **Eventos que disparan notificaciones push:**
  * **Recordatorio de entrenamiento:** Si el Coach asigna un entrenamiento en el planificador semanal, el atleta recibe un push 1 hora antes: "🎯 Training Reminder — You have a training session in 1 hour: Control · 70m".
  * **Resultado de Matchplay:** Cuando un rival completa un duelo en vivo: "⚔️ Matchplay Result — You won/lost against [Rival] (285 - 270)".
  * **Nuevo plan asignado:** Cuando el Coach PRO asigna un macrociclo: "📋 New Plan — Coach [Name] assigned you a new macrocycle plan".
  * **Racha de asistencia:** Al completar 7 días seguidos: "🔥 7-Day Streak! You're on fire — keep it up!".
  * **Recordatorio de inactividad:** Si el arquero no registra sesión en 5 días: "🏹 We miss you! It's been 5 days since your last session.".
* **Visual de la notificación:** Icono del logo 101010, título en negrita, cuerpo descriptivo, acción que al tocar abre la pantalla relevante de la app.
* **Implementación:** Cloud Function `onWrite` en las colecciones relevantes que envía el push mediante `admin.messaging().send()`.

### 18.2. Notificaciones por Email
* **Motor:** Firebase Extension "Trigger Email from Firestore" (usa SendGrid/Mailgun bajo el capó) o API Route con Resend/SendGrid SDK.
* **Eventos que disparan emails:**
  * **Bienvenida:** Al registrarse: email con branding de Archery101010, datos del club, y guía de inicio rápido.
  * **Confirmación de suscripción PRO:** Al completar el pago PayPal: recibo con detalles de la transacción.
  * **Resumen semanal:** Cada lunes a las 8:00 AM (hora local del usuario): resumen de la semana con sesiones completadas, score promedio, porcentaje de asistencia, progreso vs. semana anterior. Diseño visual tipo newsletter con paleta oficial (fondo oscuro, acentos cian/amarillo).
  * **Recordatorio de entrenamiento:** Mismo evento que el push, pero por email para usuarios que prefieren este canal.
  * **Vencimiento de suscripción PRO:** 3 días antes del vencimiento: email recordando la renovación.
* **Colección Firestore:** Se escribe en `mail/{docId}: { to: email, template: { name: string, data: object } }` y la extensión de Firebase procesa el envío.
* **Preferencias:** El usuario controla qué emails recibe desde la pantalla de Settings (sección 9.6).

### 18.3. Notificaciones por WhatsApp
* **Enfoque Híbrido (gratuito para clubes pequeños):**

  **Opción A — WhatsApp Cloud API (Meta) — Para clubes con infraestructura:**
  * Tier gratuito: **1,000 conversaciones de servicio/mes** sin costo. Suficiente para un club de hasta ~200 miembros con notificaciones esporádicas.
  * Se requiere: una cuenta de Meta Business, un número de teléfono dedicado, y verificación del negocio.
  * Configuración: El administrador del sistema configura el número de WhatsApp Business en la sección de Admin Settings. Se crean **plantillas de mensaje** (templates) aprobadas por Meta para cada tipo de notificación.
  * Los mensajes se envían desde una Cloud Function o API Route cuando ocurren los eventos relevantes.
  * Firestore: `users/{uid}/whatsappNumber: string` (opcional, el usuario lo registra en su perfil).

  **Opción B — Enlace Directo `wa.me` — Para comunicación Coach→Atleta (sin costo, sin API):**
  * El Coach registra su número de WhatsApp personal en la configuración del club (Settings del Coach, sección 9.7).
  * En el Dashboard del Coach, cada tarjeta de atleta incluye un **botón de WhatsApp** `🟢` que genera un enlace `https://wa.me/{coachNumber}?text={mensaje_pre-armado}` con un mensaje predefinido (ej: "Hola [Atleta], recordatorio de entrenamiento mañana a las [hora] en [lugar]. — Coach [Nombre], Archery101010").
  * El Coach toca el botón → se abre WhatsApp con el mensaje pre-armado → el Coach envía manualmente o edita antes de enviar.
  * **Costo: CERO.** Solo requiere que el Coach tenga WhatsApp personal.
  * Visual del botón en la tarjeta del atleta: icono WhatsApp SVG en verde `#25D366`, circle `w-9 h-9 bg-[#25D366]/15 rounded-full flex items-center justify-center` con `hover:bg-[#25D366]/25`.

  **Opción C — Alternativa Self-Hosted (Avanzada, opcional):**
  * Para clubes que deseen automatización completa sin pagar por mensaje, se puede integrar **Evolution API** o **WAHA** como servicio auto-hospedado.
  * Requiere un VPS ($5-20/mes), Docker, y un número de WhatsApp dedicado.
  * No recomendado para el MVP; documentado como opción de escalamiento futuro.

* **Configuración visual en Admin Panel:**
  * Sección "WhatsApp Integration" en Admin Settings.
  * Toggle: "Enable WhatsApp Notifications" (activa/desactiva globalmente).
  * Input: "WhatsApp Business Number" con validación de formato internacional (+506XXXXXXXX).
  * Selector: Método de integración (Cloud API / Direct Link / Self-Hosted).

---

## 🔐 Panel de Administración (Admin Dashboard)

Panel exclusivo para el **administrador del sistema** que permite gestionar usuarios, suscripciones y la plataforma. Accesible solo mediante rol `admin` en Firebase Auth Custom Claims.

### 19.1. Acceso y Autenticación del Admin
* Ruta protegida: `/admin`. Middleware de verificación server-side del Custom Claim `role: "admin"`.

### 19.2. Layout del Panel Admin
* Sidebar fija a la izquierda (`w-[260px]`, colapsable a `w-[64px]`) + Área de contenido principal.
* Secciones de navegación:
  1. **Dashboard** — Vista general de métricas.
  2. **Users** — Gestión de usuarios.
  3. **Subscriptions** — Gestión de planes Free/PRO.
  4. **Payments** — Historial de pagos PayPal.
  5. **Notifications** — Gestión de notificaciones (enviar push/email masivo, configurar templates).
  6. **Analytics** — Métricas de la plataforma.
  7. **Settings** — Configuración global (WhatsApp, PayPal keys, email templates).

### 19.3. Gestión de Usuarios
* Tabla con columnas: Avatar, Nombre, Email, Rol (Archer/Coach), Tipo de Arco, Plan (Free/PRO), Club, Fecha Registro, Última Actividad, Acciones.
* Acciones: View Profile, Change Plan, Disable Account, Delete Account.
* Filtros: Rol, Plan, Estado, Club.

### 19.4. Gestión de Suscripciones — Cambio Free ↔ PRO
* Modal con selector visual de plan (cards Free vs PRO lado a lado).
* Campos admin: Reason for change, Expiration Date, Override PayPal toggle.
* Flujo técnico: Firestore update → Custom Claim update → Audit log.

### 19.5. Historial de Pagos
* Tabla de transacciones PayPal con estados coloreados (Completed verde, Pending amarillo, Failed rojo, Refunded cian).

### 19.6. Analytics
* Métricas de engagement, distribución de arcos (Recurve/Compound/Barebow), funnel Free→PRO, sesiones diarias.

---

## 💳 Sistema de Pagos con PayPal (Suscripción PRO)

### 20.1. Modal de Paywall PRO
* Se activa al tocar cualquier módulo PRO bloqueado o desde Settings.
* Lista de beneficios PRO, selector Monthly/Annual, botones nativos de PayPal SDK (`@paypal/react-paypal-js`).
* Flujo: `createSubscription()` → aprobación PayPal → verificación server-side → Firestore + Custom Claim → confetti de éxito.

### 20.2. Webhooks de PayPal
* Endpoint: `/api/paypal/webhook`. Eventos: ACTIVATED, CANCELLED, SUSPENDED, EXPIRED, SALE.COMPLETED, SALE.REFUNDED.
* Seguridad: Verificación de firma del webhook.

### 20.3. Gestión de Suscripción (en Settings del usuario)
* Card de suscripción con estado, próxima facturación, botones Manage/Cancel.

---

## 🔒 Control de Suscripciones: Free vs PRO (Resumen de Módulos)

### Módulos del Arquero:
| Módulo | Free | PRO |
| :--- | :---: | :---: |
| Dashboard Principal | ✅ | ✅ |
| Configuración de Sesión | ✅ | ✅ |
| Scoring: Diana y Teclado | ✅ | ✅ |
| Reloj Flotante de Scoring | ✅ | ✅ |
| Sistema de Notas | ✅ | ✅ |
| Historial de Sesiones | ✅ | ✅ |
| Calendario de Asistencia | ✅ | ✅ |
| Matchplay (Duelos) | ✅ | ✅ |
| Integración Spotify | ✅ | ✅ |
| Notificaciones Push/Email/WhatsApp | ✅ | ✅ |
| Análisis Avanzado (Dashboard) | ❌ | ✅ |
| Spine Matching (Tuning) | ❌ | ✅ |
| Macrociclos de Entrenamiento | ❌ | ✅ |
| Guía de Ejercicios Premium | ❌ | ✅ |

### Módulos del Entrenador (Coach):
| Módulo | Free | PRO |
| :--- | :---: | :---: |
| Panel de Atletas | ✅ | ✅ |
| Vista de Detalle del Atleta | ✅ | ✅ |
| Planificador Semanal Básico | ✅ | ✅ |
| Notificaciones a Atletas (Push/Email/WA) | ✅ | ✅ |
| Asignar Macrociclos a Atletas | ❌ | ✅ |
| Analytics Avanzados del Equipo | ❌ | ✅ |
| Exportación de Informes (PDF/CSV) | ❌ | ✅ |

### Mecánica de Paywall:
* Overlay oscuro `bg-black/50`, candado SVG en `stroke: #FFF200`, badge "PRO", blur `blur-[2px]` sobre el contenido.

---

## 🎬 Guía de Animaciones y Transiciones (Framer Motion)

1. **Transición entre Pantallas (Slide & Fade):**
   ```typescript
   const pageVariants = {
     initial: { opacity: 0, y: 10 },
     animate: { opacity: 1, y: 0, transition: { duration: 0.25, ease: "easeOut" } },
     exit: { opacity: 0, y: -10, transition: { duration: 0.2 } }
   };
   ```
2. **Carga en Cascada (Staggered Bento Cards):**
   ```typescript
   const containerVariants = { animate: { transition: { staggerChildren: 0.05 } } };
   const cardVariants = {
     initial: { opacity: 0, scale: 0.95 },
     animate: { opacity: 1, scale: 1, transition: { duration: 0.3, ease: "easeOut" } }
   };
   ```
3. **Efecto de Trazado SVG (Velocímetros):**
   ```typescript
   const pathVariants = {
     initial: { pathLength: 0 },
     animate: { pathLength: 1, transition: { duration: 1.2, ease: "easeInOut" } }
   };
   ```
4. **Hover/Tap Botones Neón:**
   ```typescript
   const neonButtonPress = {
     hover: { scale: 1.02, filter: "brightness(1.15)" },
     tap: { scale: 0.98, filter: "brightness(0.95)" }
   };
   ```
5. **Pulso FAB del Reloj:**
   ```typescript
   const fabPulse = {
     animate: {
       boxShadow: [
         "0 4px 18px rgba(0,0,0,.35), 0 0 0 0 rgba(0,162,232,.5)",
         "0 4px 18px rgba(0,0,0,.35), 0 0 0 14px rgba(0,162,232,0)"
       ],
       transition: { duration: 2.4, repeat: Infinity, ease: "easeInOut" }
     }
   };
   ```
6. **Confetti de Éxito PRO:**
   ```typescript
   const confettiParticle = {
     initial: { y: 0, x: 0, rotate: 0, opacity: 1 },
     animate: {
       y: [0, -200, 400],
       x: () => Math.random() * 300 - 150,
       rotate: () => Math.random() * 720,
       opacity: [1, 1, 0],
       transition: { duration: 2, ease: "easeOut" }
     }
   };
   ```

---

## 🚀 Novedades, Mejoras y Correcciones Críticas (Fase 14)

En esta fase se implementaron mejoras visuales premium, separación avanzada de roles organizacionales, adaptación responsiva multidispositivo y la resolución de 6 vulnerabilidades o fallos críticos identificados en auditoría.

### 1. 👥 Gestión Avanzada de Roles en Clubes (Team Admin vs Coach)
Para flexibilizar la estructura de los equipos y permitir que personas no técnicas o atletas lideren clubes sin forzarlos a actuar como entrenadores, se reformuló el sistema de roles:
* **Nuevos Roles:**
  * `team_admin`: Administrador de Club. Puede editar el perfil del club (nombre, bandera del país, logotipo SVG), ver el roster de miembros y promover o demoler roles. No tiene acceso a la Consola de Entrenador ni a las métricas del equipo a menos que active el rol dual.
  * `team_admin_coach`: Rol Dual. Combina los permisos de administración del club y la visualización de estadísticas, asistencia diaria, macrociclos y control de entrenamientos.
* **Flujo de Onboarding Dual:** Durante el paso 3 del registro, si el usuario crea un club nuevo, se le otorga por defecto el rol de `team_admin`. Se incluye un control tipo checkbox ("Actuar también como Coach") que le permite activar la doble personalidad (`team_admin_coach`) desde su creación.
* **Consola de Roster en Perfil:** En la sección de configuración del Perfil (Settings), el administrador puede ver el roster completo de miembros del club y promover arqueros (`archer`) a entrenadores (`coach`), o degradar entrenadores de regreso a arqueros síncronamente con guardado offline-first e IndexedDB.
* **Auto-Promoción:** El Team Admin puede activar o desactivar su propia funcionalidad de coach en cualquier momento mediante un switch en su panel de administración, habilitando o deshabilitando dinámicamente el switch de visualización "Mi Equipo" en el Header.

### 2. 🥇 Rebranding "Estrellas 101010"
Se eliminaron todas las leyendas relacionadas con marcas de terceros en el sistema de logros y estrellas para registrar la propiedad intelectual de la marca:
* **Renombramiento de Insignias:** Reemplazados todos los términos "World Archery Star", "Estrellas WA 720" o "Estrella FITA" por **"Estrellas 101010"** en el panel de perfil del arquero, la ficha técnica del atleta, el ranking del club de la consola de coach, y en el modal emergente de desbloqueo.
* **Preservación del Estándar Técnico:** Las rondas de puntuación y configuraciones de tiro oficiales de World Archery (ej. `WA 720`, `WA 600`, `WA 300`) conservan sus nombres técnicos por tratarse de estándares olímpicos normalizados.

### 3. 📱 Contenedor Adaptativo Responsivo (iPad / Tablet / PC)
Para superar la restricción fija de anchura telefónica en dispositivos medianos y grandes, se rediseñó el simulador de dispositivo:
* **iPads y Tablets:** En viewports entre `768px` y `1024px`, el marco físico del iPhone (notch, bordes redondeados y barra home) se oculta automáticamente. La aplicación se ensancha de forma fluida hasta un ancho máximo adaptado de `768px` centrado, optimizando la visibilidad del dashboard, las dianas SVG y los gráficos.
* **Ordenadores de Escritorio (PC):** En pantallas superiores a `1024px`, la aplicación se centra en un ancho controlado de `1024px` ocupando todo el alto disponible, dando una sensación limpia y premium de aplicación web de escritorio.

### 4. 📢 Píldora de Publicidad Flotante y Configurable (`NotificationBar`)
Se rediseñó el banner de notificación publicitaria de ancho completo para convertirlo en una píldora estética flotante:
* **Estética de Píldora:** Diseñado como cápsula ovalada flotante con bordes `rounded-full` centrada horizontalmente en `top-4`, con sombra profunda y animaciones de entrada Framer Motion.
* **Configuración de Estilos:** Se expandió la base de datos `AdCampaign` permitiendo definir:
  * **Pill Style:** `solid` (color plano), `glass` (fondo oscuro difuminado con desenfoque de fondo y borde cristal), o `gradient` (degradado premium usando colores de marca cyan a rojo).
  * **Custom Height & Font Size:** Altura de píldora y tamaño de letra configurables por el administrador.
* **Cierre Inmediato (Tap-to-Close):** Presionar en cualquier área de la píldora abre el enlace de la campaña en una pestaña nueva y cierra la notificación de inmediato, garantizando que no obstruya los controles de navegación.

### 5. 🎬 Pantalla de Entrada Animada (`IntroScreen`)
Se integró una intro animada fluida de 6.7 segundos al cargar la aplicación por primera vez:
* **Fases de la Animación:**
  1. *Fase de Campo:* Imagen de un campo de tiro con gradiente circular.
  2. *Fase de Arco Recurvo:* Imagen y descripción HUD en cian neón.
  3. *Fase de Arco Compuesto:* Imagen y descripción en rojo rival.
  4. *Fase de Barebow:* Imagen y descripción en amarillo oro.
  5. *Fase de Branding:* Collage de logotipos olímpicos vectoriales SVG, el logo principal `101010 ARCHERY v1.1` con tipografía oficial Good Times, y el renderizado animado de la firma manuscrita cursiva del creador, Rodrigo Saborío.
* **Usabilidad:** Incluye un botón "Saltar" en la esquina superior para evadir la animación y cargar la pantalla principal instantáneamente si el usuario lo prefiere.

### 6. 🛠️ Solución a las 6 Vulnerabilidades de Auditoría Críticas
Se implementaron soluciones robustas para corregir los fallos funcionales identificados:
1. **Mitigación de Bucle Infinito en Sync Manager (`skippedIds`):** Ante errores persistentes de Firestore (como denegaciones de reglas de seguridad o autenticación vencida), el `syncManager.ts` marcaba las escrituras como fallidas pero las reintentaba indefinidamente bloqueando el hilo principal del navegador. Se implementó una colección `skippedIds` en memoria que descarta transacciones problemáticas tras varios fallos, permitiendo que la cola continúe fluyendo con elementos posteriores.
2. **Pruebas de Publicidad para Cuentas PRO (Super Admins):** Se omitieron los filtros de plan para usuarios que poseen el rol `"superadmin"`. Esto les permite probar campañas visuales directamente en producción aunque su cuenta tenga la insignia PRO (que bloquea anuncios por defecto).
3. **Reconexión Automática por Foco (`visibilitychange`):** Para evitar los retardos de reconexión del SDK de Firestore cuando el dispositivo vuelve de un estado de suspensión o bloqueo, se añadió un listener que detecta el regreso al foco activo y ejecuta secuencialmente `disableNetwork` y `enableNetwork`, forzando la recuperación de conexión en milisegundos.
4. **Área Segura y Soporte de Muesca (Notch Support):** Modificada la hoja de estilos general y componentes Header/NotificationBar para utilizar variables CSS seguras `env(safe-area-inset-top)`. Esto empuja dinámicamente el Header y las píldoras publicitarias hacia abajo en terminales iPhone/Android que operan en modo standalone de PWA, evitando que la barra de estado solape los elementos interactivos.
5. **Escala de Fuentes Incrementada:** Aumentados los tamaños base de fuente de accesibilidad para mejorar la legibilidad en campo a:
  * Pequeño: `18px`
  * Mediano: `20px`
  * Grande (Por defecto): `22px`
6. **Métricas de Anuncios Sincronizadas:** Modificadas las funciones del motor publicitario para inyectar transacciones a la cola de sincronización de IndexedDB (`addToSyncQueue`) en tiempo real cuando ocurre una impresión o clic. Esto asegura que las analíticas de anuncios se sincronicen de inmediato con Firestore en segundo plano sin impactar la latencia.
