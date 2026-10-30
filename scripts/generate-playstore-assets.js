const fs = require('fs');
const path = require('path');
const { Jimp } = require('jimp');

// Extract genuine Good Times glyphs from logo3.png (1920x400, y: 134..264, h: 131)
function buildGoodTimesGlyphs(rawLogo) {
  const y0 = 134;
  const h = 131;

  // A: x 61..234 (w 174)
  const glyphA = rawLogo.clone().crop({ x: 61, y: y0, w: 174, h });

  // H: x 573..704 (w 132)
  const glyphH = rawLogo.clone().crop({ x: 573, y: y0, w: 132, h });

  // E: x 726..838 (w 113)
  const glyphE = rawLogo.clone().crop({ x: 726, y: y0, w: 113, h });

  // P: derived from R (x 244..397, w 154) by removing the lower-right leg below the bowl (y > 79 in local coords, x > 40)
  const glyphP = rawLogo.clone().crop({ x: 244, y: y0, w: 150, h });
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

async function generateFeatureGraphic(logo3Path) {
  const W = 1024;
  const H = 500;
  // Pure matte OLED carbon-black (#050608)
  const canvas = new Jimp({ width: W, height: H, color: 0x050608ff });

  const cx = W / 2;
  const cy = H / 2;

  // 1. Crop official horizontal Good Times logo (ARCHERY 101010) to exact non-transparent bounds
  const rawLogo = await Jimp.read(logo3Path);
  let minX = rawLogo.width, minY = rawLogo.height, maxX = 0, maxY = 0;
  rawLogo.scan(0, 0, rawLogo.width, rawLogo.height, (x, y, idx) => {
    if (rawLogo.bitmap.data[idx + 3] > 10) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  });

  const croppedW = maxX - minX + 1;
  const croppedH = maxY - minY + 1;
  const croppedLogo = rawLogo.clone().crop({ x: minX, y: minY, w: croppedW, h: croppedH });

  // Scale main logo cleanly to 780px width
  const targetW = 780;
  const targetH = Math.round(targetW * (croppedH / croppedW));
  croppedLogo.resize({ w: targetW, h: targetH });

  const logoX = Math.round((W - targetW) / 2);
  const logoY = Math.round(cy - targetH / 2 - 28);
  canvas.composite(croppedLogo, logoX, logoY);

  // 2. Compose "THE APP" at high resolution using genuine Good Times glyphs, then scale down cleanly
  const glyphs = buildGoodTimesGlyphs(rawLogo);
  const sequence = ['T', 'H', 'E', ' ', 'A', 'P', 'P'];
  const trackingPx = 95; // wide editorial tracking in 131px source space
  const spacePx = 155;

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

  const subtitleHiRes = new Jimp({ width: seqW, height: 131, color: 0x00000000 });
  let curX = 0;
  for (let i = 0; i < sequence.length; i++) {
    const ch = sequence[i];
    if (ch === ' ') {
      curX += spacePx;
    } else {
      subtitleHiRes.composite(glyphs[ch], curX, 0);
      curX += glyphs[ch].width;
      if (i < sequence.length - 1 && sequence[i + 1] !== ' ') {
        curX += trackingPx;
      }
    }
  }

  // +15% larger "THE APP" (19 -> 22px height)
  const subTargetH = 22;
  const subTargetW = Math.round(seqW * (subTargetH / 131));
  subtitleHiRes.resize({ w: subTargetW, h: subTargetH });

  const subX = Math.round(cx - subTargetW / 2);
  const subY = Math.round(logoY + targetH + 28);
  canvas.composite(subtitleHiRes, subX, subY);

  // 3. Crisp 3-segment 101010 Tricolor Accent Line below "THE APP" (+20% longer: 132 -> 159px, thicker: 3 -> 4px)
  const barWidth = 159;
  const barHeight = 4;
  const barX = Math.round(cx - barWidth / 2);
  const barY = Math.round(subY + subTargetH + 20);
  const segW = barWidth / 3;

  for (let y = barY; y < barY + barHeight; y++) {
    for (let x = barX; x < barX + barWidth; x++) {
      const idx = (y * W + x) * 4;
      const offset = x - barX;
      if (offset < segW) {
        // Cyan #00BFFF
        canvas.bitmap.data[idx] = 0;
        canvas.bitmap.data[idx + 1] = 191;
        canvas.bitmap.data[idx + 2] = 255;
      } else if (offset < segW * 2) {
        // Red #FF0000
        canvas.bitmap.data[idx] = 255;
        canvas.bitmap.data[idx + 1] = 0;
        canvas.bitmap.data[idx + 2] = 0;
      } else {
        // Gold #FFE500
        canvas.bitmap.data[idx] = 255;
        canvas.bitmap.data[idx + 1] = 229;
        canvas.bitmap.data[idx + 2] = 0;
      }
      canvas.bitmap.data[idx + 3] = 255;
    }
  }

  return canvas;
}

async function generateStoreIcon(logo5Path) {
  const S = 512;
  const canvas = new Jimp({ width: S, height: S, color: 0x050608ff });

  const rawLogo = await Jimp.read(logo5Path);
  let minX = rawLogo.width, minY = rawLogo.height, maxX = 0, maxY = 0;
  rawLogo.scan(0, 0, rawLogo.width, rawLogo.height, (x, y, idx) => {
    if (rawLogo.bitmap.data[idx + 3] > 10) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  });

  const croppedW = maxX - minX + 1;
  const croppedH = maxY - minY + 1;
  const cropped = rawLogo.clone().crop({ x: minX, y: minY, w: croppedW, h: croppedH });

  const targetW = 390;
  const targetH = Math.round(targetW * (croppedH / croppedW));
  cropped.resize({ w: targetW, h: targetH });

  const x = Math.round((S - targetW) / 2);
  const y = Math.round((S - targetH) / 2);
  canvas.composite(cropped, x, y);

  return canvas;
}

async function main() {
  console.log('🚀 Generating Official Google Play Store Assets (Pure OLED Brand Line)...');

  const rootDir = path.resolve(__dirname, '..');
  const googlePlayDir = path.join(rootDir, 'android', 'google_play');
  const storeAssetsDir = path.join(rootDir, 'public', 'store-assets');

  if (!fs.existsSync(googlePlayDir)) fs.mkdirSync(googlePlayDir, { recursive: true });
  if (!fs.existsSync(storeAssetsDir)) fs.mkdirSync(storeAssetsDir, { recursive: true });

  const logo3Path = path.join(rootDir, 'public', 'images', 'logo3.png');
  const logo5Path = path.join(rootDir, 'public', 'images', 'logo5.png');

  const featureGraphic = await generateFeatureGraphic(logo3Path);
  await featureGraphic.write(path.join(googlePlayDir, 'feature_graphic_1024x500.png'));
  await featureGraphic.write(path.join(storeAssetsDir, 'playstore-feature-graphic-1024x500.png'));

  const storeIcon = await generateStoreIcon(logo5Path);
  await storeIcon.write(path.join(googlePlayDir, 'store_icon_512.png'));
  await storeIcon.write(path.join(storeAssetsDir, 'playstore-icon-512x512.png'));

  console.log('✅ Generated feature_graphic_1024x500.png & store_icon_512.png');
}

main().catch((err) => {
  console.error('❌ Error generating assets:', err);
  process.exit(1);
});
