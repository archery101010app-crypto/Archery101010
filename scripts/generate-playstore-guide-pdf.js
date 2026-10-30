const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

async function generatePlayStoreGuidePdf() {
  const pdfDoc = await PDFDocument.create();
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const PAGE_W = 595.28; // A4 Vertical Width
  const PAGE_H = 841.89; // A4 Vertical Height
  const MARGIN = 40;
  const CONTENT_W = PAGE_W - MARGIN * 2;

  // Brand Palette (OLED Carbon-Black)
  const bgDark = rgb(0.03, 0.035, 0.045);
  const cardBg = rgb(0.065, 0.075, 0.095);
  const cardBorder = rgb(0.16, 0.19, 0.24);
  const cyan = rgb(0.0, 0.75, 1.0);
  const red = rgb(1.0, 0.18, 0.18);
  const gold = rgb(1.0, 0.88, 0.0);
  const emerald = rgb(0.06, 0.73, 0.5);
  const white = rgb(0.97, 0.98, 0.99);
  const slate = rgb(0.76, 0.8, 0.86);
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
      start: { x: MARGIN, y: 34 },
      end: { x: PAGE_W - MARGIN, y: 34 },
      thickness: 0.5,
      color: cardBorder,
    });
    p.drawText('ARCHERY 101010 : THE APP (v2.5) — GUIA PASO A PASO GOOGLE PLAY CONSOLE', {
      x: MARGIN,
      y: 20,
      size: 7.5,
      font: fontBold,
      color: muted,
    });
    p.drawText(`Pagina ${pageNum} de ${totalPages}`, {
      x: PAGE_W - MARGIN - 55,
      y: 20,
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

  function drawParagraph(page, text, x, y, width, font, size, color, lineGap = 3.5) {
    const lines = wrapText(text, font, size, width);
    let curY = y;
    for (const line of lines) {
      page.drawText(line, { x, y: curY, size, font, color });
      curY -= size + lineGap;
    }
    return curY;
  }

  function drawFieldRow(page, y, label, value, valueColor = cyan) {
    page.drawText(label, { x: MARGIN + 12, y, size: 8.8, font: fontBold, color: slate });
    page.drawText(value, { x: MARGIN + 195, y, size: 9.2, font: fontBold, color: valueColor });
    return y - 16;
  }

  // =========================================================================
  // PAGE 1: DATOS TECNICOS DEL PAQUETE + TEXTOS DE LA FICHA DE PLAY STORE
  // =========================================================================
  const page1 = addDarkPage(1, 2);
  let y = PAGE_H - 48;

  // Header Lockup
  page1.drawText('ARCHERY', { x: MARGIN, y, size: 21, font: fontBold, color: white });
  const wArchery = fontBold.widthOfTextAtSize('ARCHERY ', 21);
  page1.drawText('10', { x: MARGIN + wArchery, y, size: 21, font: fontBold, color: cyan });
  const w10 = fontBold.widthOfTextAtSize('10', 21);
  page1.drawText('10', { x: MARGIN + wArchery + w10, y, size: 21, font: fontBold, color: red });
  page1.drawText('10', { x: MARGIN + wArchery + w10 * 2, y, size: 21, font: fontBold, color: gold });

  page1.drawText('GUIA PRACTICA PARA PUBLICAR EN GOOGLE PLAY CONSOLE', {
    x: MARGIN,
    y: y - 16,
    size: 9,
    font: fontBold,
    color: cyan,
  });

  page1.drawText('RESPUESTAS EXACTAS PASO A PASO (COPIAR Y PEGAR)', {
    x: MARGIN,
    y: y - 32,
    size: 13,
    font: fontBold,
    color: white,
  });

  y -= 48;
  page1.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE_W - MARGIN, y },
    thickness: 0.75,
    color: cardBorder,
  });

  y -= 18;

  // PASO 1: DATOS TECNICOS DEL PAQUETE Y ENLACES
  page1.drawText('PASO 1. DATOS TECNICOS DEL PAQUETE Y ENLACES OFICIALES', {
    x: MARGIN,
    y,
    size: 10.5,
    font: fontBold,
    color: gold,
  });
  y -= 12;

  const box1H = 175;
  page1.drawRectangle({
    x: MARGIN,
    y: y - box1H,
    width: CONTENT_W,
    height: box1H,
    color: cardBg,
    borderColor: cyan,
    borderWidth: 0.9,
  });

  let ry = y - 18;
  ry = drawFieldRow(page1, ry, 'Nombre del Paquete (Package ID):', 'com.archery101010.app', emerald);
  ry = drawFieldRow(page1, ry, 'Nombre de la Aplicacion (30 car.):', 'Archery 101010: Tiro con Arco', white);
  ry = drawFieldRow(page1, ry, 'Idioma Predeterminado:', 'Espanol (Latinoamerica) - es-419', cyan);
  ry = drawFieldRow(page1, ry, 'Aplicacion o Juego / Tipo:', 'Aplicacion  |  Gratis (Free)', white);
  ry = drawFieldRow(page1, ry, 'Categoria en Play Store:', 'Deportes (Sports)', gold);
  ry = drawFieldRow(page1, ry, 'Correo Electronico de Contacto:', 'info@archery101010.com', white);
  ry = drawFieldRow(page1, ry, 'Sitio Web Oficial:', 'https://archery101010-c0bb4.web.app', cyan);
  ry = drawFieldRow(page1, ry, 'URL Politica de Privacidad:', 'https://archery101010-c0bb4.web.app/privacy', cyan);
  ry = drawFieldRow(
    page1,
    ry,
    'URL Eliminacion de Cuenta:',
    'https://archery101010-c0bb4.web.app/privacy#delete-account',
    emerald
  );

  y -= box1H + 18;

  // PASO 2: TEXTOS DE LA FICHA DE PLAY STORE
  page1.drawText('PASO 2. TEXTOS DE LA FICHA PRINCIPAL DE PLAY STORE', {
    x: MARGIN,
    y,
    size: 10.5,
    font: fontBold,
    color: gold,
  });
  y -= 12;

  const box2H = 315;
  page1.drawRectangle({
    x: MARGIN,
    y: y - box2H,
    width: CONTENT_W,
    height: box2H,
    color: cardBg,
    borderColor: cardBorder,
    borderWidth: 0.9,
  });

  let ty = y - 18;
  page1.drawText('DESCRIPCION BREVE (Max. 80 caracteres):', {
    x: MARGIN + 12,
    y: ty,
    size: 9,
    font: fontBold,
    color: cyan,
  });
  ty -= 14;
  page1.drawText('App para arqueros y coach: diana, duelos, cronografo, planificacion y mas!', {
    x: MARGIN + 12,
    y: ty,
    size: 9.2,
    font: fontBold,
    color: white,
  });

  ty -= 20;
  page1.drawText('DESCRIPCION COMPLETA (Copiar y pegar en Ficha de Play Store):', {
    x: MARGIN + 12,
    y: ty,
    size: 9,
    font: fontBold,
    color: cyan,
  });
  ty -= 14;

  const descBlocks = [
    'Archery 101010 es la aplicacion integral para arqueros, entrenadores y clubes de tiro con arco: planificacion deportiva, registro de anotaciones en diana oficial, duelos eliminatorios 1v1 en linea, cronografo balistico acustico y seguimiento de estrellas World Archery.',
    '• Planillas y Dianas Oficiales (WA 300, WA 600, WA 720, Indoor 18m y Practica Libre): Registra tus flechas mediante teclado rapido o marcando impactos directamente sobre la diana interactiva con analisis de agrupacion y dispersion.',
    '• Reloj de Tiro Oficial (Timer): Secuencias configurables AB/CD con alertas sonoras oficiales y pantalla siempre encendida.',
    '• Eliminatoria Online 1 vs 1 y Bots: Compite en tiempo real en sistema de Sets (Recurvo/Barebow) o Acumulado (Compuesto) con comunicacion por voz opcional en directo.',
    '• Cronografo Balistico Acustico: Calcula la velocidad estimada de tus flechas (FPS), energia cinetica (KE) y FOC utilizando el microfono de tu telefono.',
    '• Sistema de Estrellas 101010 (WA 720): Desbloquea insignias oficiales de rendimiento desde 100 hasta 700 puntos segun tu distancia y tipo de arco.',
    '• Portal para Entrenadores y Clubes: Gestiona tus atletas, asigna planes de entrenamiento y macrociclos en una agenda mensual estilo calendario y monitorea sus puntajes en tiempo real.',
    '• Arquitectura Offline-First: Entrena sin preocuparte por la senal en el campo de tiro; tus puntajes se guardan al instante en el dispositivo y se sincronizan automaticamente en la nube.',
  ];

  for (const blk of descBlocks) {
    ty = drawParagraph(page1, blk, MARGIN + 12, ty, CONTENT_W - 24, fontRegular, 8.2, slate, 2.8);
    ty -= 3;
  }

  y -= box2H + 16;

  // ARCHIVO AAB A SUBIR
  const boxAabH = 62;
  page1.drawRectangle({
    x: MARGIN,
    y: y - boxAabH,
    width: CONTENT_W,
    height: boxAabH,
    color: cardBg,
    borderColor: emerald,
    borderWidth: 1.0,
  });
  page1.drawText('ARCHIVO OFICIAL .AAB PARA SUBIR A GOOGLE PLAY (v2.5 - Codigo 40500):', {
    x: MARGIN + 12,
    y: y - 18,
    size: 9,
    font: fontBold,
    color: emerald,
  });
  page1.drawText('Descarga directa: https://archery101010-c0bb4.web.app/Archery101010-v2.5.aab', {
    x: MARGIN + 12,
    y: y - 34,
    size: 9,
    font: fontBold,
    color: white,
  });
  page1.drawText('(Nota: Google Play exige subir el archivo .aab, no el .apk)', {
    x: MARGIN + 12,
    y: y - 48,
    size: 8,
    font: fontRegular,
    color: slate,
  });

  // =========================================================================
  // PAGE 2: CUESTIONARIOS DE "CONTENIDO DE LA APLICACION" PASO A PASO
  // =========================================================================
  const page2 = addDarkPage(2, 2);
  y = PAGE_H - 48;

  page2.drawText('PASO 3. RESPUESTAS A "CONTENIDO DE LA APLICACION" (APP CONTENT)', {
    x: MARGIN,
    y,
    size: 11.5,
    font: fontBold,
    color: gold,
  });
  page2.drawText('En el menu izquierdo de Play Console ve a "Contenido de la aplicacion" y responde asi:', {
    x: MARGIN,
    y: y - 14,
    size: 8.8,
    font: fontRegular,
    color: slate,
  });

  y -= 28;

  const sections = [
    {
      title: 'A) ANUNCIOS (ADS)',
      border: cyan,
      h: 48,
      lines: [
        '• Pregunta: ¿Tu aplicacion contiene anuncios?',
        '• Respuesta a marcar: "SI, mi aplicacion contiene anuncios" (por el modulo de banners de patrocinadores).',
      ],
    },
    {
      title: 'B) ACCESO A LA APLICACION (CREDENCIALES PARA EL REVISOR DE GOOGLE)',
      border: emerald,
      h: 88,
      lines: [
        '• Pregunta: ¿El acceso a tu aplicacion esta restringido?',
        '• Respuesta: Marca "Todas las funciones o algunas de ellas estan restringidas" -> Pulsa "Anadir instrucciones":',
        '  - Nombre de la instruccion: Acceso para revision de Google Play',
        '  - Usuario / Contrasena: (Puedes poner una cuenta de prueba o indicar el registro libre)',
        '  - Instrucciones: "El revisor puede iniciar sesion con 1 toque usando Continuar con Google, o crear una cuenta gratuita en Crear Cuenta Nueva sin restricciones ni pagos obligatorios."',
      ],
    },
    {
      title: 'C) CLASIFICACION DE CONTENIDO (CONTENT RATING - IARC)',
      border: gold,
      h: 84,
      lines: [
        '• Categoria: Selecciona "Utilidad, productividad, comunicacion u otro" (o Deportes).',
        '• Violencia, Sexualidad, Lenguaje ofensivo, Drogas, Apuestas: Marca "NO" en todas.',
        '• ¿Permite que los usuarios interactuen entre si o intercambien contenido?: Marca "SI" (por duelos/clubes).',
        '• ¿Comparte la ubicacion fisica exacta del usuario con otros usuarios?: Marca "NO".',
        '• ¿Permite comprar bienes digitales?: Marca "SI" (por suscripcion Coach PRO).',
      ],
    },
    {
      title: 'D) AUDIENCIA OBJETIVO Y CONTENIDO (TARGET AUDIENCE)',
      border: cyan,
      h: 64,
      lines: [
        '• Grupo de edad objetivo: Marca UNICAMENTE "13-15", "16-17" y "18 o mas".',
        '• IMPORTANTE: NO marques menores de 13 anos (evita requisitos extra del programa infantil Designed for Families).',
        '• ¿La ficha de Play Store podria atraer involuntariamente a ninos?: Marca "NO".',
      ],
    },
    {
      title: 'E) TIPOS DE APLICACIONES (NOTICIAS / GOBIERNO / FINANZAS / SALUD)',
      border: cardBorder,
      h: 58,
      lines: [
        '• ¿Es una app de Noticias, Gobierno o Finanzas?: Marca "NO" en cada una.',
        '• ¿Funciones de Salud (Health Apps)?: Marca "Mi aplicacion no tiene ninguna funcion de salud" (es una herramienta deportiva de puntuacion de tiro con arco, no medica).',
      ],
    },
    {
      title: 'F) SEGURIDAD DE LOS DATOS (DATA SAFETY)',
      border: emerald,
      h: 145,
      lines: [
        '1. ¿Recopila o comparte datos de usuario?: "SI"  |  ¿Estan cifrados en transito (HTTPS)?: "SI"',
        '2. ¿Ofreces una forma de solicitar que se eliminen los datos?: "SI"',
        '   -> Pega esta URL: https://archery101010-c0bb4.web.app/privacy#delete-account',
        '3. Tipos de datos a marcar en la lista:',
        '   • Informacion personal -> Marca: "Nombre", "Direccion de correo electronico", "Identificadores de usuario (UID)".',
        '   • Actividad en la aplicacion -> Marca: "Interacciones con la aplicacion" y "Otra actividad en la app (puntajes)".',
        '   • En cada dato marcado responde: "Se recopila" (Collected), "No se comparte con terceros", y como proposito marca "Funcionalidad de la aplicacion" y "Gestion de la cuenta".',
        '   • Nota sobre Audio: NO marques recopilacion de archivos de audio (el microfono se procesa en vivo sin grabarse).',
      ],
    },
  ];

  for (const sec of sections) {
    page2.drawRectangle({
      x: MARGIN,
      y: y - sec.h,
      width: CONTENT_W,
      height: sec.h,
      color: cardBg,
      borderColor: sec.border,
      borderWidth: 0.9,
    });
    page2.drawText(sec.title, {
      x: MARGIN + 12,
      y: y - 15,
      size: 9.2,
      font: fontBold,
      color: sec.border === cardBorder ? white : sec.border,
    });
    let sy = y - 29;
    for (const ln of sec.lines) {
      sy = drawParagraph(page2, ln, MARGIN + 12, sy, CONTENT_W - 24, fontRegular, 8.2, white, 2.8);
      sy -= 1.5;
    }
    y -= sec.h + 10;
  }

  // Final tip box
  const tipH = 72;
  page2.drawRectangle({
    x: MARGIN,
    y: y - tipH,
    width: CONTENT_W,
    height: tipH,
    color: cardBg,
    borderColor: gold,
    borderWidth: 0.9,
  });
  page2.drawText('PASO 4. NOTAS DE LA VERSION (AL SUBIR EL ARCHIVO Archery101010-v2.5.aab):', {
    x: MARGIN + 12,
    y: y - 16,
    size: 9,
    font: fontBold,
    color: gold,
  });
  drawParagraph(
    page2,
    'Cuando estes en "Produccion -> Crear nueva version", sube el archivo Archery101010-v2.5.aab y en "Notas de la version" pega: "Lanzamiento oficial de Archery 101010 v2.5: Planillas oficiales WA, diana interactiva, eliminatoria online 1v1, cronografo acustico, sistema de estrellas 101010 y portal para entrenadores."',
    MARGIN + 12,
    y - 31,
    CONTENT_W - 24,
    fontRegular,
    8.2,
    slate,
    3
  );

  const pdfBytes = await pdfDoc.save();
  const outPublic = path.join(__dirname, '..', 'public', 'Guia_Google_Play_Console_Archery101010.pdf');
  fs.writeFileSync(outPublic, pdfBytes);

  const outBuild = path.join(__dirname, '..', 'out', 'Guia_Google_Play_Console_Archery101010.pdf');
  if (fs.existsSync(path.join(__dirname, '..', 'out'))) {
    fs.writeFileSync(outBuild, pdfBytes);
  }
  console.log('Generated Google Play Console Guide PDF:', outPublic);
}

generatePlayStoreGuidePdf().catch((err) => {
  console.error(err);
  process.exit(1);
});
