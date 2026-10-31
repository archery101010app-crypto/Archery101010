const fs = require('fs');
const path = require('path');
const { Jimp } = require('jimp');

function buildGoodTimesGlyphsForSlogan(rawLogo) {
  const y0 = 134;
  const h = 131;

  // Genuine glyphs cropped directly from logo3.png (ARCHERY 101010)
  const glyphA = rawLogo.clone().crop({ x: 61, y: y0, w: 174, h });
  const glyphR = rawLogo.clone().crop({ x: 244, y: y0, w: 154, h });
  const glyphC = rawLogo.clone().crop({ x: 413, y: y0, w: 139, h });
  const glyphH = rawLogo.clone().crop({ x: 573, y: y0, w: 132, h });
  const glyphE = rawLogo.clone().crop({ x: 726, y: y0, w: 113, h });
  const glyphY = rawLogo.clone().crop({ x: 1021, y: y0, w: 152, h });

  // P: derived from R by clearing the diagonal leg below the bowl
  const glyphP = rawLogo.clone().crop({ x: 244, y: y0, w: 150, h });
  glyphP.scan(0, 0, glyphP.width, glyphP.height, (x, y, idx) => {
    if (y > 79 && x > 32) {
      glyphP.bitmap.data[idx + 3] = 0;
    }
  });

  // O: derived from the '0' in 101010 (x: 1258..1397, w: 140), recolored to pure white
  const glyphO = rawLogo.clone().crop({ x: 1258, y: y0, w: 140, h });
  glyphO.scan(0, 0, glyphO.width, glyphO.height, (x, y, idx) => {
    const a = glyphO.bitmap.data[idx + 3];
    if (a > 0) {
      glyphO.bitmap.data[idx] = 255;
      glyphO.bitmap.data[idx + 1] = 255;
      glyphO.bitmap.data[idx + 2] = 255;
    }
  });

  // U: bottom bowl of glyphO (y >= 65) + straight vertical stems for y < 65 matching the exact cross-section at y = 65
  const wU = glyphO.width;
  const glyphU = new Jimp({ width: wU, height: h, color: 0x00000000 });
  const midY = 65;
  glyphU.scan(0, 0, wU, h, (x, y, idx) => {
    const srcY = y < midY ? midY : y;
    const srcIdx = (srcY * wU + x) * 4;
    const a = glyphO.bitmap.data[srcIdx + 3];
    if (a > 0) {
      glyphU.bitmap.data[idx] = 255;
      glyphU.bitmap.data[idx + 1] = 255;
      glyphU.bitmap.data[idx + 2] = 255;
      glyphU.bitmap.data[idx + 3] = a;
    }
  });

  return {
    Y: glyphY,
    O: glyphO,
    U: glyphU,
    R: glyphR,
    A: glyphA,
    C: glyphC,
    H: glyphH,
    E: glyphE,
    P: glyphP
  };
}

function lerpColor(t) {
  // 0.0 -> Cyan (#00BFFF), 0.5 -> Red (#FF0000), 1.0 -> Yellow (#FFE500)
  if (t <= 0.5) {
    const u = t / 0.5;
    return {
      r: Math.round(0 + (255 - 0) * u),
      g: Math.round(191 + (0 - 191) * u),
      b: Math.round(255 + (0 - 255) * u)
    };
  } else {
    const u = (t - 0.5) / 0.5;
    return {
      r: 255,
      g: Math.round(0 + (229 - 0) * u),
      b: 0
    };
  }
}

