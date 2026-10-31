const fs = require('fs');
const path = require('path');
const { Jimp } = require('jimp');

// Extract genuine Good Times glyphs from logo3.png (1920x400, y: 134..264, h: 131)
function buildGoodTimesGlyphs(rawLogo3) {
  const y0 = 134;
  const h = 131;

  // A: x 61..234 (w 174)
  const glyphA = rawLogo3.clone().crop({ x: 61, y: y0, w: 174, h });

  // H: x 573..704 (w 132)
  const glyphH = rawLogo3.clone().crop({ x: 573, y: y0, w: 132, h });

  // E: x 726..838 (w 113)
  const glyphE = rawLogo3.clone().crop({ x: 726, y: y0, w: 113, h });

  // P: derived from R (x 244..397, w 154) by removing the lower-right leg below the bowl
  const glyphP = rawLogo3.clone().crop({ x: 244, y: y0, w: 150, h });
  glyphP.scan(0, 0, glyphP.width, glyphP.height, (x, y, idx) => {
    if (y > 79 && x > 32) {
      glyphP.bitmap.data[idx + 3] = 0;
    }
  });

  // T: built using the exact stroke weight of H's vertical stem (24px) and E's top bar (21px)
  const wT = 132;
  const glyphT = new Jimp({ width: wT, height: h, color: 0x00000000 });
  const stemW = 24;
  const barH = 21;
  const stemX = Math.round((wT - stemW) / 2);

  glyphT.scan(0, 0, wT, h, (x, y, idx) => {
    const inTopBar = y >= 0 && y < barH;
    const inStem = x >= stemX && x < stemX + stemW;
    if (inTopBar || inStem) {
      glyphT.bitmap.data[idx] = 255;
      glyphT.bitmap.data[idx + 1] = 255;
      glyphT.bitmap.data[idx + 2] = 255;
      glyphT.bitmap.data[idx + 3] = 255;
    }
  });

  return { T: glyphT, H: glyphH, E: glyphE, A: glyphA, P: glyphP };
}

