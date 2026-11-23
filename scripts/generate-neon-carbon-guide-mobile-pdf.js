const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

async function generateNeonCarbonMobilePdf() {
  const pdfDoc = await PDFDocument.create();
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // Mobile Phone Portrait Dimensions (9:17.5 — fills Android screen 100% without zooming)
  const PAGE_W = 390;
  const PAGE_H = 760;
  const MARGIN = 22;
  const CONTENT_W = PAGE_W - MARGIN * 2;
  const TOTAL_PAGES = 2;

  // Official Matte OLED Palette (Zero Glow)
  const bgDark = rgb(0.012, 0.016, 0.025);
  const cardBg = rgb(0.051, 0.063, 0.090);
  const cardBorder = rgb(0.16, 0.20, 0.27);
  const cyan = rgb(0.0, 0.749, 1.0);
  const red = rgb(1.0, 0.118, 0.118);
  const gold = rgb(1.0, 0.898, 0.0);
  const emerald = rgb(0.0, 0.784, 0.325);
  const white = rgb(1.0, 1.0, 1.0);
  const lightText = rgb(0.90, 0.92, 0.96);
  const muted = rgb(0.60, 0.65, 0.73);

  const logoPath = path.join(__dirname, '../public/images/brand_logo_full.png');
  let brandLogoImg = null;
  if (fs.existsSync(logoPath)) {
    brandLogoImg = await pdfDoc.embedPng(fs.readFileSync(logoPath));
  }

  function addMobilePage(pageNum, sectionTag) {
    const p = pdfDoc.addPage([PAGE_W, PAGE_H]);
    p.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: bgDark });

    // Top tricolor brand bar (Cyan | Red | Gold)
    const segW = PAGE_W / 3;
    p.drawRectangle({ x: 0, y: PAGE_H - 4, width: segW, height: 4, color: cyan });
    p.drawRectangle({ x: segW, y: PAGE_H - 4, width: segW, height: 4, color: red });
    p.drawRectangle({ x: segW * 2, y: PAGE_H - 4, width: segW, height: 4, color: gold });

    if (brandLogoImg) {
      const logoW = 142;
      const logoH = logoW * (brandLogoImg.height / brandLogoImg.width);
      p.drawImage(brandLogoImg, {
        x: MARGIN,
        y: PAGE_H - 27,
        width: logoW,
        height: logoH
      });
    }

    const tagText = `${sectionTag}  ·  ${pageNum}/${TOTAL_PAGES}`;
    p.drawText(tagText, {
      x: PAGE_W - MARGIN - fontBold.widthOfTextAtSize(tagText, 8.6),
      y: PAGE_H - 24,
      size: 8.6,
      font: fontBold,
      color: muted
    });

    p.drawLine({
      start: { x: MARGIN, y: PAGE_H - 36 },
      end: { x: PAGE_W - MARGIN, y: PAGE_H - 36 },
      thickness: 0.8,
      color: cardBorder
    });

    // Bottom mobile footer
    p.drawLine({
      start: { x: MARGIN, y: 34 },
      end: { x: PAGE_W - MARGIN, y: 34 },
      thickness: 0.8,
      color: cardBorder
    });
    p.drawText('ARCHERY 101010 · GUÍA MÓVIL NEON VS CARBON', {
      x: MARGIN,
      y: 18,
      size: 8.0,
      font: fontBold,
      color: muted
    });

    return p;
  }

  function wrapText(text, font, size, maxWidth) {
    const words = text.split(' ');
    const lines = [];
    let currentLine = '';
    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      if (font.widthOfTextAtSize(testLine, size) > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine) lines.push(currentLine);
    return lines;
  }

  function drawParagraph(page, text, x, y, width, font, size, color, lineGap = 4.2) {
    const lines = wrapText(text, font, size, width);
    let curY = y;
    for (const line of lines) {
      page.drawText(line, { x, y: curY, size, font, color });
      curY -= size + lineGap;
    }
    return curY;
  }

  function drawCard(page, topY, height, accentColor = cyan) {
    const bottomY = topY - height;
    page.drawRectangle({
      x: MARGIN,
      y: bottomY,
      width: CONTENT_W,
      height,
      color: cardBg,
      borderColor: cardBorder,
      borderWidth: 1
    });
    page.drawRectangle({
      x: MARGIN,
      y: bottomY,
      width: 4,
      height,
      color: accentColor
    });
    return bottomY;
  }

  function drawPill(page, text, x, y, bgColor, textColor) {
    const size = 8.4;
    const padX = 8;
    const w = fontBold.widthOfTextAtSize(text, size) + padX * 2;
    const h = 16;
    page.drawRectangle({
      x,
      y,
      width: w,
      height: h,
      color: bgColor
    });
    page.drawText(text, {
      x: x + padX,
      y: y + 4.5,
      size,
      font: fontBold,
      color: textColor
    });
    return w;
  }

  // =========================================================================
  // PAGE 1: DISTRIBUCIÓN RECOMENDADA POR TAREA
  // =========================================================================
  const p1 = addMobilePage(1, 'GUÍA GEMINI 4');
  let y = PAGE_H - 60;

  p1.drawText('NEON VS CARBON', {
    x: MARGIN,
    y,
    size: 20,
    font: fontBold,
    color: white
  });
  y -= 19;
  y = drawParagraph(
    p1,
    'Cómo distribuir la gama Gemini en el desarrollo de Archery 101010 (Next.js, Android, Wear OS, Connect IQ, watchOS y Firebase).',
    MARGIN,
    y,
    CONTENT_W,
    fontRegular,
    10.2,
    lightText,
    4
  );

  // Quick Split Banner
  y -= 8;
  const splitH = 66;
  const splitBottom = drawCard(p1, y, splitH, gold);
  p1.drawText('REGLA PRÁCTICA DEL PROYECTO', {
    x: MARGIN + 14,
    y: y - 18,
    size: 9.2,
    font: fontBold,
    color: gold
  });
  drawParagraph(
    p1,
    'No uses un solo modelo: combina Gemini 4 Neon para el ritmo diario (~75%) y Gemini 4 Carbon (High) para lo crítico (~25%).',
    MARGIN + 14,
    y - 34,
    CONTENT_W - 24,
    fontBold,
    10.4,
    white,
    3.8
  );
  y = splitBottom - 14;

  // 4 Task Cards
  const tasks = [
    {
      badge: 'GEMINI 4 NEON',
      badgeBg: cyan,
      badgeText: bgDark,
      accent: cyan,
      title: '1. Diseño Visual, UI y Muestras 4K',
      desc: 'Ajustes de letras, tarjetas compartibles, distribución de botones, colores OLED y textos.',
      why: 'Por qué: Es rápido, preciso para iterar diseño y te permite revisar varias muestras sin consumir cuota de más.'
    },
    {
      badge: 'GEMINI 4 NEON',
      badgeBg: cyan,
      badgeText: bgDark,
      accent: cyan,
      title: '2. Ajustes Puntuales y Publicación',
      desc: 'Cambios pequeños en una pantalla, subir versión, compilar .aab / .iq y dudas de Play Console.',
      why: 'Por qué: Ideal para tareas claras y acotadas donde la arquitectura base ya está construida.'
    },
    {
      badge: 'GEMINI 4 CARBON (HIGH)',
      badgeBg: gold,
      badgeText: bgDark,
      accent: gold,
      title: '3. Programación Compleja Multi-Reloj',
      desc: 'Sensores IMU/caminata, sincronización Bluetooth + Nube entre Teléfono, Wear OS, Connect IQ y watchOS.',
      why: 'Por qué: Razona mejor a través de muchos archivos y lenguajes (TypeScript, Java, Monkey C, Swift) sin perder detalles.'
    },
    {
      badge: 'GEMINI 4 CARBON (HIGH)',
      badgeBg: red,
      badgeText: white,
      accent: red,
      title: '4. Auditorías, Seguridad y Bugs Difíciles',
      desc: 'Reglas firestore.rules, sincronización offline, crashes tipo React #310 y revisión antes de lanzar.',
      why: 'Por qué: Detecta mejor casos borde, efectos secundarios entre pantallas y vulnerabilidades.'
    }
  ];

  for (const item of tasks) {
    const cardH = 122;
    const bottom = drawCard(p1, y, cardH, item.accent);
    drawPill(p1, item.badge, MARGIN + 14, y - 24, item.badgeBg, item.badgeText);
    p1.drawText(item.title, {
      x: MARGIN + 14,
      y: y - 41,
      size: 11.4,
      font: fontBold,
      color: white
    });
    const afterDesc = drawParagraph(
      p1,
      item.desc,
      MARGIN + 14,
      y - 57,
      CONTENT_W - 24,
      fontRegular,
      9.6,
      lightText,
      3.5
    );
    drawParagraph(
      p1,
      item.why,
      MARGIN + 14,
      afterDesc - 2,
      CONTENT_W - 24,
      fontBold,
      9.2,
      muted,
      3.2
    );
    y = bottom - 11;
  }

  // =========================================================================
  // PAGE 2: FLUJO DIARIO RECOMENDADO + BLINDAJE AUTOMÁTICO
  // =========================================================================
  const p2 = addMobilePage(2, 'FLUJO DIARIO');
  let y2 = PAGE_H - 60;

  p2.drawText('FLUJO DE TRABAJO DIARIO', {
    x: MARGIN,
    y: y2,
    size: 18.5,
    font: fontBold,
    color: white
  });
  y2 -= 19;
  y2 = drawParagraph(
    p2,
    'Sigue estos 3 pasos desde tu celular para avanzar rápido, cuidar tu cuota y evitar que un cambio dañe otra pantalla.',
    MARGIN,
    y2,
    CONTENT_W,
    fontRegular,
    10.2,
    lightText,
    4
  );
  y2 -= 10;

  const steps = [
    {
      num: 'PASO 1 · DÍA A DÍA (NEON)',
      accent: cyan,
      title: 'Mantén Neon por defecto',
      body: 'Úsalo para pedir cambios visuales, textos, tamaños de letra, tarjetas compartibles, dudas de Google Play y compilaciones rápidas.'
    },
    {
      num: 'PASO 2 · CAMBIOS GRANDES (CARBON HIGH)',
      accent: gold,
      title: 'Cambia a Carbon al tocar arquitectura o relojes',
      body: 'Activa Carbon (High) cuando vayas a modificar motores de sensores, sincronización en la nube, base de datos o varios módulos al mismo tiempo.'
    },
    {
      num: 'PASO 3 · ATAJOS INTELIGENTES',
      accent: red,
      title: 'Usa /plan y /boost antes de grandes lanzamientos',
      body: 'Escribe /plan para revisar el plan paso a paso antes de tocar código, o /boost cuando quieras una auditoría profunda y verificación estricta antes de subir una versión importante.'
    }
  ];

  for (const st of steps) {
    const cH = 122;
    const b = drawCard(p2, y2, cH, st.accent);
    p2.drawText(st.num, {
      x: MARGIN + 14,
      y: y2 - 20,
      size: 9.0,
      font: fontBold,
      color: st.accent
    });
    p2.drawText(st.title, {
      x: MARGIN + 14,
      y: y2 - 38,
      size: 12.0,
      font: fontBold,
      color: white
    });
    drawParagraph(
      p2,
      st.body,
      MARGIN + 14,
      y2 - 56,
      CONTENT_W - 24,
      fontRegular,
      10.1,
      lightText,
      4.0
    );
    y2 = b - 12;
  }

  // Shield Card
  y2 -= 4;
  const shieldH = 136;
  const shieldBottom = drawCard(p2, y2, shieldH, emerald);
  drawPill(p2, 'BLINDAJE ACTIVO EN EL PROYECTO', MARGIN + 14, y2 - 24, emerald, bgDark);
  p2.drawText('Candado Automático Anti-Regresiones', {
    x: MARGIN + 14,
    y: y2 - 44,
    size: 12.2,
    font: fontBold,
    color: white
  });
  drawParagraph(
    p2,
    'El proyecto ya cuenta con el candado automático (prebuild) que revisa los 93 archivos fuente y ejecuta las 33 pruebas obligatorias antes de cada compilación.',
    MARGIN + 14,
    y2 - 62,
    CONTENT_W - 24,
    fontRegular,
    10.0,
    lightText,
    4.0
  );
  drawParagraph(
    p2,
    'Así, incluso trabajando con Neon en tu rutina diaria, el sistema bloquea automáticamente cualquier error de hooks o regresión antes de publicar.',
    MARGIN + 14,
    y2 - 102,
    CONTENT_W - 24,
    fontBold,
    9.6,
    white,
    3.6
  );

  // Summary Footer Badge
  const sumY = shieldBottom - 16;
  const sumH = 54;
  drawCard(p2, sumY, sumH, cyan);
  p2.drawText('RESUMEN EN 1 LÍNEA', {
    x: MARGIN + 14,
    y: sumY - 17,
    size: 8.6,
    font: fontBold,
    color: cyan
  });
  drawParagraph(
    p2,
    'Neon (75%) = Velocidad, visual y ajustes diarios  |  Carbon High (25%) = Relojes, sensores y auditorías.',
    MARGIN + 14,
    sumY - 32,
    CONTENT_W - 24,
    fontBold,
    9.8,
    white,
    3.2
  );

  const outBytes = await pdfDoc.save();
  const outPath = path.join(__dirname, '../out/Guia-Neon-vs-Carbon-Archery101010-Movil.pdf');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, outBytes);
  console.log(`Generated mobile PDF: ${outPath} (${outBytes.length} bytes)`);
}

generateNeonCarbonMobilePdf().catch((err) => {
  console.error(err);
  process.exit(1);
});
