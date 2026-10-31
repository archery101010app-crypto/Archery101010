const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

async function generateWhoopPlaybookMobilePdf() {
  const pdfDoc = await PDFDocument.create();
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // Mobile Phone Portrait Dimensions (9:17.5 aspect ratio - fills Android phone screen 100% without zooming)
  const PAGE_W = 390;
  const PAGE_H = 760;
  const MARGIN = 22;
  const CONTENT_W = PAGE_W - MARGIN * 2;
  const TOTAL_PAGES = 8;

  // OLED Brand Palette
  const bgDark = rgb(0.03, 0.035, 0.05);
  const cardBg = rgb(0.07, 0.085, 0.115);
  const cardAltBg = rgb(0.09, 0.11, 0.15);
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
    p.drawText('ARCHERY 101010 · GLOBAL BRAND PLAYBOOK', {
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

  function measureParagraphHeight(text, font, size, maxWidth, lineGap = 5) {
    const lines = wrapText(text, font, size, maxWidth);
    return lines.length * (size + lineGap);
  }

  function drawParagraph(page, text, x, y, width, font, size, color, lineGap = 5) {
    const lines = wrapText(text, font, size, maxWidth = width);
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
    // Left vertical accent stripe
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
  // PAGE 1: PORTADA EJECUTIVA + FILOSOFIA WHOOP
  // =========================================================================
  const p1 = addMobilePage(1, 'ESTRATEGIA GLOBAL DE MARCA');
  let y = PAGE_H - 54;

  // Embed 101010 YOUR ARCHERY APP flat logo if available
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

  p1.drawText('PLAN MAESTRO DE VIRALIZACION', {
    x: MARGIN,
    y,
    size: 18,
    font: fontBold,
    color: white
  });
  y -= 22;
  p1.drawText('EL METODO WHOOP + STRAVA APLICADO A ARCHERY 101010', {
    x: MARGIN,
    y,
    size: 10.5,
    font: fontBold,
    color: gold
  });
  y -= 20;

  y = drawParagraph(
    p1,
    'Las apps tradicionales de tiro con arco (MyTargets, Ianseo, Archery Success) son calculadoras aburridas de los anos 2010: no tienen marca, estatus ni comunidad en vivo.',
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
    'PILAR 1 · DE HERRAMIENTA A ESTATUS',
    'El Efecto WHOOP en la Linea de Tiro',
    'WHOOP no gano por medir el pulso; gano porque convirtio los datos en un simbolo de estatus deportivo. Un arquero no "anota puntos": entrena en el ecosistema 101010.',
    cyan
  );

  y = drawBulletCard(
    p1,
    y,
    'PILAR 2 · CODIGO VISUAL OLED',
    '10 · 10 · 10 (Cian · Rojo · Oro sobre Negro)',
    'El negro puro OLED con los tres dieces en los colores oficiales de la diana World Archery funciona como insignia de pertenencia en la app y en la camiseta oficial.',
    gold
  );

  y = drawBulletCard(
    p1,
    y,
    'LA PROMESA DE MARCA EN 1 FRASE',
    '"Si tus flechas no estan en 101010, estas entrenando a ciegas."',
    'Cero latencia (0ms), telemetria de agrupacion real y conexion instantanea con tu entrenador.',
    red
  );

  // =========================================================================
  // PAGE 2: FASE 1 (DIAS 1-30) — EL CABALLO DE TROYA B2B2C (COACHES)
  // =========================================================================
  const p2 = addMobilePage(2, 'FASE 1 (DIAS 1 A 30) · CRECIMIENTO B2B2C');
  y = PAGE_H - 60;

  p2.drawText('FASE 1: EL CABALLO DE TROYA', {
    x: MARGIN,
    y,
    size: 18,
    font: fontBold,
    color: cyan
  });
  y -= 22;
  p2.drawText('CAPTURAR A LOS ENTRENADORES (CAC = $0)', {
    x: MARGIN,
    y,
    size: 11.5,
    font: fontBold,
    color: white
  });
  y -= 22;

  y = drawParagraph(
    p2,
    'En lugar de gastar miles de dolares intentando convencer a arqueros uno por uno, capturamos a los duenos de la linea de tiro: los Entrenadores. En arqueria, 1 Entrenador equivale a entre 20 y 60 arqueros cautivos.',
    MARGIN,
    y,
    CONTENT_W,
    fontRegular,
    12.5,
    lightText,
    5
  );
  y -= 12;

  y = drawBulletCard(
    p2,
    y,
    'PASO 1 · PROGRAMA FOUNDING COACHES 100',
    '100 Membresias VIP Coach PRO por 1 Ano',
    'Selecciona a 100 entrenadores clave (selecciones nacionales, clubes grandes y universidades de Latinoamerica, Espana y EE. UU.) y entregales acceso VIP directo.',
    cyan
  );

  y = drawBulletCard(
    p2,
    y,
    'PASO 2 · EL GANCHO DEL PLAN EXCEL',
    'Cargar Macrociclos en 3 Segundos',
    'Cuando el coach descubre que puede subir su Excel al calendario de sus alumnos y ver cada flecha en tiempo real (0ms), no vuelve atras jamas.',
    gold
  );

  y = drawBulletCard(
    p2,
    y,
    'PASO 3 · MULTIPLICADOR DE 6 DIGITOS',
    'De 50 Entrenadores a 2,000 Arqueros Activos',
    'El propio entrenador exige a todo su club: "Descarguen ARCHERY 101010 y vinculense con mi codigo de 6 digitos". Crecimiento explosivo sin pagar anuncios.',
    emerald
  );

  // =========================================================================
  // PAGE 3: FASE 2 (DIAS 15-45) — INGENIERIA VIRAL ESTILO STRAVA
  // =========================================================================
  const p3 = addMobilePage(3, 'FASE 2 (DIAS 15 A 45) · VIRALIDAD ORGANICA');
  y = PAGE_H - 60;

  p3.drawText('FASE 2: MOTOR VIRAL STRAVA', {
    x: MARGIN,
    y,
    size: 18,
    font: fontBold,
    color: gold
  });
  y -= 22;
  p3.drawText('TARJETAS DE TELEMETRIA COMPARTIBLES', {
    x: MARGIN,
    y,
    size: 11.5,
    font: fontBold,
    color: white
  });
  y -= 22;

  y = drawParagraph(
    p3,
    'Por que Strava y WHOOP dominan Instagram y TikTok? Porque crearon tarjetas oscuras con datos reales que los atletas presumen con orgullo justo al terminar de entrenar.',
    MARGIN,
    y,
    CONTENT_W,
    fontRegular,
    12.5,
    lightText,
    5
  );
  y -= 12;

  y = drawBulletCard(
    p3,
    y,
    'PASO 1 · EL RITUAL POST-CONTROL',
    'Presumir el Poligono Cian de Agrupacion',
    'Cuando un arquero rompe su marca en un 720 o gana una Estrella 101010, comparte su Diana Reconstruida con el poligono cian y el diametro de su grupo (cm) en Instagram Stories.',
    cyan
  );

  y = drawBulletCard(
    p3,
    y,
    'PASO 2 · CURIOSIDAD INSTANTANEA',
    'Cada Historia es un Anuncio Frente a 100 Arqueros',
    'Los seguidores de un arquero son otros arqueros. Al ver el diseno OLED y el analisis de mira en su historia, preguntan de inmediato: "Cual es esa app?".',
    gold
  );

  y = drawBulletCard(
    p3,
    y,
    'PASO 3 · RETO SEMANAL #101010GROUP',
    'Show Your Group (Muestra tu Agrupacion)',
    'Los viernes se repostearean en la cuenta oficial @archery101010 las 5 agrupaciones mas cerradas de la semana etiquetadas por arqueros de cualquier pais.',
    red
  );

  // =========================================================================
  // PAGE 4: FASE 3 (DIAS 30-60) — SEEDING FISICO Y T-SHIRT NEGRA
  // =========================================================================
  const p4 = addMobilePage(4, 'FASE 3 (DIAS 30 A 60) · INFILTRACION FISICA');
  y = PAGE_H - 60;

  p4.drawText('FASE 3: LA T-SHIRT NEGRA 101010', {
    x: MARGIN,
    y,
    size: 18,
    font: fontBold,
    color: red
  });
  y -= 22;
  p4.drawText('INFILTRACION EN TORNEOS Y LINEA DE TIRO', {
    x: MARGIN,
    y,
    size: 11.5,
    font: fontBold,
    color: white
  });
  y -= 22;

  y = drawParagraph(
    p4,
    'Asi conquisto WHOOP el PGA Tour y los CrossFit Games: antes de pagar publicidad masiva, vistieron a los atletas que todos miran en las competencias.',
    MARGIN,
    y,
    CONTENT_W,
    fontRegular,
    12.5,
    lightText,
    5
  );
  y -= 12;

  y = drawBulletCard(
    p4,
    y,
    'PASO 1 · KIT ALPHA ARCHERS',
    'Vestir a los Referentes de Cada Pais',
    'Identifica a los 3 arqueros mas admirados de cada modalidad (Recurvo, Compuesto y Barebow) y enviales la T-Shirt Negra Oficial "101010 · YOUR ARCHERY APP".',
    red
  );

  y = drawBulletCard(
    p4,
    y,
    'PASO 2 · PSICOLOGIA EN LA LINEA DE TIRO',
    'Generar FOMO (Miedo a Quedarse Fuera)',
    'En un torneo nacional, cuando los medallistas llevan la camiseta negra 101010 y anotan en su telefono entre serie y serie, toda la linea de tiro descarga la app ese mismo dia.',
    cyan
  );

  y = drawBulletCard(
    p4,
    y,
    'PASO 3 · CODIGO QR EN ETIQUETA / MANGA',
    'Conversion Fisica en 5 Segundos',
    'Un pequeno QR en los entrenamientos o en la tarjeta del embajador que lleva directo a instalar ARCHERY 101010 en Google Play y Web App.',
    gold
  );

  // =========================================================================
  // PAGE 5: FASE 4 (DIAS 30-90) — DOMINIO EN TIKTOK, REELS Y SHORTS
  // =========================================================================
  const p5 = addMobilePage(5, 'FASE 4 (DIAS 30 A 90) · ALGORITMO DE VIDEO');
  y = PAGE_H - 60;

  p5.drawText('FASE 4: TIKTOK, REELS Y SHORTS', {
    x: MARGIN,
    y,
    size: 18,
    font: fontBold,
    color: cyan
  });
  y -= 22;
  p5.drawText('3 FORMATOS VIRALES DE 15 A 25 SEGUNDOS', {
    x: MARGIN,
    y,
    size: 11.5,
    font: fontBold,
    color: white
  });
  y -= 22;

  y = drawParagraph(
    p5,
    'El tiro con arco es uno de los deportes mas hipnoticos en video vertical. Publica estos 3 formatos 4 veces por semana (sin discursos largos, directo a la accion):',
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
    p5,
    y,
    'FORMATO 1 · PANTALLA DIVIDIDA (0ms SYNC)',
    '"El Coach que Todo lo Ve en Tiempo Real"',
    'Arriba el arquero marcando su flecha a 70m; abajo el celular del coach actualizandose en 0ms. Gancho: "Cuando intentas decirle a tu coach que tiraste puro 10...".',
    cyan
  );

  y = drawBulletCard(
    p5,
    y,
    'FORMATO 2 · TELEMETRIA DE MIRA',
    '"El Ingeniero de Mira en tu Bolsillo"',
    'Muestra un grupo de 6 flechas a las 4 en punto y como la app calcula el centro exacto (+) y te indica como ajustar tu mira sin adivinar.',
    gold
  );

  y = drawBulletCard(
    p5,
    y,
    'FORMATO 3 · DUELOS MUNDIALES EN VIVO',
    '"Rete a un Arquero a 8,000 km de Distancia"',
    'Dos arqueros en distintos paises compitiendo set a set en tiempo real desde su propio campo usando el modo Duelo Online de ARCHERY 101010.',
    red
  );

  // =========================================================================
  // PAGE 6: FASE 5 (DIAS 60-120) — 101010 WORLD SERIES Y GAMIFICACION
  // =========================================================================
  const p6 = addMobilePage(6, 'FASE 5 (DIAS 60 A 120) · RETENCION GLOBAL');
  y = PAGE_H - 60;

  p6.drawText('FASE 5: 101010 WORLD SERIES', {
    x: MARGIN,
    y,
    size: 18,
    font: fontBold,
    color: gold
  });
  y -= 22;
  p6.drawText('CONVERTIR CADA CLUB EN UN ESTADIO MUNDIAL', {
    x: MARGIN,
    y,
    size: 11.5,
    font: fontBold,
    color: white
  });
  y -= 22;

  y = drawParagraph(
    p6,
    'Para lograr la mayor retencion del mundo (que abran la app todas las semanas del ano), transformamos el entrenamiento solitario en una liga global.',
    MARGIN,
    y,
    CONTENT_W,
    fontRegular,
    12.5,
    lightText,
    5
  );
  y -= 12;

  y = drawBulletCard(
    p6,
    y,
    'EVENTO MENSUAL · CONTROL GLOBAL 720',
    'El Ultimo Fin de Semana de Cada Mes',
    'Cualquier arquero del mundo tira su control de 72 flechas desde su propio club. Sus puntajes alimentan el Ranking Mundial en vivo por arco y distancia.',
    gold
  );

  y = drawBulletCard(
    p6,
    y,
    'COLECCION DE INSIGNIAS · ESTRELLAS 101010',
    'Gamificacion Adictiva Estilo Duolingo',
    'Los arqueros desbloquean niveles de Estrellas 101010 segun sus marcas en ronda 720, con barra de progreso hacia su siguiente meta de puntaje.',
    cyan
  );

  y = drawBulletCard(
    p6,
    y,
    'PREMIO DE ESTATUS',
    'T-Shirt Negra Oficial al Campeon del Mes',
    'El ganador mensual recibe la insignia dorada en su perfil y la T-Shirt Negra Oficial 101010 enviada a su pais, generando contenido real de ganadores.',
    emerald
  );

  // =========================================================================
  // PAGE 7: FASE 6 — EL MODELO DE NEGOCIO DE IMPERIO (MONOPOLIO)
  // =========================================================================
  const p7 = addMobilePage(7, 'FASE 6 · MONETIZACION Y DOMINIO DE MERCADO');
  y = PAGE_H - 60;

  p7.drawText('FASE 6: MODELO DE IMPERIO', {
    x: MARGIN,
    y,
    size: 18,
    font: fontBold,
    color: emerald
  });
  y -= 22;
  p7.drawText('POR QUE ARCHERY 101010 SECARA A LA COMPETENCIA', {
    x: MARGIN,
    y,
    size: 11,
    font: fontBold,
    color: white
  });
  y -= 22;

  y = drawBulletCard(
    p7,
    y,
    '1. GRATIS PARA EL ARQUERO (CERO FRICCION)',
    'Destruir la Barrera de Entrada',
    'Mientras otras apps cobran $5 o $10 por descargar, ARCHERY 101010 da puntuacion, diana interactiva, analisis de grupo y ranking gratis. Nadie tendra excusa para usar otra app.',
    cyan
  );

  y = drawBulletCard(
    p7,
    y,
    '2. INTELIGENCIA COMERCIAL Y ANUNCIOS B2B',
    'Tu Base de Datos Vale Oro para las Marcas',
    'Tu Panel Admin (v2.6) ya registra que marca de arco (Hoyt, Win&Win, Mathews, Gillo), libraje, edad, ciudad y volumen de flechas tiene cada arquero. Las marcas y tiendas pagaran por pautar en tu Gestor de Anuncios nativo.',
    gold
  );

  y = drawBulletCard(
    p7,
    y,
    '3. SUSCRIPCION COACH PRO + MERCHANDISING',
    'Ingresos Recurrentes de Clubes y Ropa Oficial',
    'Monetizacion limpia a traves de entrenadores/federaciones (Coach PRO) y venta de indumentaria deportiva oficial 101010.',
    emerald
  );

  // =========================================================================
  // PAGE 8: PLAN DE ACCION INMEDIATO (TUS PRIMEROS 5 PASOS ESTA SEMANA)
  // =========================================================================
  const p8 = addMobilePage(8, 'CHECKLIST DE EJECUCION INMEDIATA');
  y = PAGE_H - 60;

  p8.drawText('HOJA DE RUTA: ESTA SEMANA', {
    x: MARGIN,
    y,
    size: 18,
    font: fontBold,
    color: white
  });
  y -= 22;
  p8.drawText('5 ACCIONES CONCRETAS PARA ARRANCAR HOY', {
    x: MARGIN,
    y,
    size: 11.5,
    font: fontBold,
    color: cyan
  });
  y -= 20;

  y = drawBulletCard(
    p8,
    y,
    'ACCION 1 · PRODUCCION DE INDUMENTARIA',
    'Estampar las Primeras 15 T-Shirts Negras',
    'Usa el archivo plano de 300 DPI (101010 · YOUR ARCHERY APP) para producir el primer lote de camisetas negras para ti y los arqueros lideres.',
    cyan
  );

  y = drawBulletCard(
    p8,
    y,
    'ACCION 2 · ACTIVAR PRUEBA ABIERTA EN PLAY STORE',
    'Enlace Directo sin Pedir Correo',
    'Apenas Google apruebe la revision actual (24-72h), promover la version 40600 (2.6) a Prueba Abierta para compartir 1 link universal por WhatsApp e Instagram.',
    gold
  );

  y = drawBulletCard(
    p8,
    y,
    'ACCION 3 · RECLUTAR LOS PRIMEROS 10 COACHES',
    'Activar los Primeros 10 Clubes Completos',
    'Contactar por WhatsApp a 10 entrenadores amigos, mostrarles como sube un plan Excel en 3 segundos y pedirles que vinculen a sus alumnos con su codigo de 6 digitos.',
    emerald
  );

  y = drawBulletCard(
    p8,
    y,
    'ACCION 4 · PRIMEROS 3 REELS / TIKTOKS',
    'Publicar la Telemetria en Accion',
    'Grabar en el campo de tiro con la T-Shirt negra puesta: (1) el poligono cian de agrupacion, (2) el envio en 0ms al coach y (3) un duelo en vivo.',
    red
  );

  const pdfBytes = await pdfDoc.save();

  const artifactDir = 'C:/Users/Archery 101010/.gemini/antigravity/brain/6a327e3e-d87f-4993-ab10-ae63666eaeeb';
  const outPaths = [
    path.join(artifactDir, 'Plan_Maestro_WHOOP_Archery101010_Movil.pdf'),
    path.join(rootDir, 'public', 'Plan_Maestro_WHOOP_Archery101010_Movil.pdf'),
    path.join(rootDir, 'out', 'Plan_Maestro_WHOOP_Archery101010_Movil.pdf'),
    path.join(rootDir, 'releases', 'Plan_Maestro_WHOOP_Archery101010_Movil.pdf')
  ];

  for (const p of outPaths) {
    fs.writeFileSync(p, pdfBytes);
  }

  console.log(`✅ Generated Mobile-Screen Native PDF (${pdfBytes.length} bytes, 8 pages)`);
}

generateWhoopPlaybookMobilePdf().catch((err) => {
  console.error(err);
  process.exit(1);
});
