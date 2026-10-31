const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

async function generateAppStoreGuideMobilePdf() {
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
    p.drawText('ARCHERY 101010 · GUIA APPLE APP STORE (iOS)', {
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
  // PAGE 1: PORTADA + LAS 2 FORMAS DE TENER LA APP EN IPHONE (iOS)
  // =========================================================================
  const p1 = addMobilePage(1, 'GUIA SIMPLE PARA IPHONE Y APP STORE');
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

  p1.drawText('IPHONE Y APPLE APP STORE', {
    x: MARGIN,
    y,
    size: 18,
    font: fontBold,
    color: white
  });
  y -= 22;
  p1.drawText('COMO INSTALAR Y ACTUALIZAR EN DISPOSITIVOS APPLE', {
    x: MARGIN,
    y,
    size: 10,
    font: fontBold,
    color: gold
  });
  y -= 20;

  y = drawParagraph(
    p1,
    'Para los arqueros que usan iPhone (iOS), tienes 2 caminos muy simples: uno que ya funciona hoy mismo gratis (sin esperar a Apple) y el camino oficial de la tienda App Store.',
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
    'OPCION 1 · YA ACTIVA HOY (COSTO $0)',
    'Instalacion Directa desde Safari (Web App iOS)',
    'Cualquier usuario de iPhone entra hoy a archery101010-c0bb4.web.app en Safari -> toca Compartir -> "Agregar a pantalla de inicio". Se instala con su icono 101010 a pantalla completa y se actualiza 100% sola.',
    emerald
  );

  y = drawBulletCard(
    p1,
    y,
    'OPCION 2 · TIENDA OFICIAL APPLE APP STORE',
    'Publicacion en App Store Connect ($99 USD/ano)',
    'Para que aparezca buscando en la tienda App Store de Apple, se usa una cuenta de Apple Developer y se publica el paquete iOS (.ipa) desde la nube.',
    cyan
  );

  // =========================================================================
  // PAGE 2: COMO SE ACTUALIZA EN IPHONE SIN APP STORE (AUTOMATICO)
  // =========================================================================
  const p2 = addMobilePage(2, 'OPCION 1 · IPHONE DIRECTO (100% AUTOMATICO)');
  y = PAGE_H - 60;

  p2.drawText('1. IPHONE POR INSTALACION DIRECTA', {
    x: MARGIN,
    y,
    size: 17.5,
    font: fontBold,
    color: emerald
  });
  y -= 22;
  p2.drawText('COMO FUNCIONA HOY PARA TUS ARQUEROS CON IPHONE', {
    x: MARGIN,
    y,
    size: 10.5,
    font: fontBold,
    color: white
  });
  y -= 22;

  y = drawBulletCard(
    p2,
    y,
    'PASO 1 · COMO LA INSTALA EL ARQUERO EN IPHONE',
    '3 Toques en Safari (Toma 10 Segundos)',
    '1) Abre archery101010-c0bb4.web.app en Safari. 2) Toca el boton Compartir (cuadrito con flecha arriba). 3) Toca "Agregar a pantalla de inicio" -> "Agregar".',
    cyan
  );

  y = drawBulletCard(
    p2,
    y,
    'PASO 2 · COMO SE ACTUALIZA CADA VERSION (v2.7+)',
    '100% Automatico sin que Tu Hagas Nada',
    'En esta modalidad de iPhone, cada vez que yo subo un cambio aqui en el chat (ej. v2.7, v2.8), a todos los iPhones les aparece el boton "Nueva version lista -> Actualizar" y se actualiza en 1 segundo.',
    gold
  );

  y = drawBulletCard(
    p2,
    y,
    'PASO 3 · BOTON "CONTINUAR CON APPLE" YA LISTO',
    'Inicio de Sesion Oficial de Apple Integrado',
    'Recuerda que desde la version v2.2 ya dejamos integrado el boton "Continuar con Apple" en tu pantalla de inicio de sesion.',
    emerald
  );

  // =========================================================================
  // PAGE 3: COMO PUBLICAR EN LA TIENDA OFICIAL APPLE APP STORE
  // =========================================================================
  const p3 = addMobilePage(3, 'OPCION 2 · TIENDA OFICIAL APPLE APP STORE');
  y = PAGE_H - 60;

  p3.drawText('2. TIENDA OFICIAL APP STORE', {
    x: MARGIN,
    y,
    size: 18,
    font: fontBold,
    color: cyan
  });
  y -= 22;
  p3.drawText('QUE NECESITAS PARA ENTRAR A LA TIENDA DE APPLE', {
    x: MARGIN,
    y,
    size: 10.5,
    font: fontBold,
    color: white
  });
  y -= 22;

  y = drawBulletCard(
    p3,
    y,
    'REQUISITO 1 · CUENTA APPLE DEVELOPER',
    'Suscripcion Anual de Apple ($99 USD al ano)',
    'A diferencia de Google Play (que cobra $25 una sola vez), Apple cobra $99 USD al ano en developer.apple.com para mantener la app en su tienda.',
    gold
  );

  y = drawBulletCard(
    p3,
    y,
    'REQUISITO 2 · COMPILACION EN LA NUBE (SIN MAC)',
    'No Necesitas Comprar una Computadora Mac',
    'En vez de usar archivos .aab como Google, Apple usa archivos .ipa. Como tu codigo ya esta en GitHub, conectamos un servidor en la nube (Codemagic) que envia la version directo a tu cuenta de Apple.',
    cyan
  );

  y = drawBulletCard(
    p3,
    y,
    'REQUISITO 3 · TEXTOS E IMAGENES YA LISTOS',
    'Usas Exactamente los Mismos Textos y Fotos',
    'El mismo icono, la misma descripcion y la misma URL de privacidad que pusimos en Google Play sirven igual para Apple App Store.',
    emerald
  );

  // =========================================================================
  // PAGE 4: COMO SE SUBE CADA ACTUALIZACION EN APP STORE CONNECT
  // =========================================================================
  const p4 = addMobilePage(4, 'ACTUALIZACIONES EN APP STORE EN 3 TOQUES');
  y = PAGE_H - 60;

  p4.drawText('ACTUALIZAR EN APP STORE', {
    x: MARGIN,
    y,
    size: 18,
    font: fontBold,
    color: gold
  });
  y -= 22;
  p4.drawText('3 TOQUES DESDE TU CELULAR EN CADA VERSION NUEVA', {
    x: MARGIN,
    y,
    size: 10.5,
    font: fontBold,
    color: white
  });
  y -= 20;

  y = drawParagraph(
    p4,
    'Cuando tengas activa tu cuenta de Apple Developer, cada vez que saquemos una version nueva (ej. v2.7, v2.8), solo haces estos 3 toques desde tu telefono:',
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
    p4,
    y,
    'TOQUE 1 · ABRIR APP STORE CONNECT EN TU CELULAR',
    'Entra a appstoreconnect.apple.com',
    'Tocas tu app ARCHERY 101010 y tocas el simbolo (+) junto a "Version de iOS" para escribir el numero nuevo (ej. 2.7).',
    cyan
  );

  y = drawBulletCard(
    p4,
    y,
    'TOQUE 2 · ELEGIR LA COMPILACION EN "BUILD"',
    'No Tienes que Descargar ni Subir Archivos del Telefono',
    'En Apple el archivo ya aparece adentro en la seccion "Compilacion (Build)". Solo tocas "+ Seleccionar compilacion" y marcas la version nueva.',
    gold
  );

  y = drawBulletCard(
    p4,
    y,
    'TOQUE 3 · TOCAR "ENVIAR PARA REVISION"',
    'Apple Revisa en 24 Horas y Actualiza a Todos',
    'Tocas "Guardar" -> "Agregar para revision". En unas 24 horas Apple la aprueba y todos los iPhones se actualizan solos.',
    emerald
  );

  const pdfBytes = await pdfDoc.save();

  const artifactDir = 'C:/Users/Archery 101010/.gemini/antigravity/brain/6a327e3e-d87f-4993-ab10-ae63666eaeeb';
  const outPaths = [
    path.join(artifactDir, 'Guia_App_Store_iPhone_Archery101010_Movil.pdf'),
    path.join(rootDir, 'public', 'Guia_App_Store_iPhone_Archery101010_Movil.pdf'),
    path.join(rootDir, 'out', 'Guia_App_Store_iPhone_Archery101010_Movil.pdf'),
    path.join(rootDir, 'releases', 'Guia_App_Store_iPhone_Archery101010_Movil.pdf')
  ];

  for (const p of outPaths) {
    fs.writeFileSync(p, pdfBytes);
  }

  console.log(`✅ Generated Mobile-Screen App Store Guide PDF (${pdfBytes.length} bytes, 4 pages)`);
}

generateAppStoreGuideMobilePdf().catch((err) => {
  console.error(err);
  process.exit(1);
});
