# Archery 101010 - Guía del Agente Gemini

## 📌 Reglas de Desarrollo y Despliegue

1.  **Repositorio de GitHub Automático:** Cada aplicación o proyecto creado o gestionado por un agente debe contar con su correspondiente repositorio en GitHub (`https://github.com/joyod2/<NombreApp>`) configurado y sincronizado automáticamente desde su creación para facilitar el desarrollo continuo y pruebas rápidas en dispositivos móviles mediante Netlify/Vercel.
2.  **Sincronización y Resiliencia (Offline-First):** Guardar cambios localmente en IndexedDB al instante (cero latencia) y sincronizar secuencialmente en segundo plano con reintentos automáticos y soporte de snapshots.
3.  **Frontend SaaS Premium 2025:** Estructura moderna con Next.js, TypeScript, Tailwind CSS, Framer Motion, shadcn/ui y modo oscuro OLED por defecto.
4.  **Control de Versión de Publicación:** Cada vez que se realicen cambios y se publiquen commits en el repositorio, se debe incrementar el número de versión de la aplicación sumando +0.1 a la versión actual mediante el script de auto-incremento.
5.  **Control Centralizado:** La versión de la aplicación se almacena de forma centralizada en `src/lib/version.ts` y se actualiza mediante `npm run bump-version`.
6.  **Flujo de Usuario Mobile-First (Dispositivo Android):** El usuario opera, evalúa y prueba casi en su totalidad desde su celular Android. Todas las entregas, enlaces, interfaces táctiles y pruebas deben estar orientadas para que el usuario pueda abrirlas, probarlas y descargarlas directamente en su teléfono móvil sin depender de configuraciones complejas en la computadora.

---

## 🎨 Reglas Estrictas de Diseño y Marca (ADN WHOOP / Apple / Nike)

1.  **Logo Oficial Exacto (`ARCHERY 101010`):**
    *   Siempre que se muestre el encabezado **`ARCHERY 101010`**, se debe usar el activo oficial de marca en calidad 4K Retina (`src="/images/brand_logo_header.png"` con `srcSet="/images/brand_logo_header.png 1x, /images/brand_logo_full.png 2x"`), donde **`ARCHERY`** está en tipografía **Good Times** (`white`) y **`101010`** mantiene su logotipo geométrico curvo oficial en cian (`#00BFFF`/`#00A8F3`), rojo (`#FF0000`/`#FF1E1E`) y amarillo (`#FFE500`/`#FFF200`).
    *   **Nunca** escribir `101010` con la fuente CSS `Good Times` ni con fuentes genéricas, ya que altera la geometría oficial de los números de la marca.
    *   El subtítulo **`THE APP`** o encabezados principales de marca siempre van con la fuente **Good Times** (`font-good-times`).
2.  **Estética Deportiva de Alto Nivel (ADN WHOOP / Apple / Nike):**
    *   **Cero Glow Artificial ("Look de IA"):** Prohibido usar `text-shadow` neón, resplandores borrosos o gradientes saturados.
    *   **Acabado Negro OLED y Titanio Mate:** Fondos en negro profundo (`#020305`, `#06080C`, `#07090E`), biseles en titanio oscuro mate (`#12151C`) y bordes nítidos de `1px` (`rgba(255,255,255,0.08)` a `0.12`).
    *   **Tipografía Deportiva y Tabular (`Outfit`):** Todos los contadores, métricas (`km`, `kcal`, flechas, tandas) y etiquetas deben usar tipografía geométrica deportiva (`Outfit` / `font-sans tabular-nums`), **nunca** fuentes de programación (`JetBrains Mono` / `monospace`) con ceros tachados.
3.  **Proporción, Contención y Armonía Geométrica:**
    *   Todo elemento debe caber 100% dentro de su contenedor sin partirse en líneas imprevistas ni cortarse contra bordes circulares (como la esfera del Smartwatch).
    *   Eliminar textos explicativos largos o redundantes; priorizar indicadores compactos (`● LIVE`, `SYNC`, pills minimalistas).
4.  **Flujo de Autorización Visual (Muestra PNG 4K Previa):**
    *   Cuando el usuario solicite cambios de diseño o interfaz con revisión previa, generar primero un **PNG en máxima calidad 4K Retina** (`--force-device-scale-factor=4`), verificarlo visualmente y entregarle el enlace directo en Firebase Hosting antes de modificar el código de producción.
