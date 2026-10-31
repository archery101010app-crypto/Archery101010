const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

async function generateUpdateGuideMobilePdf() {
  const pdfDoc = await PDFDocument.create();
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // Mobile Phone Portrait Dimensions (9:17.5 aspect ratio - fills Android phone screen 100% without zooming)
  const PAGE_W = 390;
  const PAGE_H = 760;
  const MARGIN = 22;
  const CONTENT_W = PAGE_W - MARGIN * 2;
  const TOTAL_PAGES = 4;

  // OLED Brand Palette
  const bgDark = rgb(0.03, 0.035, 0.05);
  const cardBg = rgb(0.07, 0.085, 0.115);
  const cardBorder = rgb(0.18, 0.22, 0.29);
  const cyan = rgb(0.0, 0.78, 1.0);
  const red = rgb(1.0, 0.18, 0.22);
  const gold = rgb(1.0, 0.88, 0.0);
  const emerald = rgb(0.1, 0.82, 0.55);
  const white = rgb(0.98, 0.99, 1.0);
  const lightText = rgb(0.88, 0.91, 0.95);
  const muted = rgb(0.55, 0.61, 0.69);

  function addMobilePage(pageNum, sectionTag) {
    const p = pdfDoc.addPage([PAGE_W, PAGE_H]);
    p.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: bgDark });

    // Top tricolor bar (Cyan | Red | Gold)
    const segW = PAGE_W / 3;
    p.drawRectangle({ x: 0, y: PAGE_H - 5, width: segW, height: 5, color: cyan });
    p.drawRectangle({ x: segW, y: PAGE_H - 5, width: segW, height: 5, color: red });
    p.drawRectangle({ x: segW * 2, y: PAGE_H - 5, width: segW, height: 5, color: gold });

    // Top mobile status header
    p.drawText(sectionTag, {
      x: MARGIN,
      y: PAGE_H - 26,
      size: 9.5,
      font: fontBold,
      color: cyan
    });
    p.drawText(`${pageNum} / ${TOTAL_PAGES}`, {
      x: PAGE_W - MARGIN - 28,
      y: PAGE_H - 26,
      size: 9.5,
      font: fontBold,
      color: muted
    });
    p.drawLine({
      start: { x: MARGIN, y: PAGE_H - 34 },
      end: { x: PAGE_W - MARGIN, y: PAGE_H - 34 },
      thickness: 0.6,
      color: cardBorder
    });

    // Bottom mobile footer bar
    p.drawLine({
      start: { x: MARGIN, y: 34 },
      end: { x: PAGE_W - MARGIN, y: 34 },
      thickness: 0.6,
      color: cardBorder
    });
    p.drawText('ARCHERY 101010 · MANUAL DE ACTUALIZACIONES', {
      x: MARGIN,
      y: 18,
      size: 8.5,
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

  function drawParagraph(page, text, x, y, width, font, size, color, lineGap = 5) {
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

  function drawBulletCard(page, topY, badgeText, titleText, bodyText, accentColor = cyan) {
    const bodyWidth = CONTENT_W - 30;
    const titleLines = wrapText(titleText, fontBold, 13.5, bodyWidth);
    const bodyLines = wrapText(bodyText, fontRegular, 12, bodyWidth);
    const cardH = 26 + titleLines.length * 18 + 6 + bodyLines.length * 17 + 16;

    drawCard(page, topY, cardH, accentColor, cardBg);

    let curY = topY - 20;
    page.drawText(badgeText, {
      x: MARGIN + 14,
      y: curY,
      size: 9.5,
      font: fontBold,
      color: accentColor
    });
    curY -= 19;
    curY = drawParagraph(page, titleText, MARGIN + 14, curY, bodyWidth, fontBold, 13.5, white, 4.5);
    curY -= 4;
    drawParagraph(page, bodyText, MARGIN + 14, curY, bodyWidth, fontRegular, 12, lightText, 5);

    return topY - cardH - 12;
  }

  // =========================================================================
  // PAGE 1: PORTADA + COMO FUNCIONAN LAS ACTUALIZACIONES AHORA
  // =========================================================================
  const p1 = addMobilePage(1, 'GUIA RAPIDA DE ACTUALIZACIONES');
  let y = PAGE_H - 54;

  const rootDir = path.resolve(__dirname, '..');
  const logoPath = path.join(rootDir, 'public', 'archery101010-serigrafia-negro.png');
  if (fs.existsSync(logoPath)) {
    const logoBytes = fs.readFileSync(logoPath);
    const logoImg = await pdfDoc.embedPng(logoBytes);
    const imgW = CONTENT_W;
    const imgH = Math.round(imgW * (logoImg.height / logoImg.width));
    p1.drawImage(logoImg, {
      x: MARGIN,
      y: y - imgH,
      width: imgW,
      height: imgH
    });
    y -= imgH + 18;
  }

  p1.drawText('COMO ACTUALIZAR TU APP', {
    x: MARGIN,
    y,
    size: 18,
    font: fontBold,
    color: white
  });
  y -= 22;
  p1.drawText('GUIA PASO A PASO MUY SIMPLE PARA TU CELULAR', {
    x: MARGIN,
    y,
    size: 10.5,
    font: fontBold,
    color: gold
  });
  y -= 20;

  y = drawParagraph(
    p1,
    'A partir de la version v2.7, tu app tiene integrado un Detector Automatico de Nueva Version. Asi sabes exactamente que pasa cada vez que hacemos un cambio:',
    MARGIN,
    y,
    CONTENT_W,
    fontRegular,
    12.5,
    lightText,
    5
  );
  y -= 10;

  y = drawBulletCard(
    p1,
    y,
    '1. CAMBIOS DE DATOS Y ANUNCIOS (0 SEGUNDOS)',
    'Se Actualizan 100% Solos al Instante',
    'Anuncios del Panel Admin, rankings, planes Excel, puntajes y alumnos se actualizan solos en todos los telefonos sin subir nada a Google Play.',
    emerald
  );

  y = drawBulletCard(
    p1,
    y,
    '2. CAMBIOS DE DISENO O BOTONES NUEVOS',
    'Detector Automatico Integrado en la App',
    'Cuando creamos una funcion nueva (ej. v2.7, v2.8), la app detecta sola la nueva version y muestra arriba el boton: "Nueva version lista -> Actualizar".',
    cyan
  );

  // =========================================================================
  // PAGE 2: QUE HACES TU CUANDO HACEMOS UN CAMBIO EN EL CHAT
  // =========================================================================
  const p2 = addMobilePage(2, 'DIA A DIA · QUE HACER EN CADA CAMBIO');
  y = PAGE_H - 60;

  p2.drawText('QUE HACES EN CADA CAMBIO', {
    x: MARGIN,
    y,
    size: 18,
    font: fontBold,
    color: cyan
  });
  y -= 22;
  p2.drawText('FLUJO DE 3 PASOS DESDE TU CELULAR', {
    x: MARGIN,
    y,
    size: 11.5,
    font: fontBold,
    color: white
  });
  y -= 22;

  y = drawBulletCard(
    p2,
    y,
    'PASO 1 · TU ME PIDES EL CAMBIO EN EL CHAT',
    'Explicame lo que Quieres Agregar o Mejorar',
    'Ejemplo: "Cambia el color de este boton" o "Agrega una funcion nueva para el entrenador". Tu no tienes que tocar codigo ni configuraciones.',
    cyan
  );

  y = drawBulletCard(
    p2,
    y,
    'PASO 2 · YO HAGO TODO EL TRABAJO AUTOMATICO',
    'Sube de Version (+0.1) y Activa el Aviso',
    'Yo subo la version (ej. de 2.6 a 2.7), actualizo la Web, genero el archivo .apk y el archivo .aab nuevo, y activo el aviso automatico dentro de la app.',
    gold
  );

  y = drawBulletCard(
    p2,
    y,
    'PASO 3 · PRUEBAS EL CAMBIO EN TU TELEFONO',
    'Con 1 Toque desde el Aviso o Link Directo',
    'Abres tu app (o tocas el link .apk que te doy en el chat) y pruebas el cambio al instante. No necesitas subir a Google Play cada pequeno ajuste.',
    emerald
  );

  // =========================================================================
  // PAGE 3: COMO SUBIR LA ACTUALIZACION A GOOGLE PLAY EN 30 SEGUNDOS
  // =========================================================================
  const p3 = addMobilePage(3, 'GOOGLE PLAY · SUBIR VERSION EN 30 SEGUNDOS');
  y = PAGE_H - 60;

  p3.drawText('ACTUALIZAR EN GOOGLE PLAY', {
    x: MARGIN,
    y,
    size: 18,
    font: fontBold,
    color: gold
  });
  y -= 22;
  p3.drawText('SOLO 4 TOQUES (CERO CUESTIONARIOS)', {
    x: MARGIN,
    y,
    size: 11.5,
    font: fontBold,
    color: white
  });
  y -= 20;

  y = drawParagraph(
    p3,
    'Cuando ya tengamos listas una o varias mejoras que quieras dejar fijas en la tienda oficial de Google Play, solo haces estos 4 toques desde tu celular:',
    MARGIN,
    y,
    CONTENT_W,
    fontRegular,
    12.5,
    lightText,
    5
  );
  y -= 10;

  y = drawBulletCard(
    p3,
    y,
    'TOQUE 1 · DESCARGAR EL ARCHIVO .AAB NUEVO',
    'Toca el Link .aab que Yo te Doy en el Chat',
    'Se descargara en tu carpeta de Descargas del telefono (por ejemplo: Archery101010-v2.7.aab).',
    cyan
  );

  y = drawBulletCard(
    p3,
    y,
    'TOQUE 2 · ENTRAR A TU PISTA EN PLAY CONSOLE',
    'Menu -> Pruebas -> Prueba cerrada (o Produccion)',
    'Entras a Google Play Console en tu celular y tocas el boton azul "Crear version nueva" arriba a la derecha.',
    gold
  );

  y = drawBulletCard(
    p3,
    y,
    'TOQUE 3 Y 4 · SUBIR EL .AAB Y PUBLICAR',
    'Toca "Subir" -> "Siguiente" -> "Guardar"',
    'Eliges el archivo .aab de tus Descargas, tocas Siguiente y luego Guardar / Enviar a revision. Listo en 30 segundos!',
    emerald
  );

  // =========================================================================
  // PAGE 4: PREGUNTAS FRECUENTES PARA TU TRANQUILIDAD
  // =========================================================================
  const p4 = addMobilePage(4, 'PREGUNTAS FRECUENTES CLAVE');
  y = PAGE_H - 60;

  p4.drawText('LO QUE DEBES SABER SIEMPRE', {
    x: MARGIN,
    y,
    size: 18,
    font: fontBold,
    color: white
  });
  y -= 22;
  p4.drawText('3 REGLAS DE ORO PARA TU TRANQUILIDAD', {
    x: MARGIN,
    y,
    size: 11.5,
    font: fontBold,
    color: cyan
  });
  y -= 22;

  y = drawBulletCard(
    p4,
    y,
    'REGLA 1 · CERO CUESTIONARIOS NUNCA MAS',
    'Los 15 Cuestionarios Solo se Llenan 1 Vez en la Vida',
    'Ya quedaron aprobados y guardados en tu cuenta. En las futuras actualizaciones (v2.7, v2.8, v3.0) solo se sube el archivo .aab directo.',
    emerald
  );

  y = drawBulletCard(
    p4,
    y,
    'REGLA 2 · LOS DATOS DE LOS ARQUEROS NO SE BORRAN',
    'Todo Esta Seguro en la Nube (Firestore) e IndexedDB',
    'Cuando un arquero actualiza la app de una version a otra, conserva intactos su perfil, sus arcos, sus sesiones, sus estrellas y su club.',
    cyan
  );

  y = drawBulletCard(
    p4,
    y,
    'REGLA 3 · AVISO AUTOMATICO EN PANTALLA',
    'Nadie se Queda con una Version Vieja',
    'Gracias al nuevo detector automatico (v2.7), apenas publiquemos un cambio aqui, los telefonos veran la barra superior "Nueva version lista -> Actualizar".',
    gold
  );

  const pdfBytes = await pdfDoc.save();

  const artifactDir = 'C:/Users/Archery 101010/.gemini/antigravity/brain/6a327e3e-d87f-4993-ab10-ae63666eaeeb';
  const outPaths = [
    path.join(artifactDir, 'Guia_Actualizaciones_Archery101010_Movil.pdf'),
    path.join(rootDir, 'public', 'Guia_Actualizaciones_Archery101010_Movil.pdf'),
    path.join(rootDir, 'out', 'Guia_Actualizaciones_Archery101010_Movil.pdf'),
    path.join(rootDir, 'releases', 'Guia_Actualizaciones_Archery101010_Movil.pdf')
  ];

  for (const p of outPaths) {
    fs.writeFileSync(p, pdfBytes);
  }

  console.log(`✅ Generated Mobile-Screen Update Guide PDF (${pdfBytes.length} bytes, 4 pages)`);
}

generateUpdateGuideMobilePdf().catch((err) => {
  console.error(err);
  process.exit(1);
});
