---
name: archery-brand-designer
description: >-
  Diseñadora Senior UI/UX dedicada a mantener la identidad visual oficial de
  ARCHERY 101010 con ADN WHOOP, Apple y Nike. Úsala siempre que se diseñen,
  rediseñen o auditen pantallas, modales, esferas de Smartwatch o vistas previas
  PNG en 4K Retina.
---

# Archery 101010 Brand Designer (ADN WHOOP / Apple / Nike)

## 1. Reglas Inquebrantables de Identidad Visual
- **Logotipo Oficial (`ARCHERY 101010`):**
  - Usar siempre `/images/brand_logo_header.png` (`656x48` 4x Bicubic) con `srcSet="/images/brand_logo_header.png 1x, /images/brand_logo_full.png 2x"`.
  - En el logo oficial, **`ARCHERY`** está en tipografía **Good Times** blanca y **`101010`** utiliza su geometría curva original en cian (`#00A8F3`), rojo (`#FF1E1E`) y amarillo (`#FFE500`).
  - **Prohibido** renderizar `101010` como texto con la fuente `Good Times` o fuentes de sistema.
  - Subtítulos de marca como **`THE APP`** llevan `font-good-times`.
- **ADN WHOOP / Apple / Nike:**
  - Fondos OLED negros puros y obsidiana mate (`#020305`, `#06080C`, `#07090E`).
  - Biseles de hardware en titanio oscuro mate (`#12151C`) con bordes de `1px` (`rgba(255,255,255,0.08)` - `0.12`).
  - **Cero Glow / Cero Efecto Neón de IA:** Nunca usar `text-shadow` brillante ni sombras de color difusas.
  - **Tipografía Deportiva (`Outfit`):** Números y métricas con `font-sans tabular-nums` (`font-weight: 800`), sin ceros tachados de fuentes `monospace`.
- **Geometría y Contención:**
  - En esferas circulares (Smartwatch `288px × 288px`), verificar matemáticamente el ancho de la cuerda circular en la coordenada `Y` superior para que el logo y los pills queden 100% contenidos con margen libre a ambos lados.
  - En encabezados de tarjetas/modales, mantener logo, estado (`● LIVE`), acción (`SYNC`) y cierre (`✕`) en una sola línea horizontal armónica.

- **PROHIBICIÓN ESTRICTA DE MARCAS REGISTRADAS DE TERCEROS:**
  - **JAMÁS** incluir nombres de marcas registradas externas (`Strava`, `WHOOP`, `Nike`, `Garmin`, `Apple Watch`, `Instagram`, `Facebook`, etc.) en pósters, carruseles, publicaciones de marketing, capturas promocionales ni textos visibles de la app. Usar únicamente **`ARCHERY 101010`** / **`THE APP`** y descriptores genéricos (*"Redes Sociales"*, *"Reloj Inteligente"*, *"Smartwatch Deportivo"*).

## 2. Flujo de Muestra Previa 4K Retina (Sin Instalar sin Autorización)
1. Generar la maqueta HTML/CSS y renderizar la captura con Microsoft Edge Headless a `--force-device-scale-factor=4` (calidad 4K Retina).
2. Inspeccionar siempre el PNG resultante con `read_file` para comprobar centrado, tipografía, nitidez y contención antes de mostrarlo al usuario.
3. Publicar únicamente el archivo PNG en Firebase Hosting para que el usuario pueda abrirlo desde su celular Android y esperar su autorización explícita antes de tocar el código del app.
