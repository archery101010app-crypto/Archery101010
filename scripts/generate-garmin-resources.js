const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { Jimp } = require('jimp');
const fontkit = require('@pdf-lib/fontkit');

const ROOT = path.resolve(__dirname, '..');
const GARMIN_DIR = path.join(ROOT, 'garmin-ciq');
const OUTFIT_TTF = path.join(ROOT, 'android/wear/src/main/assets/fonts/Outfit.ttf');
const LOGO3_PNG = path.join(ROOT, 'public/images/logo3.png');

const CHARSET_HERO = '0123456789';
const CHARSET_FULL = ' 0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz·./+-:>ÁÉÍÓÚÑáéíóúñ';

const BUCKETS = [
  { folder: 'resources', dim: 240, antialias: false, mono: false, iconSize: 60 },
  { folder: 'resources-mono', dim: 176, antialias: false, mono: true, iconSize: 40 },
  { folder: 'resources-round-208x208', dim: 208, antialias: false, mono: false, iconSize: 40 },
  { folder: 'resources-round-218x218', dim: 218, antialias: true, mono: false, iconSize: 40 },
  { folder: 'resources-round-240x240', dim: 240, antialias: true, mono: false, iconSize: 40 },
  { folder: 'resources-round-260x260', dim: 260, antialias: true, mono: false, iconSize: 40 },
  { folder: 'resources-round-280x280', dim: 280, antialias: true, mono: false, iconSize: 40 },
  { folder: 'resources-round-360x360', dim: 360, antialias: true, mono: false, iconSize: 60 },
  { folder: 'resources-round-390x390', dim: 390, antialias: true, mono: false, iconSize: 60 },
  { folder: 'resources-round-416x416', dim: 416, antialias: true, mono: false, iconSize: 60 },
  { folder: 'resources-round-454x454', dim: 454, antialias: true, mono: false, iconSize: 65 }
];

function nextPow2(v) {
  let p = 32;
  while (p < v) p *= 2;
  return p;
}

async function cropMasterLogo() {
  const rawLogo = await Jimp.read(LOGO3_PNG);
  let minX = rawLogo.width, minY = rawLogo.height, maxX = 0, maxY = 0;
  rawLogo.scan(0, 0, rawLogo.width, rawLogo.height, (x, y, idx) => {
    if (rawLogo.bitmap.data[idx + 3] > 12) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  });
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const cropped = rawLogo.clone().crop({ x: minX, y: minY, w, h });
  const buf = await cropped.getBuffer('image/png');
  return { buf, w, h };
}

