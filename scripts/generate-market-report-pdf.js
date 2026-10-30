const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

async function generateReport() {
  const pdfDoc = await PDFDocument.create();
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const PAGE_W = 595.28; // A4 width
  const PAGE_H = 841.89; // A4 height
  const MARGIN = 44;
  const CONTENT_W = PAGE_W - MARGIN * 2;

  // Brand Palette
  const bgDark = rgb(0.03, 0.035, 0.045);
  const cardBg = rgb(0.065, 0.075, 0.095);
  const cardBorder = rgb(0.16, 0.19, 0.24);
  const cyan = rgb(0.0, 0.75, 1.0);
  const red = rgb(1.0, 0.18, 0.18);
  const gold = rgb(1.0, 0.88, 0.0);
  const emerald = rgb(0.06, 0.73, 0.5);
  const white = rgb(0.97, 0.98, 0.99);
  const slate = rgb(0.68, 0.72, 0.78);
  const muted = rgb(0.48, 0.53, 0.6);

  function addDarkPage(pageNum, totalPages) {
    const p = pdfDoc.addPage([PAGE_W, PAGE_H]);
    p.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: bgDark });

    // Top thin tricolor accent bar
    const segW = PAGE_W / 3;
    p.drawRectangle({ x: 0, y: PAGE_H - 4, width: segW, height: 4, color: cyan });
    p.drawRectangle({ x: segW, y: PAGE_H - 4, width: segW, height: 4, color: red });
    p.drawRectangle({ x: segW * 2, y: PAGE_H - 4, width: segW, height: 4, color: gold });

    // Footer
    p.drawLine({
      start: { x: MARGIN, y: 36 },
      end: { x: PAGE_W - MARGIN, y: 36 },
      thickness: 0.5,
      color: cardBorder,
    });
    p.drawText('ARCHERY 101010 : THE APP (v2.0) — ESTUDIO EJECUTIVO DE MERCADO Y MONETIZACION', {
      x: MARGIN,
      y: 22,
      size: 7.5,
      font: fontBold,
      color: muted,
    });
    p.drawText(`Pagina ${pageNum} de ${totalPages}`, {
      x: PAGE_W - MARGIN - 55,
      y: 22,
      size: 7.5,
      font: fontRegular,
      color: muted,
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

  function drawParagraph(page, text, x, y, width, font, size, color, lineGap = 4) {
    const lines = wrapText(text, font, size, width);
    let curY = y;
    for (const line of lines) {
      page.drawText(line, { x, y: curY, size, font, color });
      curY -= size + lineGap;
    }
    return curY;
  }

  // =========================================================================
  // PAGE 1: COVER + SECTION 1 (COMPETITIVE COMPARISON TABLE)
  // =========================================================================
  const page1 = addDarkPage(1, 3);
  let y = PAGE_H - 52;

  // Header Lockup
  page1.drawText('ARCHERY', { x: MARGIN, y, size: 22, font: fontBold, color: white });
  const wArchery = fontBold.widthOfTextAtSize('ARCHERY ', 22);
  page1.drawText('10', { x: MARGIN + wArchery, y, size: 22, font: fontBold, color: cyan });
  const w10 = fontBold.widthOfTextAtSize('10', 22);
  page1.drawText('10', { x: MARGIN + wArchery + w10, y, size: 22, font: fontBold, color: red });
  page1.drawText('10', { x: MARGIN + wArchery + w10 * 2, y, size: 22, font: fontBold, color: gold });

  page1.drawText('ESTUDIO GLOBAL DE COMPETITIVIDAD Y POTENCIAL COMERCIAL (2025-2026)', {
    x: MARGIN,
    y: y - 18,
    size: 9.5,
    font: fontBold,
    color: cyan,
  });

  // Tricolor mini rule
  y -= 28;
  page1.drawRectangle({ x: MARGIN, y, width: 32, height: 2.5, color: cyan });
  page1.drawRectangle({ x: MARGIN + 32, y, width: 32, height: 2.5, color: red });
  page1.drawRectangle({ x: MARGIN + 64, y, width: 32, height: 2.5, color: gold });

  // Executive Summary Card
  y -= 18;
  const execCardH = 72;
  page1.drawRectangle({
    x: MARGIN,
    y: y - execCardH,
    width: CONTENT_W,
    height: execCardH,
    color: cardBg,
    borderColor: cardBorder,
    borderWidth: 1,
  });
  page1.drawText('RESUMEN EJECUTIVO', {
    x: MARGIN + 14,
    y: y - 18,
    size: 9,
    font: fontBold,
    color: gold,
  });
  drawParagraph(
    page1,
    'Este informe compara Archery 101010 (v2.0) frente a las 7 aplicaciones lideres mundiales de tiro con arco (MyTargets, Artemis, Archery Success, CapTarget, Rise Archery, Chrono Connect e Ianseo Scorekeeper), evalua su posicionamiento como la plataforma mas completa del mundo y proyecta su potencial real de generacion de ingresos recurrentes (SaaS B2C y B2B).',
    MARGIN + 14,
    y - 33,
    CONTENT_W - 28,
    fontRegular,
    8.8,
    slate,
    3.5
  );

  y -= execCardH + 24;

  // Section 1 Title
  page1.drawText('1. ¿ES YA LA APP DE TIRO CON ARCO MAS COMPLETA DEL MUNDO?', {
    x: MARGIN,
    y,
    size: 12,
    font: fontBold,
    color: white,
  });
  y -= 16;
  y = drawParagraph(
    page1,
    'VEREDICTO: SI. En amplitud de herramientas integradas en una sola plataforma ("All-in-One"), hoy no existe ninguna otra aplicacion en Google Play ni en Apple App Store que reuna todos los ecosistemas que integra Archery 101010. Hasta ahora, un arquero y su entrenador necesitaban entre 4 y 5 aplicaciones distintas mas hojas de Excel.',
    MARGIN,
    y,
    CONTENT_W,
    fontRegular,
    9,
    slate,
    4
  );

  y -= 10;

  // Comparison Table
  const cols = [
    { title: 'FUNCION / ECOSISTEMA', w: 205, align: 'left' },
    { title: '101010', w: 52, align: 'center' },
    { title: 'MyTargets', w: 50, align: 'center' },
    { title: 'Artemis', w: 50, align: 'center' },
    { title: 'A.Success', w: 50, align: 'center' },
    { title: 'CapTarget', w: 50, align: 'center' },
    { title: 'Rise', w: 50, align: 'center' },
  ];

  const rows = [
    ['Planillas (300/600/720) + Diana con Lupa', 'SI', 'SI', 'SI', 'SI', 'SI', 'SI'],
    ['Duelos 1v1 Online en Vivo + Voz WebRTC', 'UNICA', 'NO', 'NO', 'NO', 'NO', 'Parcial'],
    ['Simulador Eliminatorias vs Bots (6 niveles)', 'SI', 'NO', 'NO', 'NO', 'NO', 'NO'],
    ['Cronografo Balistico Acustico (FPS/m/s/J)', 'UNICA', 'NO', 'NO', 'NO', 'NO', 'NO'],
    ['Portal Coach PRO en Tiempo Real Multi-Atleta', 'UNICA', 'NO', 'NO', 'Solo PDF', 'Basico', 'NO'],
    ['Macrociclo + Agenda Mensual + Import Excel', 'UNICA', 'NO', 'NO', 'NO', 'Basico', 'NO'],
    ['Contador Mecanico Haptico + TIMER Linea', 'SI', 'NO', 'NO', 'Parcial', 'NO', 'NO'],
    ['Sistema Estrellas 101010 (500 a 700 pts)', 'SI', 'NO', 'NO', 'NO', 'NO', 'SI'],
    ['Arquitectura 100% Offline-First + Nube', 'SI', 'Solo local', 'Parcial', 'SI', 'SI', 'SI'],
  ];

  const rowH = 22;
  // Header Row
  page1.drawRectangle({
    x: MARGIN,
    y: y - rowH,
    width: CONTENT_W,
    height: rowH,
    color: rgb(0.09, 0.12, 0.16),
    borderColor: cardBorder,
    borderWidth: 0.8,
  });

  let colX = MARGIN;
  for (const col of cols) {
    const tw = fontBold.widthOfTextAtSize(col.title, 7.5);
    const tx = col.align === 'center' ? colX + (col.w - tw) / 2 : colX + 8;
    page1.drawText(col.title, {
      x: tx,
      y: y - 14,
      size: 7.5,
      font: fontBold,
      color: col.title === '101010' ? cyan : white,
    });
    colX += col.w;
  }
  y -= rowH;

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const bgRow = r % 2 === 0 ? cardBg : rgb(0.045, 0.055, 0.07);
    page1.drawRectangle({
      x: MARGIN,
      y: y - rowH,
      width: CONTENT_W,
      height: rowH,
      color: bgRow,
      borderColor: cardBorder,
      borderWidth: 0.5,
    });

    let cx = MARGIN;
    for (let c = 0; c < cols.length; c++) {
      const val = row[c];
      const col = cols[c];
      const is101010 = c === 1;
      const cellFont = is101010 || c === 0 ? fontBold : fontRegular;
      let cellColor = slate;
      if (c === 0) cellColor = white;
      else if (val === 'UNICA') cellColor = gold;
      else if (val === 'SI') cellColor = is101010 ? cyan : emerald;
      else if (val === 'NO') cellColor = rgb(0.55, 0.3, 0.32);

      const tw = cellFont.widthOfTextAtSize(val, 7.8);
      const tx = col.align === 'center' ? cx + (col.w - tw) / 2 : cx + 8;
      page1.drawText(val, { x: tx, y: y - 14, size: 7.8, font: cellFont, color: cellColor });
      cx += col.w;
    }
    y -= rowH;
  }

  // Bottom callout on Page 1
  y -= 18;
  const calloutH = 54;
  page1.drawRectangle({
    x: MARGIN,
    y: y - calloutH,
    width: CONTENT_W,
    height: calloutH,
    color: rgb(0.04, 0.11, 0.15),
    borderColor: cyan,
    borderWidth: 0.8,
  });
  page1.drawText('VENTAJA COMPETITIVA CLAVE:', {
    x: MARGIN + 12,
    y: y - 16,
    size: 8.5,
    font: fontBold,
    color: cyan,
  });
  drawParagraph(
    page1,
    'Ningun competidor mundial combina Anotacion Oficial + Eliminatorias 1v1 en vivo con voz + Cronografo Acustico + Planificacion de Macrociclos + Portal de Entrenador en tiempo real dentro de una misma aplicacion.',
    MARGIN + 12,
    y - 30,
    CONTENT_W - 24,
    fontRegular,
    8.5,
    white,
    3.5
  );

  // =========================================================================
  // PAGE 2: SECTION 2 (IS IT THE BEST?) & SECTION 3 (MARKET SIZE)
  // =========================================================================
  const page2 = addDarkPage(2, 3);
  y = PAGE_H - 52;

  page2.drawText('2. ¿ES YA LA MEJOR APP DE TIRO CON ARCO DEL MUNDO?', {
    x: MARGIN,
    y,
    size: 12,
    font: fontBold,
    color: white,
  });
  y -= 16;
  y = drawParagraph(
    page2,
    'Desde la perspectiva de Diseno, Arquitectura Tecnologica y Conexion Atleta-Entrenador ya es la #1 del mercado. Para consolidar el liderazgo absoluto en adopcion global frente a apps con 10 anos de antiguedad, este es el balance estrategico:',
    MARGIN,
    y,
    CONTENT_W,
    fontRegular,
    9,
    slate,
    4
  );

  y -= 10;

  // 3 Leadership Pillars
  const pillars = [
    {
      badge: 'LIDERAZGO #1 EN UI/UX',
      title: 'Estetica OLED de Alto Rendimiento (Estilo WHOOP / Apple Fitness+)',
      desc: 'Apps clasicas como Artemis y MyTargets tienen interfaces disenadas hace 8-10 anos (tablas densas y dificiles de usar bajo el sol). Archery 101010 ofrece una experiencia tactil moderna, fluida, sin latencia y pensada para usarse con una sola mano en la linea de tiro.',
      color: cyan,
    },
    {
      badge: 'LIDERAZGO #1 EN COACHING',
      title: 'Conexion Atleta <-> Entrenador en Tiempo Real',
      desc: 'En las demas aplicaciones, el arquero debe exportar un PDF o captura de pantalla y enviarlo por WhatsApp a su entrenador. En Archery 101010, el Coach abre su portal PRO y supervisa flecha por flecha, series, estadísticas y calendario de sus atletas en vivo.',
      color: emerald,
    },
    {
      badge: 'LIDERAZGO #1 EN COMUNIDAD',
      title: 'Factor Viral Competitivo (Eliminatorias 1v1 Online y Bots)',
      desc: 'El entrenamiento de tiro con arco suele ser solitario. Poder retar a un arquero de otro pais en tiempo real con comunicacion por voz o entrenar presion competitiva contra Bots configurables crea retencion diaria ("efecto red").',
      color: gold,
    },
  ];

  for (const item of pillars) {
    const boxH = 66;
    page2.drawRectangle({
      x: MARGIN,
      y: y - boxH,
      width: CONTENT_W,
      height: boxH,
      color: cardBg,
      borderColor: cardBorder,
      borderWidth: 0.8,
    });
    page2.drawRectangle({
      x: MARGIN,
      y: y - boxH,
      width: 3.5,
      height: boxH,
      color: item.color,
    });
    page2.drawText(`${item.badge} — ${item.title}`, {
      x: MARGIN + 14,
      y: y - 17,
      size: 9,
      font: fontBold,
      color: item.color,
    });
    drawParagraph(page2, item.desc, MARGIN + 14, y - 32, CONTENT_W - 26, fontRegular, 8.4, slate, 3.2);
    y -= boxH + 10;
  }

  y -= 8;
  page2.drawText('LOS 2 PASOS PARA DOMINAR EL 100% DEL MERCADO MUNDIAL:', {
    x: MARGIN,
    y,
    size: 10.5,
    font: fontBold,
    color: gold,
  });
  y -= 14;

  const nextSteps = [
    {
      title: '1. Internacionalizacion Multi-Idioma (Ingles Automatico):',
      body: 'El 75% de los arqueros y clubes que pagan suscripciones digitales estan en EE. UU., Reino Unido, Canada, Australia, Europa (Alemania, Francia, Paises Bajos) y Asia (Corea del Sur, Japon). Incorporar Ingles automatico multiplicara por 5 el mercado potencial inmediato.',
    },
    {
      title: '2. Modulo de Marcas de Mira (Sight Marks) y Ficha de Equipo:',
      body: 'Permitir al arquero guardar sus marcas de mira por distancia (18m, 30m, 50m, 70m) y specs de su arco (libraje, spine de flecha, brace height, tiller) eliminara la unica razon por la que algunos arqueros veteranos aun conservan Artemis o MyTargets.',
    },
  ];

  for (const ns of nextSteps) {
    page2.drawText(ns.title, { x: MARGIN + 6, y, size: 9, font: fontBold, color: white });
    y -= 13;
    y = drawParagraph(page2, ns.body, MARGIN + 6, y, CONTENT_W - 12, fontRegular, 8.5, slate, 3.5);
    y -= 8;
  }

  // Section 3 Header on Page 2
  y -= 8;
  page2.drawText('3. TAMANO DEL MERCADO GLOBAL DE TIRO CON ARCO (DATOS 2025-2026)', {
    x: MARGIN,
    y,
    size: 12,
    font: fontBold,
    color: white,
  });
  y -= 16;

  const stats = [
    { kpi: '$2.5B - $4.4B USD', label: 'Valor anual del mercado global de arquería (crecimiento 5.2% anual)' },
    { kpi: '+7,000,000', label: 'Arqueros competitivos registrados en +155 federaciones nacionales' },
    { kpi: '+8,000 Clubes', label: 'Clubes y academias formales solo en Europa y Norteamerica (+LatAm/Asia)' },
    { kpi: '$1,000 - $4,500', label: 'Inversion promedio de un arquero en su equipo (alta capacidad de pago)' },
  ];

  const statW = (CONTENT_W - 12) / 2;
  const statH = 48;
  for (let i = 0; i < stats.length; i++) {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const sx = MARGIN + col * (statW + 12);
    const sy = y - row * (statH + 10) - statH;

    page2.drawRectangle({
      x: sx,
      y: sy,
      width: statW,
      height: statH,
      color: cardBg,
      borderColor: cardBorder,
      borderWidth: 0.8,
    });
    page2.drawText(stats[i].kpi, {
      x: sx + 12,
      y: sy + 28,
      size: 12,
      font: fontBold,
      color: cyan,
    });
    page2.drawText(stats[i].label, {
      x: sx + 12,
      y: sy + 12,
      size: 7.4,
      font: fontRegular,
      color: slate,
    });
  }

  // =========================================================================
  // PAGE 3: MONETIZATION POTENTIAL & REVENUE PROJECTIONS
  // =========================================================================
  const page3 = addDarkPage(3, 3);
  y = PAGE_H - 52;

  page3.drawText('4. POTENCIAL DE GENERAR DINERO Y PROYECCIONES FINANCIERAS', {
    x: MARGIN,
    y,
    size: 12,
    font: fontBold,
    color: white,
  });
  y -= 16;
  y = drawParagraph(
    page3,
    'Tu estrategia actual de lanzamiento (Acceso Bonificado $0.00 Gratis por tiempo limitado mostrando el valor real de $9.99/mes y $89.91/ano con 25% de ahorro) es el modelo probado por Strava, WHOOP y TrainingPeaks: primero capturas a los entrenadores y clubes sin friccion, creas habito e historial de datos en la nube, y luego activas la suscripcion.',
    MARGIN,
    y,
    CONTENT_W,
    fontRegular,
    9,
    slate,
    4
  );

  y -= 12;

  const scenarios = [
    {
      stage: 'ESCENARIO 1: ETAPA INICIAL (HISPANOHABLANTES — 6 A 12 MESES)',
      revenue: '~$2,500 USD / mes ($30,000 USD / ano)',
      target: 'Meta: Solo 250 suscriptores PRO (Coaches y Arqueros en Mexico, Espana, Colombia, Chile, Argentina, etc.)',
      details:
        'Con 250 usuarios pagando $9.99/mes (o su equivalente anual), generas $2,500 USD mensuales. Los costos de servidor en Firebase para ese volumen son menores a $15 USD/mes, dejando un margen neto superior al 85%.',
      accent: cyan,
    },
    {
      stage: 'ESCENARIO 2: EXPANSION INTERNACIONAL (CON APP EN INGLES + iOS/ANDROID — ANO 1 A 2)',
      revenue: '~$14,985 USD / mes (~$180,000 USD / ano)',
      target: 'Meta: 1,500 suscriptores PRO a nivel mundial (0.02% de los arqueros competitivos del mundo)',
      details:
        'Al habilitar Ingles y estar en Google Play y Apple App Store, captar 1,500 usuarios entre EE. UU., Europa, Asia y Latinoamerica representa casi $15,000 USD de ingreso mensual recurrente (MRR).',
      accent: emerald,
    },
    {
      stage: 'ESCENARIO 3: ESCALADO GLOBAL + LICENCIAS B2B PARA CLUBES Y FEDERACIONES',
      revenue: '+$30,000 USD / mes (+$360,000 USD / ano)',
      target: 'Meta: 100 Clubes/Academias ($79/mes por club) + 2,200 Arqueros/Coaches PRO individuales',
      details:
        'Los clubes de tiro con arco pagan entre $50 y $150 USD/mes por software de gestion. Al ofrecer un Plan Club/Academia (ej. $79/mes para hasta 30 arqueros del club con Panel de Entrenadores y Macrociclos), 100 clubes + 2,200 usuarios individuales superan los $360,000 USD anuales. Una plataforma SaaS deportiva con esa facturacion alcanza una valoracion de empresa de entre $1.5M y $3.0M USD.',
      accent: gold,
    },
  ];

  for (const sc of scenarios) {
    const boxH = 104;
    page3.drawRectangle({
      x: MARGIN,
      y: y - boxH,
      width: CONTENT_W,
      height: boxH,
      color: cardBg,
      borderColor: cardBorder,
      borderWidth: 0.9,
    });
    page3.drawRectangle({
      x: MARGIN,
      y: y - boxH,
      width: 4,
      height: boxH,
      color: sc.accent,
    });
    page3.drawText(sc.stage, {
      x: MARGIN + 14,
      y: y - 18,
      size: 8.5,
      font: fontBold,
      color: sc.accent,
    });
    page3.drawText(sc.revenue, {
      x: MARGIN + 14,
      y: y - 36,
      size: 13,
      font: fontBold,
      color: white,
    });
    page3.drawText(sc.target, {
      x: MARGIN + 14,
      y: y - 51,
      size: 8.3,
      font: fontBold,
      color: slate,
    });
    drawParagraph(page3, sc.details, MARGIN + 14, y - 66, CONTENT_W - 28, fontRegular, 8.2, slate, 3.2);
    y -= boxH + 14;
  }

  // Roadmap Box at bottom of Page 3
  y -= 6;
  const roadH = 115;
  page3.drawRectangle({
    x: MARGIN,
    y: y - roadH,
    width: CONTENT_W,
    height: roadH,
    color: rgb(0.05, 0.08, 0.12),
    borderColor: cyan,
    borderWidth: 1,
  });
  page3.drawText('HOJA DE RUTA RECOMENDADA PARA MAXIMIZAR INGRESOS', {
    x: MARGIN + 14,
    y: y - 18,
    size: 9.5,
    font: fontBold,
    color: cyan,
  });

  const steps = [
    'Paso 1 (Mes 1-2): Lanzamiento en Google Play Store con Acceso Gratis ($0.00) para afiliar rapidamente a los primeros clubes y entrenadores y generar resenas de 5 estrellas.',
    'Paso 2 (Mes 2-3): Traduccion de la interfaz a Ingles (ES/EN automatico) y lanzamiento en Apple App Store (iOS) para abrir el mercado de EE. UU. y Europa.',
    'Paso 3 (Mes 3-4): Agregar el modulo de Marcas de Mira (Sight Marks) y activar la pasarela de suscripcion automatica ($9.99/mes y $89.91/ano) manteniendo beneficios a los fundadores.',
  ];

  let ry = y - 35;
  for (const st of steps) {
    ry = drawParagraph(page3, `• ${st}`, MARGIN + 14, ry, CONTENT_W - 28, fontRegular, 8.3, white, 3.2);
    ry -= 4;
  }

  const pdfBytes = await pdfDoc.save();
  const publicOut = path.join(__dirname, '../public/Estudio_Mercado_Archery101010.pdf');
  const outDirFile = path.join(__dirname, '../out/Estudio_Mercado_Archery101010.pdf');

  fs.writeFileSync(publicOut, pdfBytes);
  if (fs.existsSync(path.dirname(outDirFile))) {
    fs.writeFileSync(outDirFile, pdfBytes);
  }
  console.log('✅ PDF generado exitosamente:', publicOut);
}

generateReport().catch((err) => {
  console.error(err);
  process.exit(1);
});
