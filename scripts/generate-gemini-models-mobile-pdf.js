const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

async function generateGeminiModelsMobilePdf() {
  const pdfDoc = await PDFDocument.create();
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // Mobile Phone Portrait Dimensions (9:17.5 aspect ratio - fills Android screen 100% without zooming)
  const PAGE_W = 390;
  const PAGE_H = 760;
  const MARGIN = 22;
  const CONTENT_W = PAGE_W - MARGIN * 2;
  const TOTAL_PAGES = 2;

  // Matte OLED Brand Palette
  const bgDark = rgb(0.024, 0.031, 0.047);
  const cardBg = rgb(0.065, 0.08, 0.11);
  const cardBorder = rgb(0.18, 0.22, 0.29);
  const cyan = rgb(0.0, 0.66, 0.95);
  const red = rgb(1.0, 0.12, 0.12);
  const gold = rgb(1.0, 0.9, 0.0);
  const emerald = rgb(0.1, 0.82, 0.55);
  const white = rgb(0.98, 0.99, 1.0);
  const lightText = rgb(0.88, 0.91, 0.95);
  const muted = rgb(0.58, 0.64, 0.72);

  // Embed Official Brand Logo (Good Times ARCHERY + Geometric 101010)
  const logoPath = path.join(__dirname, '../public/images/brand_logo_header.png');
  let brandLogoImg = null;
  if (fs.existsSync(logoPath)) {
    brandLogoImg = await pdfDoc.embedPng(fs.readFileSync(logoPath));
  }

  function addMobilePage(pageNum, sectionTag) {
    const p = pdfDoc.addPage([PAGE_W, PAGE_H]);
    p.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: bgDark });

    // Top tricolor bar (Cyan | Red | Gold)
    const segW = PAGE_W / 3;
    p.drawRectangle({ x: 0, y: PAGE_H - 5, width: segW, height: 5, color: cyan });
    p.drawRectangle({ x: segW, y: PAGE_H - 5, width: segW, height: 5, color: red });
    p.drawRectangle({ x: segW * 2, y: PAGE_H - 5, width: segW, height: 5, color: gold });

    if (brandLogoImg) {
      const logoW = 148;
      const logoH = logoW * (brandLogoImg.height / brandLogoImg.width);
      p.drawImage(brandLogoImg, {
        x: MARGIN,
        y: PAGE_H - 29,
        width: logoW,
        height: logoH
      });
    } else {
      p.drawText(sectionTag, {
        x: MARGIN,
        y: PAGE_H - 26,
        size: 9.5,
        font: fontBold,
        color: cyan
      });
    }

    p.drawText(`${sectionTag}  ·  ${pageNum}/${TOTAL_PAGES}`, {
      x: PAGE_W - MARGIN - fontBold.widthOfTextAtSize(`${sectionTag}  ·  ${pageNum}/${TOTAL_PAGES}`, 8.8),
      y: PAGE_H - 25,
      size: 8.8,
      font: fontBold,
      color: muted
    });

    p.drawLine({
      start: { x: MARGIN, y: PAGE_H - 36 },
      end: { x: PAGE_W - MARGIN, y: PAGE_H - 36 },
      thickness: 0.7,
      color: cardBorder
    });

    // Bottom mobile footer bar
    p.drawLine({
      start: { x: MARGIN, y: 34 },
      end: { x: PAGE_W - MARGIN, y: 34 },
      thickness: 0.7,
      color: cardBorder
    });
    p.drawText('GUÍA RÁPIDA DE MODELOS GEMINI · FORMATO MÓVIL', {
      x: MARGIN,
      y: 18,
      size: 8.2,
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
      const width = font.widthOfTextAtSize(testLine, size);
      if (width > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine) lines.push(currentLine);
    return lines;
  }

  function drawParagraph(page, text, x, y, width, font, size, color, lineGap = 4.5) {
    const lines = wrapText(text, font, size, width);
    let curY = y;
    for (const line of lines) {
      page.drawText(line, { x, y: curY, size, font, color });
      curY -= size + lineGap;
    }
    return curY;
  }

  function drawCard(page, topY, height, accentColor = cyan, bg = cardBg) {
    const bottomY = topY - height;
    page.drawRectangle({
      x: MARGIN,
      y: bottomY,
      width: CONTENT_W,
      height,
      color: bg,
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

  // =========================================================================
  // PAGE 1: LOS 3 MODELOS PRINCIPALES GEMINI 4
  // =========================================================================
  const p1 = addMobilePage(1, 'MODELOS GEMINI 4');
  let y = PAGE_H - 60;

  p1.drawText('NUEVOS MODELOS GEMINI', {
    x: MARGIN,
    y,
    size: 19,
    font: fontBold,
    color: white
  });
  y -= 18;
  p1.drawText('Resumen puntual: para qué sirven y cuándo usar cada uno', {
    x: MARGIN,
    y,
    size: 10.5,
    font: fontBold,
    color: cyan
  });
  y -= 20;

  // Card 1: Gemini 4 Carbon
  drawCard(p1, y, 182, red);
  p1.drawText('1. GEMINI 4 CARBON', {
    x: MARGIN + 14,
    y: y - 22,
    size: 13.5,
    font: fontBold,
    color: white
  });
  p1.drawText('MÁXIMA POTENCIA · RAZONAMIENTO PROFUNDO', {
    x: MARGIN + 14,
    y: y - 37,
    size: 8.8,
    font: fontBold,
    color: red
  });
  let cy = drawParagraph(
    p1,
    'Para qué sirve: Es el modelo más potente y preciso para ingeniería compleja, arquitectura de datos, depuración difícil y compilaciones nativas sin errores.',
    MARGIN + 14,
    y - 56,
    CONTENT_W - 24,
    fontRegular,
    10.2,
    lightText
  );
  drawParagraph(
    p1,
    'Cuándo usarlo: Al tocar sincronización en la nube, algoritmos del reloj (acelerómetro/podómetro), reglas de base de datos, paquetes .aab/.iq o rediseños grandes (ideal en High).',
    MARGIN + 14,
    cy - 4,
    CONTENT_W - 24,
    fontBold,
    10.0,
    gold
  );
  y -= 196;

  // Card 2: Gemini 4 Argon
  drawCard(p1, y, 182, cyan);
  p1.drawText('2. GEMINI 4 ARGON  (USO DIARIO)', {
    x: MARGIN + 14,
    y: y - 22,
    size: 13.5,
    font: fontBold,
    color: white
  });
  p1.drawText('EQUILIBRADO · RÁPIDO + ALTA PRECISIÓN', {
    x: MARGIN + 14,
    y: y - 37,
    size: 8.8,
    font: fontBold,
    color: cyan
  });
  cy = drawParagraph(
    p1,
    'Para qué sirve: Combina excelente capacidad de programación y diseño visual con mucha mayor velocidad de respuesta que Carbon.',
    MARGIN + 14,
    y - 56,
    CONTENT_W - 24,
    fontRegular,
    10.2,
    lightText
  );
  drawParagraph(
    p1,
    'Cuándo usarlo: Tu modelo recomendado del día a día para cambios de interfaz (UI/UX), ajustes de botones y colores, crear imágenes/PDFs, textos de tienda y mejoras rápidas (Medium o High).',
    MARGIN + 14,
    cy - 4,
    CONTENT_W - 24,
    fontBold,
    10.0,
    cyan
  );
  y -= 196;

  // Card 3: Gemini 4 Hydrogen
  drawCard(p1, y, 178, gold);
  p1.drawText('3. GEMINI 4 HYDROGEN', {
    x: MARGIN + 14,
    y: y - 22,
    size: 13.5,
    font: fontBold,
    color: white
  });
  p1.drawText('ULTRALIGERO · RESPUESTA INSTANTÁNEA', {
    x: MARGIN + 14,
    y: y - 37,
    size: 8.8,
    font: fontBold,
    color: gold
  });
  cy = drawParagraph(
    p1,
    'Para qué sirve: Es el más ligero y veloz de la familia Gemini 4; consume menos cuota y responde casi al instante.',
    MARGIN + 14,
    y - 56,
    CONTENT_W - 24,
    fontRegular,
    10.2,
    lightText
  );
  drawParagraph(
    p1,
    'Cuándo usarlo: Para preguntas puntuales, guías paso a paso, traducciones, textos cortos o cambios pequeños de una sola línea (Low/Medium para rapidez; XHigh para análisis ligero).',
    MARGIN + 14,
    cy - 4,
    CONTENT_W - 24,
    fontBold,
    10.0,
    white
  );

  // =========================================================================
  // PAGE 2: MODELOS ESPECIALES Y NIVELES (LOW / MEDIUM / HIGH)
  // =========================================================================
  const p2 = addMobilePage(2, 'NIVELES Y REGLAS');
  y = PAGE_H - 60;

  p2.drawText('ESPECIALES Y NIVELES', {
    x: MARGIN,
    y,
    size: 19,
    font: fontBold,
    color: white
  });
  y -= 18;
  p2.drawText('Cuándo elegir Orchestrator, Flash y el nivel de pensamiento', {
    x: MARGIN,
    y,
    size: 10.5,
    font: fontBold,
    color: gold
  });
  y -= 20;

  // Card 4: Modelos Especiales
  drawCard(p2, y, 162, emerald);
  p2.drawText('4. MODELOS ESPECIALES', {
    x: MARGIN + 14,
    y: y - 22,
    size: 13.0,
    font: fontBold,
    color: white
  });
  cy = drawParagraph(
    p2,
    '• Orchestrator (Carbon / Argon): Úsalo únicamente cuando quieras coordinar varios subagentes trabajando en paralelo (por ejemplo, auditar y rediseñar 20 pantallas al mismo tiempo).',
    MARGIN + 14,
    y - 44,
    CONTENT_W - 24,
    fontRegular,
    10.2,
    lightText
  );
  drawParagraph(
    p2,
    '• Gemini 3.8 Flash: Generación anterior ultrarrápida; útil solo para consultas simples si deseas ahorrar cuota de Gemini 4.',
    MARGIN + 14,
    cy - 6,
    CONTENT_W - 24,
    fontRegular,
    10.2,
    lightText
  );
  y -= 178;

  // Card 5: Qué significa Low / Medium / High / XHigh
  drawCard(p2, y, 210, cyan);
  p2.drawText('5. ¿QUÉ SIGNIFICA LOW / MEDIUM / HIGH?', {
    x: MARGIN + 14,
    y: y - 22,
    size: 12.8,
    font: fontBold,
    color: cyan
  });
  p2.drawText('Controla cuánto piensa el modelo antes de responder:', {
    x: MARGIN + 14,
    y: y - 40,
    size: 10.0,
    font: fontBold,
    color: white
  });
  cy = drawParagraph(
    p2,
    '• Low (Bajo): Responde de inmediato sin detenerse a razonar largo. Ideal para preguntas rápidas o dudas puntuales.',
    MARGIN + 14,
    y - 60,
    CONTENT_W - 24,
    fontRegular,
    10.0,
    lightText
  );
  cy = drawParagraph(
    p2,
    '• Medium (Medio): Equilibrio ideal entre velocidad y análisis. Perfecto para el trabajo diario con Argon.',
    MARGIN + 14,
    cy - 5,
    CONTENT_W - 24,
    fontRegular,
    10.0,
    lightText
  );
  drawParagraph(
    p2,
    '• High / XHigh (Alto): Revisa cada detalle matemático y de código antes de actuar. Ideal para funciones delicadas o corregir errores.',
    MARGIN + 14,
    cy - 5,
    CONTENT_W - 24,
    fontRegular,
    10.0,
    gold
  );
  y -= 226;

  // Card 6: Regla de Oro Práctica
  drawCard(p2, y, 148, gold);
  p2.drawText('REGLA PRÁCTICA RECOMENDADA', {
    x: MARGIN + 14,
    y: y - 22,
    size: 12.5,
    font: fontBold,
    color: gold
  });
  cy = drawParagraph(
    p2,
    '1. Para el 80% de tus tareas diarias (ajustes visuales, preguntas, imágenes, tienda): mantén Gemini 4 Argon (Medium).',
    MARGIN + 14,
    y - 44,
    CONTENT_W - 24,
    fontBold,
    10.0,
    white
  );
  drawParagraph(
    p2,
    '2. Para cirugía pesada de código o relojes (compilaciones y algoritmos): cambia a Gemini 4 Carbon (High).',
    MARGIN + 14,
    cy - 6,
    CONTENT_W - 24,
    fontBold,
    10.0,
    cyan
  );

  const pdfBytes = await pdfDoc.save();
  const outPath = path.join(__dirname, '../public/Guia_Modelos_Gemini_Movil.pdf');
  fs.writeFileSync(outPath, pdfBytes);
  console.log(`Generated mobile PDF: ${outPath} (${pdfBytes.length} bytes)`);
}

generateGeminiModelsMobilePdf().catch((err) => {
  console.error(err);
  process.exit(1);
});