async function generateBrandLogoForBucket(masterLogo, outPath, dim, mono, lowBpp) {
  const targetW = Math.max(88, Math.round(dim * 0.50));
  const innerH = Math.max(7, Math.round(targetW * (masterLogo.h / masterLogo.w)));
  const padY = 1;
  const totalH = innerH + padY * 2;

  const { data, info } = await sharp(masterLogo.buf)
    .resize(targetW, innerH, { kernel: sharp.kernel.lanczos3 })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const out = Buffer.alloc(targetW * totalH * 4, 0);
  // Fill solid black (#000000, alpha=255) so Connect IQ never produces gray/cyan edge artifacts
  for (let i = 0; i < out.length; i += 4) {
    out[i + 3] = 255;
  }

  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const sIdx = (y * info.width + x) * 4;
      const dIdx = ((y + padY) * targetW + x) * 4;
      const r = data[sIdx];
      const g = data[sIdx + 1];
      const b = data[sIdx + 2];
      const a = data[sIdx + 3] / 255.0;

      if (mono) {
        const lum = Math.max(r, g, b) * a;
        const on = lum >= 78 ? 255 : 0;
        out[dIdx] = on;
        out[dIdx + 1] = on;
        out[dIdx + 2] = on;
        out[dIdx + 3] = 255;
      } else if (lowBpp) {
        // Crisp contrast boost for 4-bpp / 8-bpp MIP displays
        const boostedA = Math.pow(a, 0.62);
        if (boostedA < 0.35) {
          out[dIdx] = 0;
          out[dIdx + 1] = 0;
          out[dIdx + 2] = 0;
        } else {
          out[dIdx] = Math.min(255, Math.round(r * boostedA * 1.12));
          out[dIdx + 1] = Math.min(255, Math.round(g * boostedA * 1.12));
          out[dIdx + 2] = Math.min(255, Math.round(b * boostedA * 1.12));
        }
        out[dIdx + 3] = 255;
      } else {
        // 16-bit AMOLED: crisp slight gamma boost so thin Good Times strokes pop cleanly
        const boostedA = Math.pow(a, 0.78);
        out[dIdx] = Math.min(255, Math.round(r * boostedA));
        out[dIdx + 1] = Math.min(255, Math.round(g * boostedA));
        out[dIdx + 2] = Math.min(255, Math.round(b * boostedA));
        out[dIdx + 3] = 255;
      }
    }
  }

  await sharp(out, { raw: { width: targetW, height: totalH, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(outPath);
}

async function generateFontAtlas(fontInstance, charset, emPx, antialias, tabularDigits, baseName, fontsDir) {
  const upem = fontInstance.unitsPerEm;
  const scale = emPx / upem;

  // Measure cap height from '0' so TEXT_JUSTIFY_VCENTER centers capitals & digits with 0px vertical drift,
  // while keeping symmetric topPad/botPad large enough for Spanish accents (ÁÉÍÓÚÑ) above cap height!
  const gZero = fontInstance.glyphForCodePoint(48);
  const capEm = gZero.bbox ? gZero.bbox.maxY : 710;
  const capPx = Math.max(6, Math.round(capEm * scale));
  const vPad = Math.max(3, Math.ceil(emPx * 0.24) + 2);
  const lineHeight = capPx + vPad * 2;
  const baselineFromTop = vPad + capPx;

  // Fixed advance for digits if tabular
  const zeroAdvPx = Math.max(4, Math.round(gZero.advanceWidth * scale));

  const codePoints = Array.from(new Set(Array.from(charset).map((c) => c.codePointAt(0)))).sort((a, b) => a - b);

  // Prepare per-glyph metrics & SVG snippets
  const glyphItems = [];
  for (const cp of codePoints) {
    if (cp === 32) {
      const spAdv = Math.max(3, Math.round(emPx * 0.27));
      glyphItems.push({
        id: 32,
        isSpace: true,
        cellW: 0,
        cellH: 0,
        xoffset: 0,
        yoffset: 0,
        xadvance: spAdv
      });
      continue;
    }

    const glyph = fontInstance.glyphForCodePoint(cp);
    const isDigit = cp >= 48 && cp <= 57;
    const rawAdv = Math.max(3, Math.round(glyph.advanceWidth * scale));
    const xadvance = tabularDigits && isDigit ? zeroAdvPx : rawAdv;

    const bbox = glyph.bbox;
    if (!bbox || bbox.width <= 0 || bbox.height <= 0) {
      glyphItems.push({
        id: cp,
        isSpace: true,
        cellW: 0,
        cellH: 0,
        xoffset: 0,
        yoffset: 0,
        xadvance
      });
      continue;
    }

    const pad = 2;
    const minX = Math.floor(bbox.minX * scale) - pad;
    const maxX = Math.ceil(bbox.maxX * scale) + pad;
    const minY = Math.floor(-bbox.maxY * scale) - pad; // relative to baseline (up is negative)
    const maxY = Math.ceil(-bbox.minY * scale) + pad;

    const cellW = Math.max(1, maxX - minX);
    const cellH = Math.max(1, maxY - minY);

    // Center narrower digits (like '1') inside tabular advance width
    const tabularShift = tabularDigits && isDigit ? Math.round((zeroAdvPx - rawAdv) / 2) : 0;
    const xoffset = minX + tabularShift;
    const yoffset = Math.max(0, baselineFromTop + minY);

    glyphItems.push({
      id: cp,
      isSpace: false,
      svgPath: glyph.path.toSVG(),
      cellW,
      cellH,
      originX: -minX,
      originY: -minY,
      xoffset,
      yoffset,
      xadvance
    });
  }

  // Pack glyphs into power-of-2 atlas
  const maxTotalArea = glyphItems.reduce((acc, g) => acc + (g.cellW + 2) * (g.cellH + 2), 0);
  let atlasW = nextPow2(Math.max(64, Math.ceil(Math.sqrt(maxTotalArea * 1.35))));
  if (atlasW > 512) atlasW = 512;

  let penX = 1;
  let penY = 1;
  let rowH = 0;
  for (const g of glyphItems) {
    if (g.isSpace) {
      g.x = 0;
      g.y = 0;
      continue;
    }
    if (penX + g.cellW + 1 > atlasW) {
      penX = 1;
      penY += rowH + 2;
      rowH = 0;
    }
    g.x = penX;
    g.y = penY;
    penX += g.cellW + 2;
    if (g.cellH > rowH) rowH = g.cellH;
  }
  const atlasH = nextPow2(Math.max(32, penY + rowH + 2));

  // Build single crisp SVG for the entire font sheet (black background, white glyphs)
  let svgParts = [
    `<svg width="${atlasW}" height="${atlasH}" viewBox="0 0 ${atlasW} ${atlasH}" xmlns="http://www.w3.org/2000/svg" shape-rendering="geometricPrecision">`,
    `<rect x="0" y="0" width="${atlasW}" height="${atlasH}" fill="#000000"/>`
  ];
  for (const g of glyphItems) {
    if (g.isSpace) continue;
    const tx = g.x + g.originX;
    const ty = g.y + g.originY;
    svgParts.push(
      `<g transform="translate(${tx},${ty}) scale(${scale.toFixed(6)},${(-scale).toFixed(6)})">` +
        `<path d="${g.svgPath}" fill="#FFFFFF"/>` +
      `</g>`
    );
  }
  svgParts.push(`</svg>`);

  const pngFileName = `${baseName}_0.png`;
  const pngOutPath = path.join(fontsDir, pngFileName);

  const { data, info } = await sharp(Buffer.from(svgParts.join('')))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const processed = Buffer.alloc(info.width * info.height * 4);
  for (let i = 0; i < data.length; i += 4) {
    let v = data[i];
    if (!antialias) {
      v = v >= 108 ? 255 : 0;
    } else {
      // Slight crispness curve so small smartwatch glyphs stay razor sharp
      v = Math.min(255, Math.round(Math.pow(v / 255.0, 0.85) * 255));
    }
    processed[i] = v;
    processed[i + 1] = v;
    processed[i + 2] = v;
    processed[i + 3] = 255;
  }

  await sharp(processed, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(pngOutPath);

  // Write AngelCode .fnt file matching Garmin Connect IQ specification
  const fntLines = [
    `info face="Outfit" size=-${emPx} bold=1 italic=0 charset="" unicode=1 stretchH=100 smooth=1 aa=${antialias ? 1 : 0} padding=0,0,0,0 spacing=1,1 outline=0`,
    `common lineHeight=${lineHeight} base=${baselineFromTop} scaleW=${atlasW} scaleH=${atlasH} pages=1 packed=0 alphaChnl=1 redChnl=0 greenChnl=0 blueChnl=0`,
    `page id=0 file="${pngFileName}"`,
    `chars count=${glyphItems.length}`
  ];

  for (const g of glyphItems) {
    fntLines.push(
      `char id=${g.id} x=${g.x} y=${g.y} width=${g.cellW} height=${g.cellH} xoffset=${g.xoffset} yoffset=${g.yoffset} xadvance=${g.xadvance} page=0 chnl=15`
    );
  }

  fs.writeFileSync(path.join(fontsDir, `${baseName}.fnt`), fntLines.join('\n') + '\n', 'utf8');
}

async function main() {
  console.log('Generating Garmin Connect IQ BrandLogo + Outfit Bitmap Fonts for all 11 resolution buckets...');
  const baseFont = fontkit.create(fs.readFileSync(OUTFIT_TTF));
  const outfitBold = baseFont.variationAxes && baseFont.variationAxes.wght ? baseFont.getVariation({ wght: 740 }) : baseFont;
  const outfitExtraBold = baseFont.variationAxes && baseFont.variationAxes.wght ? baseFont.getVariation({ wght: 820 }) : baseFont;

  const masterLogo = await cropMasterLogo();
  const baseIconPath = path.join(GARMIN_DIR, 'resources/drawables/launcher_icon.png');
  const baseIconBuf = fs.readFileSync(baseIconPath);

  for (const b of BUCKETS) {
    const resDir = path.join(GARMIN_DIR, b.folder);
    const drawDir = path.join(resDir, 'drawables');
    const fontsDir = path.join(resDir, 'fonts');
    fs.mkdirSync(drawDir, { recursive: true });
    fs.mkdirSync(fontsDir, { recursive: true });

    // 1. Official ARCHERY 101010 Good Times + Geometric 101010 BrandLogo
    const lowBpp = b.dim <= 280 && !b.mono;
    await generateBrandLogoForBucket(masterLogo, path.join(drawDir, 'brand_logo.png'), b.dim, b.mono, lowBpp);

    // 2. Properly sized LauncherIcon for bucket
    await sharp(baseIconBuf)
      .resize(b.iconSize, b.iconSize, { kernel: sharp.kernel.lanczos3 })
      .png({ compressionLevel: 9 })
      .toFile(path.join(drawDir, 'launcher_icon.png'));

    // 3. Calibrated Outfit Bitmap Fonts (exact proportional sizes to b.dim)
    const microEm = Math.max(10, Math.round(b.dim * 0.045)); // 16px on 360, 11px on 240
    const labelEm = Math.max(12, Math.round(b.dim * 0.062)); // 22px on 360, 15px on 240
    const valueEm = Math.max(14, Math.round(b.dim * 0.080)); // 29px on 360, 19px on 240
    const heroEm = Math.max(26, Math.round(b.dim * 0.166));  // 60px on 360, 40px on 240

    await generateFontAtlas(outfitBold, CHARSET_FULL, microEm, b.antialias, false, 'outfit_micro', fontsDir);
    await generateFontAtlas(outfitExtraBold, CHARSET_FULL, labelEm, b.antialias, false, 'outfit_label', fontsDir);
    await generateFontAtlas(outfitExtraBold, CHARSET_FULL, valueEm, b.antialias, false, 'outfit_value', fontsDir);
    await generateFontAtlas(outfitExtraBold, CHARSET_HERO, heroEm, b.antialias, true, 'outfit_hero', fontsDir);

    // 4. drawables.xml & fonts.xml
    const drawXml = [
      `<drawables>`,
      `    <bitmap id="LauncherIcon" filename="launcher_icon.png" dithering="none" />`,
      `    <bitmap id="BrandLogo" filename="brand_logo.png" dithering="none" />`,
      `</drawables>`
    ].join('\n') + '\n';
    fs.writeFileSync(path.join(drawDir, 'drawables.xml'), drawXml, 'utf8');

    const aaAttr = b.antialias ? ` antialias="true"` : ``;
    const fontsXml = [
      `<fonts>`,
      `    <font id="OutfitMicro" filename="outfit_micro.fnt"${aaAttr} />`,
      `    <font id="OutfitLabel" filename="outfit_label.fnt"${aaAttr} />`,
      `    <font id="OutfitValue" filename="outfit_value.fnt"${aaAttr} />`,
      `    <font id="OutfitHero" filename="outfit_hero.fnt"${aaAttr} />`,
      `</fonts>`
    ].join('\n') + '\n';
    fs.writeFileSync(path.join(fontsDir, 'fonts.xml'), fontsXml, 'utf8');

    console.log(`  ✔ ${b.folder} (${b.dim}px): micro=${microEm}px, label=${labelEm}px, value=${valueEm}px, hero=${heroEm}px`);
  }

  // Update monkey.jungle so 1-bit monochrome Instinct 2 family uses resources-mono
  const jungle = [
    `project.manifest = manifest.xml`,
    `instinct2.resourcePath = $(instinct2.resourcePath);resources-mono`,
    `instinct2s.resourcePath = $(instinct2s.resourcePath);resources-mono`,
    `instinct2x.resourcePath = $(instinct2x.resourcePath);resources-mono`
  ].join('\n') + '\n';
  fs.writeFileSync(path.join(GARMIN_DIR, 'monkey.jungle'), jungle, 'utf8');

  console.log('Done generating all Garmin resources!');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
