const fs = require('fs');
const path = require('path');
const { PDFDocument, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');

async function generateGlobalPromotionAsoMobilePdf() {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  // Use Windows Malgun Gothic (supports Latin + Spanish/Portuguese/French/German accents + Korean Hangul!)
  const regularFontBytes = fs.readFileSync('C:/Windows/Fonts/malgun.ttf');
  const boldFontBytes = fs.readFileSync('C:/Windows/Fonts/malgunbd.ttf');

  const fontRegular = await pdfDoc.embedFont(regularFontBytes, { subset: true });
  const fontBold = await pdfDoc.embedFont(boldFontBytes, { subset: true });

  // Mobile Phone Portrait Dimensions (9:17.5 aspect ratio - fills phone screen 100% without zooming)
  const PAGE_W = 390;
  const PAGE_H = 760;
  const MARGIN = 20;
  const CONTENT_W = PAGE_W - MARGIN * 2;
  const TOTAL_PAGES = 6;

  // OLED Brand Palette
  const bgDark = rgb(0.03, 0.035, 0.05);
  const cardBg = rgb(0.07, 0.085, 0.115);
  const copyBoxBg = rgb(0.045, 0.055, 0.08);
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
      y: PAGE_H - 25,
      size: 9,
      font: fontBold,
      color: cyan
    });
    p.drawText(`${pageNum} / ${TOTAL_PAGES}`, {
      x: PAGE_W - MARGIN - 28,
      y: PAGE_H - 25,
      size: 9,
      font: fontBold,
      color: muted
    });
    p.drawLine({
      start: { x: MARGIN, y: PAGE_H - 33 },
      end: { x: PAGE_W - MARGIN, y: PAGE_H - 33 },
      thickness: 0.6,
      color: cardBorder
    });

    // Bottom mobile footer bar
    p.drawLine({
      start: { x: MARGIN, y: 32 },
      end: { x: PAGE_W - MARGIN, y: 32 },
      thickness: 0.6,
      color: cardBorder
    });
    p.drawText('ARCHERY 101010 · PROMOCION GLOBAL Y TEXTOS ASO', {
      x: MARGIN,
      y: 16,
      size: 8,
      font: fontBold,
      color: muted
    });

    return p;
  }

  function wrapText(text, font, size, maxWidth) {
    const paragraphs = text.split('\n');
    const allLines = [];
    for (const para of paragraphs) {
      if (!para.trim()) {
        allLines.push('');
        continue;
      }
      const words = para.split(' ');
      let currentLine = '';
      for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word;
        const width = font.widthOfTextAtSize(testLine, size);
        if (width > maxWidth && currentLine) {
          allLines.push(currentLine);
          currentLine = word;
        } else {
          currentLine = testLine;
        }
      }
      if (currentLine) allLines.push(currentLine);
    }
    return allLines;
  }

  function drawParagraph(page, text, x, y, width, font, size, color, lineGap = 4) {
    const lines = wrapText(text, font, size, width);
    let curY = y;
    for (const line of lines) {
      if (line !== '') {
        page.drawText(line, { x, y: curY, size, font, color });
      }
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
    const bodyWidth = CONTENT_W - 26;
    const titleLines = wrapText(titleText, fontBold, 12.2, bodyWidth);
    const bodyLines = wrapText(bodyText, fontRegular, 10.8, bodyWidth);
    const cardH = 22 + titleLines.length * 16 + 4 + bodyLines.length * 15 + 12;

    drawCard(page, topY, cardH, accentColor, cardBg);

    let curY = topY - 17;
    page.drawText(badgeText, {
      x: MARGIN + 12,
      y: curY,
      size: 8.8,
      font: fontBold,
      color: accentColor
    });
    curY -= 16;
    curY = drawParagraph(page, titleText, MARGIN + 12, curY, bodyWidth, fontBold, 12.2, white, 3.8);
    curY -= 2;
    drawParagraph(page, bodyText, MARGIN + 12, curY, bodyWidth, fontRegular, 10.8, lightText, 4);

    return topY - cardH - 9;
  }

  function drawCopyBlock(page, topY, fieldLabel, copyText, accentColor = cyan) {
    const bodyWidth = CONTENT_W - 24;
    const lines = wrapText(copyText, fontRegular, 10.2, bodyWidth);
    const cardH = 21 + lines.length * 14.2 + 10;

    drawCard(page, topY, cardH, accentColor, copyBoxBg);

    let curY = topY - 16;
    page.drawText(fieldLabel, {
      x: MARGIN + 12,
      y: curY,
      size: 8.5,
      font: fontBold,
      color: accentColor
    });
    curY -= 15;
    drawParagraph(page, copyText, MARGIN + 12, curY, bodyWidth, fontRegular, 10.2, white, 3.8);

    return topY - cardH - 8;
  }

  // =========================================================================
  // PAGE 1: PORTADA + ESTRATEGIA GLOBAL (GRATIS VS PAGO)
  // =========================================================================
  const p1 = addMobilePage(1, 'GUIA MOVIL · PROMOCION EN GOOGLE PLAY Y APPLE');
  let y = PAGE_H - 50;

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
    y -= imgH + 14;
  }

  p1.drawText('PROMOCION POR PAIS Y ASO', {
    x: MARGIN,
    y,
    size: 17,
    font: fontBold,
    color: white
  });
  y -= 18;
  p1.drawText('COMO POSICIONAR ARCHERY 101010 EN COREA, EE.UU. Y EUROPA', {
    x: MARGIN,
    y,
    size: 9.2,
    font: fontBold,
    color: gold
  });
  y -= 16;

  y = drawParagraph(
    p1,
    'Google Play y Apple App Store te permiten publicar en +175 paises sin costo adicional. Para que el algoritmo recomiende tu app en paises clave (como Corea del Sur o EE.UU.), tienes 2 herramientas:',
    MARGIN,
    y,
    CONTENT_W,
    fontRegular,
    11,
    lightText,
    4
  );
  y -= 6;

  y = drawBulletCard(
    p1,
    y,
    '1 · FORMA GRATIS (ASO Y FICHAS POR IDIOMA)',
    'Traducciones Nativas en la Tienda ($0 USD)',
    'En Corea nadie busca "Tiro con arco", buscan "양궁" (Yang-gung). Al agregar la ficha en Coreano, Ingles y Portugues en tu consola, apareces gratis en las busquedas locales de esos paises.',
    emerald
  );

  y = drawBulletCard(
    p1,
    y,
    '2 · FORMA DE PAGO OPCIONAL (ANUNCIOS EN TIENDA)',
    'Google App Campaigns y Apple Search Ads',
    'Te coloca #1 arriba como "Patrocinado" en el pais que elijas. Solo pagas cuando alguien descarga la app (aprox. $0.20 a $0.80 USD por instalacion) y Apple da $100 USD de regalo inicial.',
    cyan
  );

  // =========================================================================
  // PAGE 2: PASO A PASO DESDE EL CELULAR EN AMBAS TIENDAS
  // =========================================================================
  const p2 = addMobilePage(2, 'PASO A PASO DESDE TU CELULAR');
  y = PAGE_H - 54;

  p2.drawText('COMO ACTIVARLO EN TU CELULAR', {
    x: MARGIN,
    y,
    size: 16.5,
    font: fontBold,
    color: cyan
  });
  y -= 18;
  p2.drawText('RUTA EXACTA EN GOOGLE PLAY CONSOLE Y APP STORE', {
    x: MARGIN,
    y,
    size: 9.2,
    font: fontBold,
    color: white
  });
  y -= 16;

  y = drawBulletCard(
    p2,
    y,
    'PASO 1 · GRATIS EN GOOGLE PLAY CONSOLE (HOY MISMO)',
    'Agregar Idiomas a tu Ficha de Google Play',
    '1) Entra a play.google.com/console -> Archery 101010.\n2) Menu (arriba izq) -> Crecimiento de usuarios -> Presencia en Google Play Store -> Ficha de Play Store principal.\n3) Toca "Administrar traducciones" -> "Agregar tus propias traducciones".\n4) Elige Ingles (en-US), Coreano (ko-KR), Portugues (pt-BR), Frances y Aleman, y pega los textos de las siguientes paginas.',
    emerald
  );

  y = drawBulletCard(
    p2,
    y,
    'PASO 2 · ANUNCIOS PAGADOS EN GOOGLE PLAY',
    'Al Pasar los 14 Dias de Prueba a Produccion',
    'En el menu de Play Console -> Crecimiento de usuarios -> Campañas de Google Ads. Creas una "Campaña de App", marcas los paises (ej. Corea del Sur, EE.UU., Mexico), pones tu presupuesto diario ($1 a $5 USD/dia) y eliges "Costo por instalacion (CPI)".',
    gold
  );

  y = drawBulletCard(
    p2,
    y,
    'PASO 3 · EN APPLE APP STORE (IPHONE)',
    'App Store Connect + Bono de $100 USD en Search Ads',
    'En appstoreconnect.apple.com tocas (+) junto al idioma para pegar las fichas y la casilla "Keywords". Para anuncios, entras a searchads.apple.com (modo Basic) y activas el credito promocional de $100 USD de Apple.',
    cyan
  );

  // =========================================================================
  // PAGE 3: FICHA LISTA PARA COPIAR Y PEGAR — INGLES (en-US / GLOBAL)
  // =========================================================================
  const p3 = addMobilePage(3, 'COPIAR Y PEGAR · INGLES (EE.UU., UK, GLOBAL)');
  y = PAGE_H - 54;

  p3.drawText('FICHA 1: INGLES (en-US)', {
    x: MARGIN,
    y,
    size: 16.5,
    font: fontBold,
    color: emerald
  });
  y -= 17;
  p3.drawText('MANTEN PRESIONADO EL TEXTO EN TU CELULAR PARA COPIAR', {
    x: MARGIN,
    y,
    size: 9,
    font: fontBold,
    color: gold
  });
  y -= 14;

  y = drawCopyBlock(
    p3,
    y,
    'NOMBRE DE LA APP / TITLE (Max 30 caracteres):',
    'Archery 101010: Score & Coach',
    emerald
  );

  y = drawCopyBlock(
    p3,
    y,
    'DESCRIPCION BREVE / SHORT DESCRIPTION (Max 80 caracteres):',
    'Pro archery scoring, target plotting, arrow counter & live coach telemetry.',
    cyan
  );

  y = drawCopyBlock(
    p3,
    y,
    'DESCRIPCION COMPLETA / FULL DESCRIPTION (Ingles):',
    'Archery 101010 is the ultimate high-performance archery scoring, arrow volume tracker, and live coaching platform for Recurve, Compound, and Barebow archers.\n\nKEY FEATURES:\n• Interactive Target Face Plotting: Plot arrow impacts on official World Archery (WA) targets with precision zoom.\n• Shot Dispersion & Grouping Telemetry: Analyze group center (MPI), sight adjustments, and consistency per end.\n• Daily Arrow Volume Counter: Track training arrow volume alongside tournament and practice scores.\n• Live Coach Portal: Link with your coach via invite code so they can monitor your scores, arrow volume, and target groupings in real time.\n• 100% Offline-First: Score anywhere on the range without internet; auto-syncs to the cloud when back online.',
    white
  );

  y = drawCopyBlock(
    p3,
    y,
    'KEYWORDS PARA APPLE APP STORE (Max 100 caracteres):',
    'archery,score,target,arrow,counter,recurve,compound,world archery,fita,bow,sight,coach,training',
    gold
  );

  // =========================================================================
  // PAGE 4: FICHA LISTA PARA COPIAR Y PEGAR — COREANO (ko-KR / COREA DEL SUR)
  // =========================================================================
  const p4 = addMobilePage(4, 'COPIAR Y PEGAR · COREANO (COREA DEL SUR)');
  y = PAGE_H - 54;

  p4.drawText('FICHA 2: COREANO (ko-KR · 양궁)', {
    x: MARGIN,
    y,
    size: 16.5,
    font: fontBold,
    color: cyan
  });
  y -= 17;
  p4.drawText('OPTIMIZADO CON TERMINOS REALES DE TIRO CON ARCO EN COREA', {
    x: MARGIN,
    y,
    size: 9,
    font: fontBold,
    color: gold
  });
  y -= 14;

  y = drawCopyBlock(
    p4,
    y,
    'NOMBRE DE LA APP / TITLE (Coreano):',
    'Archery 101010: 양궁 점수 & 코칭',
    cyan
  );

  y = drawCopyBlock(
    p4,
    y,
    'DESCRIPCION BREVE / SHORT DESCRIPTION (Coreano):',
    '양궁 점수 기록, 과녁 탄착군 분석, 화살 카운터 및 실시간 코치 포털 앱.',
    emerald
  );

  y = drawCopyBlock(
    p4,
    y,
    'DESCRIPCION COMPLETA / FULL DESCRIPTION (Coreano):',
    'Archery 101010은 리커브(Recurve), 컴파운드(Compound), 베어보우(Barebow) 양궁 선수와 코치를 위한 프로페셔널 양궁 점수 기록 및 훈련 분석 앱입니다.\n\n주요 기능:\n• 정밀 과녁 탄착군 기록: 세계양궁연맹(WA) 공인 표적지에 화살 탄착 위치를 정밀하게 터치하여 기록합니다.\n• 탄착군 및 그룹핑 분석: 엔드별 평균 점수, 탄착군 중심(MPI), 조준기 영점 데이터를 자동으로 계산합니다.\n• 화살 볼륨 카운터: 일일 훈련 화살 발수와 점수 기록을 구분하여 체계적으로 관리합니다.\n• 실시간 코치 포털: 초대 코드로 코치와 연결하여 선수의 점수, 과녁 탄착군, 훈련량을 실시간으로 공유합니다.\n• 오프라인 완벽 지원: 인터넷 연결 없이도 훈련장에서 즉시 기록하고 클라우드에 자동 동기화됩니다.',
    white
  );

  y = drawCopyBlock(
    p4,
    y,
    'KEYWORDS PARA APPLE APP STORE (Corea):',
    '양궁,양궁점수,양궁기록,리커브,컴파운드,베어보우,화살,과녁,탄착군,양궁코치,활쏘기,국궁,archery',
    gold
  );

  // =========================================================================
  // PAGE 5: FICHA LISTA PARA COPIAR Y PEGAR — PORTUGUES (pt-BR / BRASIL)
  // =========================================================================
  const p5 = addMobilePage(5, 'COPIAR Y PEGAR · PORTUGUES (BRASIL Y PORTUGAL)');
  y = PAGE_H - 54;

  p5.drawText('FICHA 3: PORTUGUES (pt-BR)', {
    x: MARGIN,
    y,
    size: 16.5,
    font: fontBold,
    color: gold
  });
  y -= 17;
  p5.drawText('OPTIMIZADO PARA ARQUEROS Y CLUBES DE BRASIL Y PORTUGAL', {
    x: MARGIN,
    y,
    size: 9,
    font: fontBold,
    color: white
  });
  y -= 14;

  y = drawCopyBlock(
    p5,
    y,
    'NOMBRE DE LA APP / TITLE (Portugues):',
    'Archery 101010: Tiro com Arco',
    gold
  );

  y = drawCopyBlock(
    p5,
    y,
    'DESCRIPCION BREVE / SHORT DESCRIPTION (Portugues):',
    'Pontuação de tiro com arco, análise de alvo, contador de flechas e portal Coach.',
    emerald
  );

  y = drawCopyBlock(
    p5,
    y,
    'DESCRIPCION COMPLETA / FULL DESCRIPTION (Portugues):',
    'Archery 101010 é a plataforma profissional de pontuação, controle de volume de flechas e telemetria para atletas e treinadores de Tiro com Arco (Recurvo, Composto e Barebow).\n\nPRINCIPAIS RECURSOS:\n• Marcação Interativa no Alvo: Registre cada flecha em alvos oficiais World Archery (WA) com lupa de precisão.\n• Telemetria de Agrupamento: Análise automática do centro do grupo (MPI), dispersão e ajuste de mira.\n• Contador de Volume de Flechas: Acompanhe o volume diário de treinos separado das rodadas de pontuação.\n• Portal do Treinador em Tempo Real: Conecte-se ao seu técnico por código para acompanhamento ao vivo de pontuações e alvos.\n• 100% Offline-First: Funciona sem internet na linha de tiro com sincronização automática na nuvem.',
    white
  );

  y = drawCopyBlock(
    p5,
    y,
    'KEYWORDS PARA APPLE APP STORE (Brasil / Portugal):',
    'tiro com arco,arco e flecha,pontuacao,alvo,recurvo,composto,barebow,treinador,flechas,world archery',
    cyan
  );

  // =========================================================================
  // PAGE 6: FICHAS PARA EUROPA — FRANCES (fr-FR) Y ALEMAN (de-DE)
  // =========================================================================
  const p6 = addMobilePage(6, 'COPIAR Y PEGAR · FRANCES Y ALEMAN (EUROPA)');
  y = PAGE_H - 54;

  p6.drawText('FICHA 4: FRANCES Y ALEMAN', {
    x: MARGIN,
    y,
    size: 16.5,
    font: fontBold,
    color: cyan
  });
  y -= 17;
  p6.drawText('LOS 2 MERCADOS MAS GRANDES DE TIRO CON ARCO EN EUROPA', {
    x: MARGIN,
    y,
    size: 9,
    font: fontBold,
    color: gold
  });
  y -= 14;

  y = drawCopyBlock(
    p6,
    y,
    'FRANCES (fr-FR) · TITULO Y DESCRIPCION BREVE:',
    'Título: Archery 101010: Tir à l\'Arc\nBreve: Score de tir à l\'arc, impacts sur blason, compteur de flèches et suivi Coach.',
    cyan
  );

  y = drawCopyBlock(
    p6,
    y,
    'FRANCES (fr-FR) · DESCRIPCION COMPLETA Y KEYWORDS:',
    'Archery 101010 est l\'application de référence pour le tir à l\'arc (Arc Classique, Arc à Poulies, Barebow) : feuille de marque interactive World Archery, analyse de groupement sur blason, compteur de volume de flèches et portail Entraîneur en temps réel (100% hors-ligne).\nKeywords: tir a l arc,score,cible,blason,fleches,arc classique,poulies,barebow,entraineur,world archery',
    white
  );

  y = drawCopyBlock(
    p6,
    y,
    'ALEMAN (de-DE) · TITULO Y DESCRIPCION BREVE:',
    'Título: Archery 101010: Bogenschießen\nBreve: Bogenschießen Schießzettel, Trefferbild, Pfeilzähler & Live-Trainer-Portal.',
    emerald
  );

  y = drawCopyBlock(
    p6,
    y,
    'ALEMAN (de-DE) · DESCRIPCION COMPLETA Y KEYWORDS:',
    'Archery 101010 ist die Profi-App für Bogenschießen (Recurve, Compound, Blankbogen): Interaktive World Archery Zielscheibe mit Trefferbild-Analyse, täglicher Pfeilzähler, Live-Trainer-Portal für Vereine und 100% Offline-Modus am Schießplatz.\nKeywords: bogenschiessen,schiesszettel,pfeilzaehler,recurve,compound,blankbogen,trainer,zielscheibe,bogen',
    gold
  );

  const pdfBytes = await pdfDoc.save();

  const artifactDir = 'C:/Users/Archery 101010/.gemini/antigravity/brain/6a327e3e-d87f-4993-ab10-ae63666eaeeb';
  const fileName = 'Guia_Promocion_Global_ASO_Archery101010_Movil.pdf';
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

  console.log(`✅ Generated Mobile-Screen Global Promotion & ASO PDF (${pdfBytes.length} bytes, 6 pages)`);
}

generateGlobalPromotionAsoMobilePdf().catch((err) => {
  console.error(err);
  process.exit(1);
});
