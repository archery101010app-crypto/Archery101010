const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

async function generateSocialMediaMobilePdf() {
  const pdfDoc = await PDFDocument.create();
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // Mobile Phone Portrait Dimensions (9:17.5 aspect ratio - fills Android phone screen 100% without zooming)
  const PAGE_W = 390;
  const PAGE_H = 760;
  const MARGIN = 22;
  const CONTENT_W = PAGE_W - MARGIN * 2;
  const TOTAL_PAGES = 6;

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
    p.drawText('ARCHERY 101010 · SOCIAL MEDIA PLAYBOOK', {
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
  // PAGE 1: PORTADA + MAPA DE ENFOQUE (50% / 30% / 15% / 5%)
  // =========================================================================
  const p1 = addMobilePage(1, 'ESTRATEGIA DE REDES SOCIALES');
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

  p1.drawText('ECOSISTEMA DE REDES SOCIALES', {
    x: MARGIN,
    y,
    size: 17.5,
    font: fontBold,
    color: white
  });
  y -= 21;
  p1.drawText('ADN STRAVA + WHOOP: ENFOQUE QUIRURGICO', {
    x: MARGIN,
    y,
    size: 10.5,
    font: fontBold,
    color: gold
  });
  y -= 20;

  y = drawParagraph(
    p1,
    'Regla #1 de un Global Brand Manager: no intentes estar en todas las redes a la vez o diluiras tu energia. En el tiro con arco mundial, las descargas y el estatus se concentran en 4 canales exactos:',
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
    'CANAL #1 · 50% DE TU ENFOQUE',
    'Instagram (Estatus, Comunidad y Conversion)',
    'Es donde viven todos los arqueros olimpicos, compuestos, clubes y marcas (Hoyt, Mathews, World Archery). Es tu centro de gravedad.',
    cyan
  );

  y = drawBulletCard(
    p1,
    y,
    'CANAL #2 · 30% DE TU ENFOQUE',
    'TikTok (Motor de Descubrimiento Masivo)',
    'Alcance organico explosivo gratuito para llegar a decenas de miles de arqueros en todo el mundo aunque empieces con 0 seguidores.',
    gold
  );

  y = drawBulletCard(
    p1,
    y,
    'CANALES #3 Y #4 · 15% WHATSAPP + 5% YOUTUBE',
    'Cierre Directo en Clubes y Busqueda Tecnica',
    'WhatsApp cierra clubes enteros en 10 minutos; YouTube Shorts recicla tus videos de TikTok sin trabajo extra.',
    emerald
  );

  // =========================================================================
  // PAGE 2: RED #1 — INSTAGRAM (50% DE ENFOQUE)
  // =========================================================================
  const p2 = addMobilePage(2, 'CANAL #1 · INSTAGRAM (50% DEL ENFOQUE)');
  y = PAGE_H - 60;

  p2.drawText('1. INSTAGRAM: TU MOTOR DE ESTATUS', {
    x: MARGIN,
    y,
    size: 17.5,
    font: fontBold,
    color: cyan
  });
  y -= 22;
  p2.drawText('EL CORAZON DEL EFECTO STRAVA / WHOOP', {
    x: MARGIN,
    y,
    size: 11,
    font: fontBold,
    color: white
  });
  y -= 22;

  y = drawParagraph(
    p2,
    'En arqueria, Instagram es la vitrina oficial del atleta. Cada funcion de Instagram cumple un rol especifico para convertir seguidores en descargas reales:',
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
    'INSTAGRAM STORIES · VIRALIDAD DIARIA',
    'Tus Usuarios Son tu Equipo de Marketing',
    'Cuando un arquero sube la captura de su diana negra OLED con el poligono cian de agrupacion o su record 720 y etiqueta a @archery101010, lo reposteas en 1 toque.',
    cyan
  );

  y = drawBulletCard(
    p2,
    y,
    'INSTAGRAM REELS · ALCANCE INTERNACIONAL',
    'Demostracion Visual en 15 Segundos',
    'Reels mostrando la sincronizacion en 0ms con el entrenador y el calculo automatico de clics de mira atraen arqueros de otros paises todos los dias.',
    gold
  );

  y = drawBulletCard(
    p2,
    y,
    'MENSAJES DIRECTOS (DMs) · RECLUTAMIENTO VIP',
    'Linea Directa con Alpha Archers y Coaches',
    'Usa los DMs de Instagram para contactar a los campeones nacionales y entrenadores lideres, enviarles la T-Shirt Negra 101010 y activar su codigo de club.',
    emerald
  );

  // =========================================================================
  // PAGE 3: RED #2 — TIKTOK (30% DE ENFOQUE)
  // =========================================================================
  const p3 = addMobilePage(3, 'CANAL #2 · TIKTOK (30% DEL ENFOQUE)');
  y = PAGE_H - 60;

  p3.drawText('2. TIKTOK: DESCUBRIMIENTO MASIVO', {
    x: MARGIN,
    y,
    size: 17.5,
    font: fontBold,
    color: gold
  });
  y -= 22;
  p3.drawText('ALCANCE GLOBAL GRATUITO DESDE EL DIA 1', {
    x: MARGIN,
    y,
    size: 11,
    font: fontBold,
    color: white
  });
  y -= 22;

  y = drawParagraph(
    p3,
    'TikTok no es para gestionar comunidad; es un megafono algoritmico que muestra tu app a miles de arqueros nuevos sin importar cuantos seguidores tengas hoy.',
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
    'EL PODER HIPNOTICO DEL TIRO CON ARCO',
    'De 0 Seguidores a 100,000+ Vistas',
    'El sonido de la suelta, el vuelo de la flecha hacia el 10 y el contraste con la interfaz negra OLED de ARCHERY 101010 retienen a la audiencia desde el primer segundo.',
    gold
  );

  y = drawBulletCard(
    p3,
    y,
    'REGLA DE ORO · 1 VIDEO = 3 PLATAFORMAS',
    'Cero Trabajo Extra de Edicion',
    'El mismo video vertical (9:16) de 15 a 25 segundos que grabes para TikTok lo subes exactamente igual a Instagram Reels y a YouTube Shorts.',
    cyan
  );

  y = drawBulletCard(
    p3,
    y,
    'LLAMADO A LA ACCION (CTA) EN COMENTARIOS',
    'Fijar el Comentario con el Nombre de la App',
    'En cada TikTok deja siempre un comentario fijado arriba: "La app es gratis: ARCHERY 101010 (link directo en el perfil)".',
    red
  );

  // =========================================================================
  // PAGE 4: RED #3 Y #4 — WHATSAPP (15%) + YOUTUBE (5%)
  // =========================================================================
  const p4 = addMobilePage(4, 'CANALES #3 Y #4 · WHATSAPP Y YOUTUBE');
  y = PAGE_H - 60;

  p4.drawText('3. WHATSAPP Y YOUTUBE SHORTS', {
    x: MARGIN,
    y,
    size: 17.5,
    font: fontBold,
    color: emerald
  });
  y -= 22;
  p4.drawText('EL ARMA SECRETA DE CONVERSION EN CLUBES', {
    x: MARGIN,
    y,
    size: 11,
    font: fontBold,
    color: white
  });
  y -= 22;

  y = drawBulletCard(
    p4,
    y,
    'WHATSAPP (15%) · CIERRE DE CLUBES COMPLETOS',
    'El 100% de los Clubes se Organizan por WhatsApp',
    'En Latinoamerica, Espana y Europa, cada club y seleccion tiene su grupo de WhatsApp. Cuando el coach manda al grupo: "Descarguen ARCHERY 101010 y metan mi codigo de 6 digitos para ver el plan de esta semana", el 95% del club instala la app en 10 minutos.',
    emerald
  );

  y = drawBulletCard(
    p4,
    y,
    'ESTADOS DE WHATSAPP · PRUEBA SOCIAL CERCANA',
    'Visibilidad Directa entre Entrenadores',
    'Los entrenadores ven los Estados de WhatsApp de otros entrenadores. Una captura del panel de Coach o de la diana en sus estados genera contactos inmediatos.',
    cyan
  );

  y = drawBulletCard(
    p4,
    y,
    'YOUTUBE SHORTS + 3 TUTORIALES CORTOS (5%)',
    'Videos de 2 Minutos para Cerrar Entrenadores',
    'Sube tus mismos Reels a YouTube Shorts y deja 3 tutoriales fijos de 2 minutos: (1) Como subir un plan Excel al calendario del alumno, (2) Como usar el analisis de mira y (3) Como crear un Duelo Online.',
    gold
  );

  // =========================================================================
  // PAGE 5: DONDE NO PERDER TIEMPO
  // =========================================================================
  const p5 = addMobilePage(5, 'FILTRO DE EFICIENCIA · QUE EVITAR');
  y = PAGE_H - 60;

  p5.drawText('DONDE NO PERDER TIEMPO AHORA', {
    x: MARGIN,
    y,
    size: 17.5,
    font: fontBold,
    color: red
  });
  y -= 22;
  p5.drawText('MAXIMIZA TU RETORNO DE TIEMPO Y ENERGIA', {
    x: MARGIN,
    y,
    size: 11,
    font: fontBold,
    color: white
  });
  y -= 22;

  y = drawParagraph(
    p5,
    'Para dominar el mercado sin agotarte, descarta los canales que no convierten descargas en el deporte de tiro con arco:',
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
    p5,
    y,
    'DESCARTAR · X (TWITTER) Y THREADS',
    'Cero Intencion de Descarga en Arqueria',
    'La comunidad mundial de arqueria es 100% visual (fotos de equipo, dianas, videos de tecnica). El texto corto en X no genera instalaciones.',
    red
  );

  y = drawBulletCard(
    p5,
    y,
    'DESCARTAR · LINKEDIN',
    'Solo Util en el Futuro para Patrocinadores B2B',
    'Los arqueros y entrenadores de club no buscan apps de puntuacion ni planes de entrenamiento en LinkedIn.',
    red
  );

  y = drawBulletCard(
    p5,
    y,
    'USO PUNTUAL · GRUPOS DE FACEBOOK',
    'Solo Grupos de Compra/Venta y Federaciones',
    'No pierdas tiempo manteniendo una pagina tradicional de Facebook; solo publica enlaces directos al Torneo Mensual 101010 dentro de grupos activos de arqueria.',
    gold
  );

  // =========================================================================
  // PAGE 6: CONFIGURACION OFICIAL DE PERFILES Y RUTINA SEMANAL
  // =========================================================================
  const p6 = addMobilePage(6, 'PLANTILLA OFICIAL DE PERFIL Y RUTINA');
  y = PAGE_H - 60;

  p6.drawText('KIT DE CONFIGURACION INMEDIATA', {
    x: MARGIN,
    y,
    size: 17.5,
    font: fontBold,
    color: cyan
  });
  y -= 22;
  p6.drawText('LISTO PARA COPIAR Y PEGAR EN TUS REDES', {
    x: MARGIN,
    y,
    size: 11,
    font: fontBold,
    color: white
  });
  y -= 20;

  y = drawBulletCard(
    p6,
    y,
    '1. USUARIO UNIFICADO EN TODAS LAS REDES',
    '@archery101010 (o @archery101010app)',
    'Usa el mismo icono oficial (512x512 en fondo negro OLED) en Instagram, TikTok, YouTube y WhatsApp Business.',
    cyan
  );

  y = drawBulletCard(
    p6,
    y,
    '2. BIOGRAFIA OFICIAL ESTILO WHOOP',
    'Texto Exacto para tu Perfil de Instagram y TikTok',
    'ARCHERY 101010 | High Performance Archery Telemetry. 0ms Coach Sync · Grouping Analytics · Live Duels. Your Archery App (Android & Web): archery101010-c0bb4.web.app',
    gold
  );

  y = drawBulletCard(
    p6,
    y,
    '3. TU RUTINA SEMANAL SOSTENIBLE',
    '3 Videos por Semana + Reposteo Diario',
    'Graba 3 videos cortos en el campo con tu T-Shirt Negra 101010 -> subelos a Reels, TikTok y Shorts -> repostea a diario en Stories las dianas de tus usuarios.',
    emerald
  );

  const pdfBytes = await pdfDoc.save();

  const artifactDir = 'C:/Users/Archery 101010/.gemini/antigravity/brain/6a327e3e-d87f-4993-ab10-ae63666eaeeb';
  const outPaths = [
    path.join(artifactDir, 'Estrategia_Redes_Sociales_WHOOP_Archery101010_Movil.pdf'),
    path.join(rootDir, 'public', 'Estrategia_Redes_Sociales_WHOOP_Archery101010_Movil.pdf'),
    path.join(rootDir, 'out', 'Estrategia_Redes_Sociales_WHOOP_Archery101010_Movil.pdf'),
    path.join(rootDir, 'releases', 'Estrategia_Redes_Sociales_WHOOP_Archery101010_Movil.pdf')
  ];

  for (const p of outPaths) {
    fs.writeFileSync(p, pdfBytes);
  }

  console.log(`✅ Generated Mobile-Screen Social Media Strategy PDF (${pdfBytes.length} bytes, 6 pages)`);
}

generateSocialMediaMobilePdf().catch((err) => {
  console.error(err);
  process.exit(1);
});