async function generateWatermarkAssets() {
  const rootDir = path.resolve(__dirname, '..');
  const logo5Path = path.join(rootDir, 'public', 'images', 'logo5.png');
  const logo3Path = path.join(rootDir, 'public', 'images', 'logo3.png');

  const rawLogo5 = await Jimp.read(logo5Path);
  const rawLogo3 = await Jimp.read(logo3Path);

  // Find exact bounds of 101010 in logo5 (y: 370..540)
  let minX10 = rawLogo5.width, maxX10 = 0, minY10 = 540, maxY10 = 370;
  rawLogo5.scan(0, 370, rawLogo5.width, 170, (x, y, idx) => {
    if (rawLogo5.bitmap.data[idx + 3] > 15) {
      if (x < minX10) minX10 = x;
      if (x > maxX10) maxX10 = x;
      if (y < minY10) minY10 = y;
      if (y > maxY10) maxY10 = y;
    }
  });

  // Find exact bounds of ARCHERY in logo5 (y: 570..655) so THE APP matches its exact height and vertical gap
  let minXArch = rawLogo5.width, maxXArch = 0, minYArch = 655, maxYArch = 570;
  rawLogo5.scan(0, 570, rawLogo5.width, 85, (x, y, idx) => {
    if (rawLogo5.bitmap.data[idx + 3] > 15) {
      if (x < minXArch) minXArch = x;
      if (x > maxXArch) maxXArch = x;
      if (y < minYArch) minYArch = y;
      if (y > maxYArch) maxYArch = y;
    }
  });

  const w10 = maxX10 - minX10 + 1;
  const h10 = maxY10 - minY10 + 1;
  const hArch = maxYArch - minYArch + 1; // 67px
  const gapY = minYArch - maxY10;        // 44px

  const crop101010 = rawLogo5.clone().crop({ x: minX10, y: minY10, w: w10, h: h10 });

  // Build "THE APP" at 131px height with letter spacing that matches the exact visual proportion of ARCHERY
  const glyphs = buildGoodTimesGlyphs(rawLogo3);
  const sequence = ['T', 'H', 'E', ' ', 'A', 'P', 'P'];
  const trackingPx = 30;
  const spacePx = 105;

  let seqW = 0;
  for (let i = 0; i < sequence.length; i++) {
    const ch = sequence[i];
    if (ch === ' ') {
      seqW += spacePx;
    } else {
      seqW += glyphs[ch].width;
      if (i < sequence.length - 1 && sequence[i + 1] !== ' ') {
        seqW += trackingPx;
      }
    }
  }

  const theAppHiRes = new Jimp({ width: seqW, height: 131, color: 0x00000000 });
  let curX = 0;
  for (let i = 0; i < sequence.length; i++) {
    const ch = sequence[i];
    if (ch === ' ') {
      curX += spacePx;
    } else {
      theAppHiRes.composite(glyphs[ch], curX, 0);
      curX += glyphs[ch].width;
      if (i < sequence.length - 1 && sequence[i + 1] !== ' ') {
        curX += trackingPx;
      }
    }
  }

  // Scale both 101010 and THE APP up by 1.6x for ultra-crisp Strava watermark quality
  const scale = 1.6;
  const finalW10 = Math.round(w10 * scale);
  const finalH10 = Math.round(h10 * scale);
  const finalGapY = Math.round(gapY * scale);
  const finalHSub = Math.round(hArch * scale);
  const finalWSub = Math.round(seqW * (finalHSub / 131));

  const scaled101010 = crop101010.clone().resize({ w: finalW10, h: finalH10 });
  const scaledTheApp = theAppHiRes.clone().resize({ w: finalWSub, h: finalHSub });

  // 1. Tight Horizontal Watermark (1600 x 700, 100% transparent background)
  const wmW = 1600;
  const wmH = 700;
  const wmCanvas = new Jimp({ width: wmW, height: wmH, color: 0x00000000 });
  const totalLockupH = finalH10 + finalGapY + finalHSub;
  const topY = Math.round((wmH - totalLockupH) / 2);

  wmCanvas.composite(scaled101010, Math.round((wmW - finalW10) / 2), topY);
  wmCanvas.composite(scaledTheApp, Math.round((wmW - finalWSub) / 2), topY + finalH10 + finalGapY);

  // 2. Square 1024x1024 Transparent + Black Preview (matching the user's uploaded reference image)
  const sqSize = 1024;
  const sqScale = 1.05;
  const sqW10 = Math.round(w10 * sqScale);
  const sqH10 = Math.round(h10 * sqScale);
  const sqGapY = Math.round(gapY * sqScale);
  const sqHSub = Math.round(hArch * sqScale);
  const sqWSub = Math.round(seqW * (sqHSub / 131));

  const sq101010 = crop101010.clone().resize({ w: sqW10, h: sqH10 });
  const sqTheApp = theAppHiRes.clone().resize({ w: sqWSub, h: sqHSub });

  const sqTransparent = new Jimp({ width: sqSize, height: sqSize, color: 0x00000000 });
  const sqTotalH = sqH10 + sqGapY + sqHSub;
  const sqTopY = Math.round((sqSize - sqTotalH) / 2);

  sqTransparent.composite(sq101010, Math.round((sqSize - sqW10) / 2), sqTopY);
  sqTransparent.composite(sqTheApp, Math.round((sqSize - sqWSub) / 2), sqTopY + sqH10 + sqGapY);

  const sqBlack = new Jimp({ width: sqSize, height: sqSize, color: 0x000000ff });
  sqBlack.composite(sqTransparent, 0, 0);

  const artifactDir = 'C:/Users/Archery 101010/.gemini/antigravity/brain/6a327e3e-d87f-4993-ab10-ae63666eaeeb';

  const wmPaths = [
    path.join(artifactDir, '101010-the-app-watermark-transparente.png'),
    path.join(rootDir, 'public', '101010-the-app-watermark-transparente.png'),
    path.join(rootDir, 'public', 'images', '101010-the-app-watermark.png'),
    path.join(rootDir, 'out', '101010-the-app-watermark-transparente.png'),
    path.join(rootDir, 'releases', '101010-the-app-watermark-transparente.png')
  ];
  const blackPaths = [
    path.join(artifactDir, '101010-the-app-preview-negro.png'),
    path.join(rootDir, 'public', '101010-the-app-preview-negro.png'),
    path.join(rootDir, 'out', '101010-the-app-preview-negro.png'),
    path.join(rootDir, 'releases', '101010-the-app-preview-negro.png')
  ];

  for (const p of wmPaths) await wmCanvas.write(p);
  for (const p of blackPaths) await sqBlack.write(p);

  console.log('✅ Generated 101010 THE APP transparent Strava watermark and black preview');
}

generateWatermarkAssets().catch((err) => {
  console.error(err);
  process.exit(1);
});
