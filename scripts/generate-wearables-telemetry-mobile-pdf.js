const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

async function generateWearablesTelemetryMobilePdf() {
  const pdfDoc = await PDFDocument.create();
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // Mobile Phone Portrait Dimensions (9:17.5 aspect ratio - fills phone screen 100% without zooming)
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
    p.drawText('ARCHERY 101010 · RELOJES Y TELEMETRIA BIOMETRICA', {
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

  function drawBulletCard(page, topY, badgeText, titleText, bodyText, accentColor = cyan) {
    const bodyWidth = CONTENT_W - 28;
    const titleLines = wrapText(titleText, fontBold, 13, bodyWidth);
    const bodyLines = wrapText(bodyText, fontRegular, 11.5, bodyWidth);
    const cardH = 24 + titleLines.length * 17 + 5 + bodyLines.length * 16 + 14;

    drawCard(page, topY, cardH, accentColor, cardBg);

    let curY = topY - 19;
    page.drawText(badgeText, {
      x: MARGIN + 14,
      y: curY,
      size: 9,
      font: fontBold,
      color: accentColor
    });
    curY -= 18;
    curY = drawParagraph(page, titleText, MARGIN + 14, curY, bodyWidth, fontBold, 13, white, 4);
    curY -= 3;
    drawParagraph(page, bodyText, MARGIN + 14, curY, bodyWidth, fontRegular, 11.5, lightText, 4.5);

    return topY - cardH - 11;
  }

  // =========================================================================
  // PAGE 1: PORTADA + RESUMEN GENERAL DE MARCAS Y FUNCIONES
  // =========================================================================
  const p1 = addMobilePage(1, 'GUIA MOVIL · SMARTWATCHES Y TELEMETRIA');
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
    y -= imgH + 16;
  }

  p1.drawText('RELOJES Y TELEMETRIA', {
    x: MARGIN,
    y,
    size: 18,
    font: fontBold,
    color: white
  });
  y -= 20;
  p1.drawText('CONTADOR DE FLECHAS, ANOTADOR Y PULSO CARDIACO', {
    x: MARGIN,
    y,
    size: 9.8,
    font: fontBold,
    color: gold
  });
  y -= 18;

  y = drawParagraph(
    p1,
    'Si sirve para otras marcas ademas de Galaxy Watch y Apple Watch. Todo depende de que funcion quieras conectar con Archery 101010:',
    MARGIN,
    y,
    CONTENT_W,
    fontRegular,
    11.8,
    lightText,
    4.5
  );
  y -= 8;

  y = drawBulletCard(
    p1,
    y,
    '1 · RITMO CARDIACO EN TELEMETRIA (SIN APP EXTRA)',
    'Garmin, Amazfit, Polar, Coros, Huawei y Bandas',
    'NO requieren crear ni instalar otra app en el reloj. Transmiten las pulsaciones (BPM) por Bluetooth directo a Archery 101010 en el celular.',
    emerald
  );

  y = drawBulletCard(
    p1,
    y,
    '2 · CONTADOR 100% AUTOMATICO POR MOVIMIENTO',
    'Galaxy Watch, Apple Watch, Garmin y Amazfit',
    'Estos 4 sistemas permiten leer el giroscopio de la muneca al soltar la cuerda para sumar +1 flecha automaticamente y anotar desde el reloj.',
    cyan
  );

  // =========================================================================
  // PAGE 2: TELEMETRIA CARDIACA EN VIVO (SIN APP APARTE)
  // =========================================================================
  const p2 = addMobilePage(2, 'PULSO CARDIACO EN TELEMETRIA (SIN APP EXTRA)');
  y = PAGE_H - 58;

  p2.drawText('1. PULSO CARDIACO EN VIVO', {
    x: MARGIN,
    y,
    size: 17.5,
    font: fontBold,
    color: emerald
  });
  y -= 20;
  p2.drawText('GARMIN, AMAZFIT, POLAR, COROS Y HUAWEI SIN APP APARTE', {
    x: MARGIN,
    y,
    size: 9.5,
    font: fontBold,
    color: white
  });
  y -= 20;

  y = drawBulletCard(
    p2,
    y,
    'COMO SE CONECTA · PROTOCOLO BLUETOOTH BLE',
    'Funcion "Transmitir Frecuencia Cardiaca"',
    'Los relojes Garmin, Amazfit, Polar, Coros y Huawei ya traen de fabrica la opcion "Transmitir FC" por Bluetooth. El arquero la activa y toca "Conectar Sensor" en Archery 101010 sin instalar nada en el reloj.',
    emerald
  );

  y = drawBulletCard(
    p2,
    y,
    'TELEMETRIA POR FLECHA · DATOS PARA EL ARQUERO',
    'Pulsaciones Exactas en Cada Disparo (BPM)',
    'Archery 101010 guarda a cuantas pulsaciones por minuto (BPM) estaba el arquero en el instante exacto en que disparo o anoto cada flecha (ej. "Disparaste este 10 a 92 BPM y este 7 a 128 BPM").',
    cyan
  );

  y = drawBulletCard(
    p2,
    y,
    'PORTAL DEL COACH · CONTROL BAJO PRESION',
    'Grafica de Pulso vs. Puntaje y Volumen',
    'El Coach ve en su portal la curva cardiaca de cada tanda junto a la diana reconstruida, detectando si el alumno pierde precision cuando se acelera su pulso.',
    gold
  );

  // =========================================================================
  // PAGE 3: GARMIN, AMAZFIT Y PULSERAS ECONOMICAS (CONTADOR)
  // =========================================================================
  const p3 = addMobilePage(3, 'GARMIN, AMAZFIT Y PULSERAS (CONTADOR)');
  y = PAGE_H - 58;

  p3.drawText('2. CONTADOR EN OTRAS MARCAS', {
    x: MARGIN,
    y,
    size: 17.5,
    font: fontBold,
    color: cyan
  });
  y -= 20;
  p3.drawText('CUANDO SI LLEVA MINI-APP Y TRUCO PARA PULSERAS', {
    x: MARGIN,
    y,
    size: 9.5,
    font: fontBold,
    color: white
  });
  y -= 20;

  y = drawBulletCard(
    p3,
    y,
    'GARMIN (CONNECT IQ) Y AMAZFIT (ZEPP OS)',
    'Mini-App en el Reloj para Movimiento y Anotador',
    'Si quieres que un Garmin o Amazfit cuente flechas solo al detectar el impacto de la suelta en la muneca o permita anotar puntajes (X, 10, 9) en la pantalla del reloj, ahi SI se crea una mini-app en la tienda de Garmin/Zepp que se conecta con el telefono.',
    cyan
  );

  y = drawBulletCard(
    p3,
    y,
    'PULSERAS CERRADAS · HUAWEI, XIAOMI MI BAND, HONOR',
    'Modo "Toque en Muneca" Universal (Sin App)',
    'Las pulseras basicas no dejan instalar apps, pero todas traen boton de "Control de Musica / Camara Bluetooth". Programamos Archery 101010 para que tocar ese boton en la muneca sume +1 flecha con sonido/vibracion.',
    gold
  );

  y = drawBulletCard(
    p3,
    y,
    'COMPATIBILIDAD CON ANDROID Y IPHONE',
    'Funciona en Ambos Telefonos por Bluetooth',
    'Tanto Garmin como Amazfit y las pulseras Bluetooth funcionan igual si el arquero tiene telefono Android o iPhone.',
    emerald
  );

  // =========================================================================
  // PAGE 4: GALAXY WATCH, APPLE WATCH Y PLAN DE 3 FASES
  // =========================================================================
  const p4 = addMobilePage(4, 'GALAXY WATCH, APPLE WATCH Y HOJA DE RUTA');
  y = PAGE_H - 58;

  p4.drawText('3. GALAXY, APPLE Y PLAN IDEAL', {
    x: MARGIN,
    y,
    size: 17.5,
    font: fontBold,
    color: gold
  });
  y -= 20;
  p4.drawText('COMO FUNCIONAN Y ORDEN RECOMENDADO DE DESARROLLO', {
    x: MARGIN,
    y,
    size: 9.5,
    font: fontBold,
    color: white
  });
  y -= 20;

  y = drawBulletCard(
    p4,
    y,
    'GALAXY WATCH (WEAR OS) Y APPLE WATCH (WATCHOS)',
    'Integracion Todo-en-Uno Automatica',
    'Al instalar Archery 101010 en el celular, el reloj instala su modulo companero. Al entrenar hace las 3 cosas a la vez: 1) Manda pulso BPM en vivo, 2) Cuenta cada flecha por movimiento del disparo (vibrando suave), y 3) Permite anotar puntajes en la muneca.',
    cyan
  );

  y = drawBulletCard(
    p4,
    y,
    'FASE 1 RECOMENDADA · DIRECTO EN NUESTRA APP',
    'Conectar Pulso Bluetooth BLE + Salud + Boton Muneca',
    'Se programa solo dentro de nuestra app actual del telefono. Te da telemetria cardiaca por flecha en Garmin, Amazfit, Polar, Huawei, Galaxy y Apple desde el dia 1 sin programar apps de reloj.',
    emerald
  );

  y = drawBulletCard(
    p4,
    y,
    'FASE 2 Y FASE 3 · APPS NATIVAS DE RELOJ',
    'Wear OS / Apple Watch -> Luego Garmin y Amazfit',
    'En Fase 2 se agrega el contador automatico por giroscopio y anotador en Galaxy Watch y Apple Watch; y en Fase 3 el conector para relojes Garmin y Amazfit.',
    gold
  );

  const pdfBytes = await pdfDoc.save();

  const artifactDir = 'C:/Users/Archery 101010/.gemini/antigravity/brain/6a327e3e-d87f-4993-ab10-ae63666eaeeb';
  const fileName = 'Guia_Relojes_Telemetria_Archery101010_Movil.pdf';
  const outPaths = [
    path.join(artifactDir, fileName),
    path.join(rootDir, 'public', fileName),
    path.join(rootDir, 'out', fileName),
    path.join(rootDir, 'releases', fileName)
  ];

  for (const p of outPaths) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, pdfBytes);
  }

  console.log(`✅ Generated Mobile-Screen Wearables & Telemetry Guide PDF (${pdfBytes.length} bytes, 4 pages)`);
}

generateWearablesTelemetryMobilePdf().catch((err) => {
  console.error(err);
  process.exit(1);
});
