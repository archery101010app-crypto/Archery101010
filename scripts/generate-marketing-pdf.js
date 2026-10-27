const fs = require("fs");
const path = require("path");
const { PDFDocument, rgb, StandardFonts } = require("pdf-lib");

async function generateMarketingPdf() {
  const doc = await PDFDocument.create();
  
  // Embed Standard Fonts
  const fontRegular = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontOblique = await doc.embedFont(StandardFonts.HelveticaOblique);

  // Color Palette (Cyber OLED & Modern SaaS)
  const cDarkBg = rgb(0.04, 0.04, 0.06);       // #0A0A0F
  const cCardBg = rgb(0.08, 0.09, 0.12);       // #14171F
  const cCyan = rgb(0.0, 0.9, 1.0);            // Cyan Neon #00E5FF
  const cYellow = rgb(1.0, 0.85, 0.2);         // Yellow Gold #FFD700
  const cWhite = rgb(1.0, 1.0, 1.0);
  const cGrayText = rgb(0.72, 0.74, 0.78);
  const cMuted = rgb(0.45, 0.47, 0.52);
  const cBorder = rgb(0.18, 0.22, 0.28);
  const cGreen = rgb(0.15, 0.85, 0.45);

  const PAGE_WIDTH = 595.28; // A4
  const PAGE_HEIGHT = 841.89;
  const MARGIN_X = 40;
  const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2;

  // Helper: Text Wrapping
  function wrapText(text, maxWidth, font, fontSize) {
    const words = text.split(" ");
    const lines = [];
    let currentLine = "";

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const testWidth = font.widthOfTextAtSize(testLine, fontSize);
      if (testWidth <= maxWidth) {
        currentLine = testLine;
      } else {
        if (currentLine) lines.push(currentLine);
        currentLine = word;
      }
    }
    if (currentLine) lines.push(currentLine);
    return lines;
  }

  // Helper: Create a styled page with background, top bar and footer
  function createStyledPage(pageNumber, totalPages = 5) {
    const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    
    // Background Dark
    page.drawRectangle({
      x: 0,
      y: 0,
      width: PAGE_WIDTH,
      height: PAGE_HEIGHT,
      color: cDarkBg,
    });

    // Top Brand Accent Line
    page.drawRectangle({
      x: 0,
      y: PAGE_HEIGHT - 4,
      width: PAGE_WIDTH,
      height: 4,
      color: cCyan,
    });

    // Top Header Banner
    page.drawText("ARCHERY 101010  |  GROWTH MARKETING & BRANDING PLAYBOOK", {
      x: MARGIN_X,
      y: PAGE_HEIGHT - 24,
      size: 8,
      font: fontBold,
      color: cCyan,
    });

    page.drawText("CONFIDENCIAL & ESTRATÉGICO", {
      x: PAGE_WIDTH - MARGIN_X - 130,
      y: PAGE_HEIGHT - 24,
      size: 8,
      font: fontRegular,
      color: cMuted,
    });

    page.drawLine({
      start: { x: MARGIN_X, y: PAGE_HEIGHT - 32 },
      end: { x: PAGE_WIDTH - MARGIN_X, y: PAGE_HEIGHT - 32 },
      thickness: 0.8,
      color: cBorder,
    });

    // Footer
    page.drawLine({
      start: { x: MARGIN_X, y: 35 },
      end: { x: PAGE_WIDTH - MARGIN_X, y: 35 },
      thickness: 0.8,
      color: cBorder,
    });

    page.drawText("Archery 101010 · High Performance World Archery Platform · 2026", {
      x: MARGIN_X,
      y: 22,
      size: 8,
      font: fontRegular,
      color: cMuted,
    });

    const pageStr = `Página ${pageNumber} de ${totalPages}`;
    const pageStrW = fontRegular.widthOfTextAtSize(pageStr, 8);
    page.drawText(pageStr, {
      x: PAGE_WIDTH - MARGIN_X - pageStrW,
      y: 22,
      size: 8,
      font: fontRegular,
      color: cCyan,
    });

    return page;
  }

  // Helper: Draw Section Title
  function drawSectionTitle(page, y, tag, title) {
    page.drawText(tag.toUpperCase(), {
      x: MARGIN_X,
      y: y,
      size: 8.5,
      font: fontBold,
      color: cCyan,
    });

    page.drawText(title, {
      x: MARGIN_X,
      y: y - 16,
      size: 15,
      font: fontBold,
      color: cWhite,
    });

    return y - 30;
  }

  // Helper: Draw Box Card
  function drawCard(page, x, y, width, height, borderColor = cBorder, bgColor = cCardBg) {
    page.drawRectangle({
      x,
      y: y - height,
      width,
      height,
      color: bgColor,
      borderColor: borderColor,
      borderWidth: 1,
    });
  }

  // ==========================================
  // PÁGINA 1: PORTADA & POSICIONAMIENTO
  // ==========================================
  const page1 = createStyledPage(1);
  let y = PAGE_HEIGHT - 60;

  // Hero Pill
  page1.drawRectangle({
    x: MARGIN_X,
    y: y - 18,
    width: 175,
    height: 20,
    color: rgb(0, 0.35, 0.45),
    borderColor: cCyan,
    borderWidth: 0.8,
  });
  page1.drawText("PLAN ESTRATEGICO OFICIAL 2026", {
    x: MARGIN_X + 10,
    y: y - 13,
    size: 7.5,
    font: fontBold,
    color: cWhite,
  });
  y -= 38;

  // Main Hero Title
  page1.drawText("ARCHERY 101010", {
    x: MARGIN_X,
    y: y,
    size: 28,
    font: fontBold,
    color: cCyan,
  });
  y -= 22;

  page1.drawText("Estrategia de Marketing Digital, Branding y Adquisicion Viral", {
    x: MARGIN_X,
    y: y,
    size: 13,
    font: fontBold,
    color: cWhite,
  });
  y -= 14;

  page1.drawText("Manual paso a paso para posicionar la app como el estandar global en tiro con arco World Archery.", {
    x: MARGIN_X,
    y: y,
    size: 9.5,
    font: fontOblique,
    color: cGrayText,
  });
  y -= 28;

  // Box: Posicionamiento & Propuesta de Valor
  drawCard(page1, MARGIN_X, y, CONTENT_WIDTH, 115, cCyan);
  page1.drawText("1. POSICIONAMIENTO DE MARCA (BRAND IDENTITY)", {
    x: MARGIN_X + 15,
    y: y - 20,
    size: 10,
    font: fontBold,
    color: cCyan,
  });

  const uLines = [
    "• El Enemigo Comun: Las hojas de calculo en papel arrugadas, las libretas mojadas en el campo",
    "  y aplicaciones anticuadas que solo sirven como libretas solitarias sin conexion con el entrenador.",
    "• Propuesta Unica de Valor (UVP): El primer ecosistema digital que unifica al Entrenador,",
    "  al Arquero y a la Diana bajo el reglamento estricto y semaforo oficial de World Archery.",
    "• Tono de Marca: Tecnologico, de elite, preciso, olimpico, OLED oscuro de alto rendimiento.",
    "• El Significado de '101010': La perfeccion en el tiro, consistencia de flechas al centro y ritmo."
  ];
  let py = y - 36;
  for (const l of uLines) {
    page1.drawText(l, { x: MARGIN_X + 15, y: py, size: 8.5, font: fontRegular, color: cWhite });
    py -= 12.5;
  }
  y -= 130;

  // Box: El Modelo Caballo de Troya (B2B2C)
  drawCard(page1, MARGIN_X, y, CONTENT_WIDTH, 140, cYellow);
  page1.drawText("2. LA ESTRATEGIA MATRIZ: EL 'CABALLO DE TROYA' (B2B2C)", {
    x: MARGIN_X + 15,
    y: y - 20,
    size: 10,
    font: fontBold,
    color: cYellow,
  });

  const b2bLines = [
    "En lugar de gastar en anuncios individuales para captar a 10.000 arqueros uno a uno:",
    "-> ENAMORA AL ENTRENADOR (COACH). El entrenador es la maxima autoridad tecnica del club.",
    "-> Cuando un entrenador adopta Archery 101010 para gestionar su club e importar sus planes",
    "   de Excel o Google Sheets, OBLIGA organicamente a todos sus alumnos (15 a 50 arqueros)",
    "   a descargar la aplicacion en su celular para consultar su plan diario y registrar sus flechas.",
    "-> Costo de Adquisicion de Clientes (CAC): Tiende a $0 USD por cada arquero.",
    "-> Tasa de Retencion: 3x superior a apps individuales, porque el arquero no puede desinstalarla",
    "   si alli recibe las instrucciones semanales de su entrenador."
  ];
  let py2 = y - 38;
  for (const l of b2bLines) {
    page1.drawText(l, { x: MARGIN_X + 15, y: py2, size: 8.5, font: fontRegular, color: cWhite });
    py2 -= 12.5;
  }
  y -= 155;

  // Box: Los 4 Pilares de Diferenciacion
  drawCard(page1, MARGIN_X, y, CONTENT_WIDTH, 160, cBorder);
  page1.drawText("3. LOS 4 PILARES DE VENTAJA COMPETITIVA GLOBAL", {
    x: MARGIN_X + 15,
    y: y - 20,
    size: 10,
    font: fontBold,
    color: cGreen,
  });

  const pilarData = [
    { title: "A. Importador Universal Excel / Sheets", desc: "El coach copia sus celdas y en 1 clic se transforma en tareas de calendario." },
    { title: "B. Asignacion Selectiva (1 o Todos)", desc: "Sincroniza planes personalizados a 1 alumno especifico o a toda la escuela." },
    { title: "C. Semaforo WA Flotante con Audio", desc: "Sustituye costosos semaforos de campo de $1,500 USD con 1 tablet o celular." },
    { title: "D. Match Play P2P con Audio en Vivo", desc: "Duelos olimpicos a distancia con walkie-talkie integrado y sets oficiales." }
  ];

  let pY = y - 38;
  for (const p of pilarData) {
    page1.drawText(`• ${p.title}:`, { x: MARGIN_X + 15, y: pY, size: 8.5, font: fontBold, color: cCyan });
    page1.drawText(p.desc, { x: MARGIN_X + 30, y: pY - 11, size: 8, font: fontRegular, color: cGrayText });
    pY -= 26;
  }

  // ==========================================
  // PÁGINA 2: FASE 1 - PRE-LANZAMIENTO
  // ==========================================
  const page2 = createStyledPage(2);
  let y2 = PAGE_HEIGHT - 55;

  y2 = drawSectionTitle(page2, y2, "FASE 1: PRE-LANZAMIENTO (SEMANAS -4 A -1)", "Generacion de Anticipacion y Construccion de Audiencia");

  // Tarjeta: Clubes Fundadores
  drawCard(page2, MARGIN_X, y2, CONTENT_WIDTH, 150, cCyan);
  page2.drawText("A. PROGRAMA 'CLUBES FUNDADORES 101010' (ACELERADOR B2B)", {
    x: MARGIN_X + 15,
    y: y2 - 20,
    size: 10,
    font: fontBold,
    color: cCyan,
  });

  const cfLines = [
    "• Objetivo: Registrar los primeros 100 clubes y entrenadores antes de abrir al publico.",
    "• La Oferta Irresistible: 6 meses de suscripcion PRO gratuita para el entrenador y todos sus",
    "  alumnos a cambio de feedback semanal y uso activo en sus entrenamientos.",
    "• Canal de Captacion: Mensaje directo personalizado en Instagram y Facebook a Asociaciones,",
    "  Federaciones Estatales/Regionales y academias de tiro con arco en Espana, Mexico, Colombia,",
    "  Argentina, Chile, Brasil y Estados Unidos.",
    "• Copy de Contacto Ganador: 'Hola Coach [Nombre], vimos la gran labor de su club. Desarrollamos",
    "  una plataforma para que usted suba sus macrociclos de Excel y se sincronicen en el celular de sus",
    "  alumnos con diana oficial y semaforo. Queremos invitar a su club al programa de acceso VIP fundador.'"
  ];
  let pycf = y2 - 38;
  for (const l of cfLines) {
    page2.drawText(l, { x: MARGIN_X + 15, y: pycf, size: 8.5, font: fontRegular, color: cWhite });
    pycf -= 13;
  }
  y2 -= 165;

  // Tarjeta: Micro-Influencers
  drawCard(page2, MARGIN_X, y2, CONTENT_WIDTH, 140, cYellow);
  page2.drawText("B. ALIANZAS CON ARQUEROS DE SELECCION Y CREADORES (SIN GASTAR EN ADS)", {
    x: MARGIN_X + 15,
    y: y2 - 20,
    size: 10,
    font: fontBold,
    color: cYellow,
  });

  const miLines = [
    "• En el tiro con arco, los atletas de seleccion nacional y medallistas de Copas del Mundo",
    "  tienen audiencias muy fieles y son extremadamente accesibles por redes sociales.",
    "• Tactica: Otorgar Cuentas Vitalicias VIP 'Pro-Athlete' a 25 arqueros de alto perfil.",
    "• No pedirles anuncios pagados: Los deportistas aman mostrar herramientas que elevan su nivel.",
    "• Cuando ellos entrenen en la linea de tiro y usen el semaforo flotante o el ploteo OLED en sus",
    "  historias de Instagram con una serie de 30 puntos, etiquetaran la app por orgullo deportivo.",
    "• Creadores clave a contactar: Entrenadores de YouTube (tipo Jake Kaminski, NUSensei)",
    "  y arqueros de equipos olimpicos de habla hispana e inglesa."
  ];
  let pymi = y2 - 38;
  for (const l of miLines) {
    page2.drawText(l, { x: MARGIN_X + 15, y: pymi, size: 8.5, font: fontRegular, color: cWhite });
    pymi -= 13;
  }
  y2 -= 155;

  // Tarjeta: Contenido Corto Viral (TikTok / Reels / Shorts)
  drawCard(page2, MARGIN_X, y2, CONTENT_WIDTH, 200, cGreen);
  page2.drawText("C. MAQUINARIA DE CONTENIDO CORTO VIRAL (TIKTOK & REELS)", {
    x: MARGIN_X + 15,
    y: y2 - 20,
    size: 10,
    font: fontBold,
    color: cGreen,
  });

  const vidIdeas = [
    {
      num: "Video Viral 1 (El Hook del Semaforo):",
      hook: "'Como le ahorramos $1,500 USD a nuestro club usando un celular viejo como semaforo oficial WA'.",
      action: "Muestra un telefono junto a la linea de tiro sonando los 2 pitidos oficiales, luz verde, cuenta atras y 3 pitidos."
    },
    {
      num: "Video Viral 2 (El Dolor del Excel):",
      hook: "'Cosas que solo los arqueros entienden: Cuando el coach te manda el plan en un Excel que no abre en el celular'.",
      action: "Corte rapido: Arrastras el Excel a Archery 101010 y al instante el alumno ve su meta de 120 flechas y enfoque tecnico."
    },
    {
      num: "Video Viral 3 (Duelo a Distancia P2P):",
      hook: "'Tiramos una final olimpica a 5 sets estando a 600 km de distancia'.",
      action: "Pantalla dividida con dos arqueros tirando en ciudades distintas comunicandose por walkie-talkie en tiempo real."
    }
  ];

  let pyv = y2 - 38;
  for (const v of vidIdeas) {
    page2.drawText(`• ${v.num}`, { x: MARGIN_X + 15, y: pyv, size: 8.5, font: fontBold, color: cCyan });
    page2.drawText(`Hook: "${v.hook}"`, { x: MARGIN_X + 25, y: pyv - 11, size: 8, font: fontOblique, color: cWhite });
    page2.drawText(`Visual: ${v.action}`, { x: MARGIN_X + 25, y: pyv - 22, size: 8, font: fontRegular, color: cGrayText });
    pyv -= 36;
  }

  // ==========================================
  // PÁGINA 3: FASE 2 - EL DÍA DEL LANZAMIENTO
  // ==========================================
  const page3 = createStyledPage(3);
  let y3 = PAGE_HEIGHT - 55;

  y3 = drawSectionTitle(page3, y3, "FASE 2: EL DIA DEL LANZAMIENTO (DIA D)", "Despliegue Masivo y Traccion Inmediata en Comunidades");

  // Invasión en Reddit
  drawCard(page3, MARGIN_X, y3, CONTENT_WIDTH, 175, cCyan);
  page3.drawText("A. LA ESTRATEGIA REDDIT: EL EPICENTRO MUNDIAL (r/Archery)", {
    x: MARGIN_X + 15,
    y: y3 - 20,
    size: 10,
    font: fontBold,
    color: cCyan,
  });

  const redditLines = [
    "• La comunidad 'r/Archery' en Reddit tiene mas de 120.000 miembros muy activos internacionalmente.",
    "• Regla de Oro en Reddit: NUNCA publiques como empresa de publicidad; publica como desarrollador-arquero.",
    "• Titulo del Post Ganador:",
    "  'After 2 years frustrated with paper scoresheets and outdated apps, we built a modern, OLED World",
    "  Archery platform with coach Excel sync, official audio beeps and live P2P matches. It is free.'",
    "• Que incluir en el post:",
    "  - Video de 40 segundos demostrando: importacion de celdas de Excel, semaforo flotante y diana OLED.",
    "  - Explicar que funciona 100% offline (IndexedDB local) para campos remotos sin internet.",
    "  - Enlace directo a Google Play Store / Web App sin muros de pago obligatorios.",
    "• Impacto esperado: Entre 2.000 y 7.000 descargas organicas internacionales en las primeras 72 horas."
  ];
  let pyrd = y3 - 38;
  for (const l of redditLines) {
    page3.drawText(l, { x: MARGIN_X + 15, y: pyrd, size: 8.5, font: fontRegular, color: cWhite });
    pyrd -= 12.5;
  }
  y3 -= 190;

  // Grupos Especializados de Facebook & Foros
  drawCard(page3, MARGIN_X, y3, CONTENT_WIDTH, 155, cYellow);
  page3.drawText("B. DESEMBARCO EN FOROS Y COMUNIDADES DE IBEROAMERICA Y GLOBAL", {
    x: MARGIN_X + 15,
    y: y3 - 20,
    size: 10,
    font: fontBold,
    color: cYellow,
  });

  const fbLines = [
    "• Foros Clave: ArcheryTalk (el foro mas grande de habla inglesa) y foros de tiro con arco en Espanol.",
    "• Grupos de Facebook con mas de 20k miembros cada uno:",
    "  - Tiro con Arco Mexico / Tiro con Arco Espana / Tiro con Arco Colombia y Cono Sur.",
    "  - World Archery Fans & Competitors / Target Archery Coaching Forum.",
    "• Formato de Publicacion de Alto Engagement:",
    "  Compartir un video corto resolviendo una duda real: 'Para los entrenadores que batallan",
    "  pasando sus planes de tiro a sus arqueros: compartimos esta herramienta gratuita para pegar",
    "  su tabla de Excel y que a sus alumnos se les organice el calendario automaticamente'.",
    "• Esto no genera rechazo porque aporta una solucion practica inmediata a un problema cronico."
  ];
  let pyfb = y3 - 38;
  for (const l of fbLines) {
    page3.drawText(l, { x: MARGIN_X + 15, y: pyfb, size: 8.5, font: fontRegular, color: cWhite });
    pyfb -= 12.5;
  }
  y3 -= 170;

  // Campaña de Lanzamiento "Bait de Entrada"
  drawCard(page3, MARGIN_X, y3, CONTENT_WIDTH, 170, cGreen);
  page3.drawText("C. EL 'BAIT' DE ENTRADA Y RETENCION DE USUARIOS", {
    x: MARGIN_X + 15,
    y: y3 - 20,
    size: 10,
    font: fontBold,
    color: cGreen,
  });

  const baitLines = [
    "• Descarga Gratuita con Funcionalidades Completas de Puntuacion y Ploteo:",
    "  El arquero individual nunca debe sentir una barrera para empezar a anotar sus flechas.",
    "• Modelo Freemium Inteligente:",
    "  - Nivel Gratuito: Puntuacion ilimitada, dianas oficiales WA, historial basico y modo offline.",
    "  - Nivel Club / Pro Coach: Sincronizacion ilimitada de calendario con alumnos, importador Excel,",
    "    analisis avanzado de agrupaciones y partidos P2P ilimitados.",
    "• Incentivo de Bienvenida:",
    "  'Registra tu club durante el mes de lanzamiento y obten 3 meses de funciones de entrenador Pro gratis'.",
    "• Efecto: Disminuye la friccion de prueba y fomenta la recomendacion boca a boca instantanea."
  ];
  let pybt = y3 - 38;
  for (const l of baitLines) {
    page3.drawText(l, { x: MARGIN_X + 15, y: pybt, size: 8.5, font: fontRegular, color: cWhite });
    pybt -= 12.5;
  }

  // ==========================================
  // PÁGINA 4: FASE 3 - POST-LANZAMIENTO & LOOPS VIRALES
  // ==========================================
  const page4 = createStyledPage(4);
  let y4 = PAGE_HEIGHT - 55;

  y4 = drawSectionTitle(page4, y4, "FASE 3: POST-LANZAMIENTO Y LOOPS VIRALES", "Mecanismos de Crecimiento Automatico dentro del Producto");

  // Loop Viral 1
  drawCard(page4, MARGIN_X, y4, CONTENT_WIDTH, 125, cCyan);
  page4.drawText("1. EL LOOP DE 'BRAGGING RIGHTS' (COMPARTIR DIANAS PERFECTAS)", {
    x: MARGIN_X + 15,
    y: y4 - 20,
    size: 10,
    font: fontBold,
    color: cCyan,
  });

  const brLines = [
    "• Comportamiento natural del arquero: Cuando alguien tira 30 puntos (tres dieces) o un récord personal,",
    "  lo primero que hace es tomarle foto a la diana de papel y subirla a Instagram Stories.",
    "• La Solucion Integrada en la App: Un boton directo 'Compartir Tarjeta en Stories'.",
    "• Genera una tarjeta de aspecto brutal: Fondo OLED negro, diana con las 3 flechas en la X,",
    "  distancia (ej. 70m), promedio de puntos y un sello elegante: 'Tirado con Archery 101010'.",
    "• Cada historia compartida expone la marca a entre 100 y 1.000 arqueros del mismo circulo social."
  ];
  let pybr = y4 - 38;
  for (const l of brLines) {
    page4.drawText(l, { x: MARGIN_X + 15, y: pybr, size: 8.5, font: fontRegular, color: cWhite });
    pybr -= 12.5;
  }
  y4 -= 140;

  // Loop Viral 2: Match Play Invites
  drawCard(page4, MARGIN_X, y4, CONTENT_WIDTH, 125, cYellow);
  page4.drawText("2. EL LOOP DE RETO MATCH PLAY POR WHATSAPP (INVITACION DIRECTA)", {
    x: MARGIN_X + 15,
    y: y4 - 20,
    size: 10,
    font: fontBold,
    color: cYellow,
  });

  const mpLines = [
    "• Cuando un arquero crea un partido Match Play olimpico en la app, se genera un enlace:",
    "  'Te he retado a una final olimpica a 5 sets en Archery 101010. Toca aqui para tirar: [link]'.",
    "• Si el rival ya tiene la app: entra a la sala de tiro al instante.",
    "• Si el rival NO tiene la app: el enlace lo lleva a descargar la app e inmediatamente abrir la sala.",
    "• Factor K de Viralidad: Cada usuario activo genera en promedio 1.4 nuevos usuarios invitados."
  ];
  let pymp = y4 - 38;
  for (const l of mpLines) {
    page4.drawText(l, { x: MARGIN_X + 15, y: pymp, size: 8.5, font: fontRegular, color: cWhite });
    pymp -= 12.5;
  }
  y4 -= 140;

  // Loop Viral 3: Torneo Mundial Abierto
  drawCard(page4, MARGIN_X, y4, CONTENT_WIDTH, 150, cGreen);
  page4.drawText("3. EL 'OPEN VIRTUAL MUNDIAL ARCHERY 101010' (EVENTO DE IMPACTO)", {
    x: MARGIN_X + 15,
    y: y4 - 20,
    size: 10,
    font: fontBold,
    color: cGreen,
  });

  const openLines = [
    "• Organizar el '1er Torneo Abierto Mundial Virtual Archery 101010':",
    "  - Modalidad: Ronda de 60 flechas (18m Indoor o 70m Outdoor) durante un fin de semana.",
    "  - Cada arquero tira en su propio club o diana, registra en la app y se publica el ranking mundial en vivo.",
    "  - Categorias: Recurvo Olimpico, Compuesto y Tradicional (Femenil y Varonil).",
    "  - Premios: Diplomas digitales oficiales de campeon mundial virtual y suscripciones PRO vitalicias.",
    "• Por que es viral: Los clubes compiten entre si por paises, generando retos entre escuelas",
    "  de Espana, Mexico, Colombia, EE.UU., etc., impulsando cientos de descargas por club en 48h."
  ];
  let pyop = y4 - 38;
  for (const l of openLines) {
    page4.drawText(l, { x: MARGIN_X + 15, y: pyop, size: 8.5, font: fontRegular, color: cWhite });
    pyop -= 12.5;
  }

  // ==========================================
  // PÁGINA 5: ASO, CRONOGRAMA & KPIS
  // ==========================================
  const page5 = createStyledPage(5);
  let y5 = PAGE_HEIGHT - 55;

  y5 = drawSectionTitle(page5, y5, "OPTIMIZACION ASO, CRONOGRAMA & METRICAS", "Posicionamiento en Play Store y Hoja de Ruta de Ejecucion");

  // ASO Box
  drawCard(page5, MARGIN_X, y5, CONTENT_WIDTH, 135, cCyan);
  page5.drawText("A. ASO: OPTIMIZACION DE TIENDA (GOOGLE PLAY & APP STORE)", {
    x: MARGIN_X + 15,
    y: y5 - 20,
    size: 10,
    font: fontBold,
    color: cCyan,
  });

  const asoLines = [
    "• Titulo Oficial Optimizado: Archery 101010 - Target & Timer",
    "• Subtitulo / Descripcion Corta: World Archery Scoring, Coach Plans & Match Play",
    "• Palabras Clave Principales (Keywords de Alto Volumen):",
    "  world archery, tiro con arco, archery timer, target archery, archery score, diana, macrociclo,",
    "  ianseo, mytargets, artemis archery, flechas, arco recurvo, arco compuesto, semaforo tiro con arco.",
    "• Icono y Capturas de Pantalla: Fondo OLED oscuro de alto contraste (#00E5FF) con diana oficial",
    "  WA, resaltando los textos: 'PLANES DE EXCEL', 'SEMAFORO OFICIAL' y 'MATCH PLAY EN VIVO'."
  ];
  let pyaso = y5 - 38;
  for (const l of asoLines) {
    page5.drawText(l, { x: MARGIN_X + 15, y: pyaso, size: 8.5, font: fontRegular, color: cWhite });
    pyaso -= 12.5;
  }
  y5 -= 150;

  // Cronograma Semanal
  drawCard(page5, MARGIN_X, y5, CONTENT_WIDTH, 150, cYellow);
  page5.drawText("B. CRONOGRAMA DE ACCION DE 8 SEMANAS", {
    x: MARGIN_X + 15,
    y: y5 - 20,
    size: 10,
    font: fontBold,
    color: cYellow,
  });

  const cronoData = [
    { sem: "Semana -4 a -2:", task: "Reclutar los primeros 50 clubes fundadores. Enviar accesos VIP a 20 arqueros de seleccion." },
    { sem: "Semana -1:", task: "Publicar los 3 videos teaser de TikTok/Reels atacando los dolores del Excel y semaforo." },
    { sem: "Semana 0 (Lanzamiento):", task: "Post en Reddit r/Archery, difusion en grupos de Facebook, activacion de clubes fundadores." },
    { sem: "Semana +1 a +2:", task: "Activar el loop de historias de Instagram ('Bragging Rights') y duelos Match Play." },
    { sem: "Semana +3 a +4:", task: "Lanzar la convocatoria para el 1er Torneo Virtual Abierto 101010 y optimizar ficha ASO." }
  ];
  let pycr = y5 - 38;
  for (const c of cronoData) {
    page5.drawText(`• ${c.sem}`, { x: MARGIN_X + 15, y: pycr, size: 8.5, font: fontBold, color: cCyan });
    page5.drawText(c.task, { x: MARGIN_X + 120, y: pycr, size: 8, font: fontRegular, color: cWhite });
    pycr -= 20;
  }
  y5 -= 165;

  // KPIs Box
  drawCard(page5, MARGIN_X, y5, CONTENT_WIDTH, 130, cGreen);
  page5.drawText("C. METRICAS CLAVE DE EXITO (KPIS A MONITOREAR)", {
    x: MARGIN_X + 15,
    y: y5 - 20,
    size: 10,
    font: fontBold,
    color: cGreen,
  });

  const kpiLines = [
    "• Clubes y Entrenadores Activos: Meta mes 1: 100 clubes -> Meta mes 3: 500 clubes.",
    "• Descargas Totales de Arqueros: Meta mes 1: 5.000 descargas -> Meta mes 3: 25.000 descargas.",
    "• K-Factor de Viralidad: > 1.2 (Cada usuario activo atrae al menos a 1 amigo mediante Match Play o club).",
    "• Retencion Dia 30 (D30): > 45% (Garantizado gracias a la sincronizacion del calendario del entrenador).",
    "• Flechas Registradas en la Plataforma: > 1.000.000 de flechas registradas en el primer trimestre."
  ];
  let pykp = y5 - 38;
  for (const l of kpiLines) {
    page5.drawText(l, { x: MARGIN_X + 15, y: pykp, size: 8.5, font: fontRegular, color: cWhite });
    pykp -= 13;
  }

  // Save PDF bytes
  const pdfBytes = await doc.save();
  
  // Output paths
  const publicPath = path.join(process.cwd(), "public", "Estrategia_Marketing_Archery101010.pdf");
  const releasesPath = path.join(process.cwd(), "releases", "Estrategia_Marketing_Archery101010.pdf");
  
  fs.writeFileSync(publicPath, pdfBytes);
  fs.writeFileSync(releasesPath, pdfBytes);
  
  console.log("PDF generated successfully at:");
  console.log("- " + publicPath + " (" + pdfBytes.length + " bytes)");
  console.log("- " + releasesPath);
}

generateMarketingPdf().catch((err) => {
  console.error("Error generating PDF:", err);
  process.exit(1);
});