async function generateFlatPrintFiles() {
  const rootDir = path.resolve(__dirname, '..');
  const logoFinalPath = path.join(rootDir, 'public', 'images', 'logo_final.png');
  const logo3Path = path.join(rootDir, 'public', 'images', 'logo3.png');

  const W = 3600;
  const H = 2000;
  const cx = W / 2;

  // Transparent canvas for DTF / Screen Printing
  const transparentCanvas = new Jimp({ width: W, height: H, color: 0x00000000 });

  // 1. Read & crop 101010 (logo_final.png) to tight bounds, then scale up cleanly to 3000px width
  const raw101010 = await Jimp.read(logoFinalPath);
  let minX = raw101010.width, minY = raw101010.height, maxX = 0, maxY = 0;
  raw101010.scan(0, 0, raw101010.width, raw101010.height, (x, y, idx) => {
    if (raw101010.bitmap.data[idx + 3] > 10) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  });
  const cropW = maxX - minX + 1;
  const cropH = maxY - minY + 1;
  const logo101010 = raw101010.clone().crop({ x: minX, y: minY, w: cropW, h: cropH });

  const targetLogoW = 2900;
  const targetLogoH = Math.round(targetLogoW * (cropH / cropW));
  logo101010.resize({ w: targetLogoW, h: targetLogoH });

  // Position 101010 in upper-center of the chest lockup
  const logoX = Math.round(cx - targetLogoW / 2);
  const logoY = 360;
  transparentCanvas.composite(logo101010, logoX, logoY);

  // 2. Build "YOUR ARCHERY APP" using Good Times glyphs
  const rawLogo3 = await Jimp.read(logo3Path);
  const glyphs = buildGoodTimesGlyphsForSlogan(rawLogo3);
  const text = 'YOUR ARCHERY APP';
  const trackingPx = 68;
  const spacePx = 150;

  let seqW = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === ' ') {
      seqW += spacePx;
    } else {
      seqW += glyphs[ch].width;
      if (i < text.length - 1 && text[i + 1] !== ' ') {
        seqW += trackingPx;
      }
    }
  }

  const sloganHiRes = new Jimp({ width: seqW, height: 131, color: 0x00000000 });
  let curX = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === ' ') {
      curX += spacePx;
    } else {
      sloganHiRes.composite(glyphs[ch], curX, 0);
      curX += glyphs[ch].width;
      if (i < text.length - 1 && text[i + 1] !== ' ') {
        curX += trackingPx;
      }
    }
  }

  // Scale "YOUR ARCHERY APP" to ~2250px wide (approx 78% of 101010 width)
  const sloganTargetW = 2240;
  const sloganTargetH = Math.round(131 * (sloganTargetW / seqW));
  sloganHiRes.resize({ w: sloganTargetW, h: sloganTargetH });

  const sloganX = Math.round(cx - sloganTargetW / 2);
  // Placed closely underneath 101010 (135px gap on 3600x2000 canvas)
  const sloganY = logoY + targetLogoH + 135;
  transparentCanvas.composite(sloganHiRes, sloganX, sloganY);

  // 3. Draw the smooth curved tricolor gradient arc (M x0,y0 Q cx,yMid x1,y0) right below "YOUR ARCHERY APP"
  const arcWidth = 1920;
  const arcStartX = Math.round(cx - arcWidth / 2);
  const arcEndX = arcStartX + arcWidth;
  const arcStartY = sloganY + sloganTargetH + 90;
  const arcSag = 52; // quadratic bezier sag at center
  const strokeRadius = 9.5; // ~19px thick smooth stroke at 3600px resolution

  const minArcY = Math.floor(arcStartY - strokeRadius - 4);
  const maxArcY = Math.ceil(arcStartY + arcSag + strokeRadius + 4);

  for (let x = arcStartX - 12; x <= arcEndX + 12; x++) {
    const t = Math.max(0, Math.min(1, (x - arcStartX) / arcWidth));
    // Quadratic Bezier y(t) where P0.y = arcStartY, P1.y = arcStartY + arcSag, P2.y = arcStartY
    // y(t) = (1-t)^2 * y0 + 2(1-t)t * (y0 + sag) + t^2 * y0 = y0 + 2*t*(1-t)*sag
    const curveY = arcStartY + 2 * t * (1 - t) * arcSag;
    const col = lerpColor(t);

    // Distance to endpoints for rounded caps
    let distX = 0;
    if (x < arcStartX) distX = arcStartX - x;
    else if (x > arcEndX) distX = x - arcEndX;

    for (let y = minArcY; y <= maxArcY; y++) {
      const dy = y - curveY;
      const dist = Math.sqrt(distX * distX + dy * dy);
      if (dist <= strokeRadius + 1.2) {
        const alpha = dist <= strokeRadius - 0.8
          ? 255
          : Math.round(255 * Math.max(0, (strokeRadius + 1.2 - dist) / 2.0));
        if (alpha > 0) {
          const idx = (y * W + x) * 4;
          transparentCanvas.bitmap.data[idx] = col.r;
          transparentCanvas.bitmap.data[idx + 1] = col.g;
          transparentCanvas.bitmap.data[idx + 2] = col.b;
          transparentCanvas.bitmap.data[idx + 3] = Math.max(transparentCanvas.bitmap.data[idx + 3], alpha);
        }
      }
    }
  }

  // Create the black-background version as well
  const blackCanvas = new Jimp({ width: W, height: H, color: 0x000000ff });
  blackCanvas.composite(transparentCanvas, 0, 0);

  const artifactDir = 'C:/Users/Archery 101010/.gemini/antigravity/brain/6a327e3e-d87f-4993-ab10-ae63666eaeeb';
  const transPaths = [
    path.join(artifactDir, 'archery101010-serigrafia-transparente.png'),
    path.join(rootDir, 'public', 'archery101010-serigrafia-transparente.png'),
    path.join(rootDir, 'out', 'archery101010-serigrafia-transparente.png'),
    path.join(rootDir, 'releases', 'archery101010-serigrafia-transparente.png')
  ];
  const blackPaths = [
    path.join(artifactDir, 'archery101010-serigrafia-negro.png'),
    path.join(rootDir, 'public', 'archery101010-serigrafia-negro.png'),
    path.join(rootDir, 'out', 'archery101010-serigrafia-negro.png'),
    path.join(rootDir, 'releases', 'archery101010-serigrafia-negro.png')
  ];

  for (const p of transPaths) await transparentCanvas.write(p);
  for (const p of blackPaths) await blackCanvas.write(p);

  console.log('✅ Generated 3600x2000 HD flat screen-printing files (transparent + black background)');
}

generateFlatPrintFiles().catch((err) => {
  console.error(err);
  process.exit(1);
});
