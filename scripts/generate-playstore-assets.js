const fs = require('fs');
const path = require('path');
const { Jimp } = require('jimp');

async function main() {
  console.log('🚀 Generating Google Play Store & Android App Icons...');

  const rootDir = path.resolve(__dirname, '..');
  const googlePlayDir = path.join(rootDir, 'android', 'google_play');
  if (!fs.existsSync(googlePlayDir)) {
    fs.mkdirSync(googlePlayDir, { recursive: true });
  }

  const icon512Path = path.join(rootDir, 'public', 'icon-512.png');
  const logoFinalPath = path.join(rootDir, 'public', 'images', 'logo_final.png');

  // 1. Google Play Store Icon (512x512)
  const storeIcon = await Jimp.read(icon512Path);
  storeIcon.resize({ w: 512, h: 512 });
  const storeIconTarget = path.join(googlePlayDir, 'store_icon_512.png');
  await storeIcon.write(storeIconTarget);
  console.log('✅ Created:', storeIconTarget);

  // 2. Google Play Feature Graphic (1024x500)
  const featureGraphic = new Jimp({ width: 1024, height: 500, color: 0x050505ff });
  const logoForBanner = await Jimp.read(logoFinalPath);
  const targetLogoWidth = 520;
  const targetLogoHeight = Math.round(targetLogoWidth * (logoForBanner.height / logoForBanner.width));
  logoForBanner.resize({ w: targetLogoWidth, h: targetLogoHeight });

  const logoX = Math.round((1024 - targetLogoWidth) / 2);
  const logoY = Math.round((500 - targetLogoHeight) / 2);
  featureGraphic.composite(logoForBanner, logoX, logoY);

  const featureGraphicTarget = path.join(googlePlayDir, 'feature_graphic_1024x500.png');
  await featureGraphic.write(featureGraphicTarget);
  console.log('✅ Created:', featureGraphicTarget);

  // 3. Android Mipmap Adaptive & Legacy Icons
  const buckets = [
    { name: 'mipmap-mdpi', iconSize: 48, fgSize: 108 },
    { name: 'mipmap-hdpi', iconSize: 72, fgSize: 162 },
    { name: 'mipmap-xhdpi', iconSize: 96, fgSize: 216 },
    { name: 'mipmap-xxhdpi', iconSize: 144, fgSize: 324 },
    { name: 'mipmap-xxxhdpi', iconSize: 192, fgSize: 432 }
  ];

  for (const b of buckets) {
    const dir = path.join(rootDir, 'android', 'app', 'src', 'main', 'res', b.name);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // ic_launcher.png (Legacy square icon with black background)
    const legacyIcon = await Jimp.read(icon512Path);
    legacyIcon.resize({ w: b.iconSize, h: b.iconSize });
    await legacyIcon.write(path.join(dir, 'ic_launcher.png'));

    // ic_launcher_round.png (Legacy round icon)
    const roundIcon = await Jimp.read(icon512Path);
    roundIcon.resize({ w: b.iconSize, h: b.iconSize });
    await roundIcon.write(path.join(dir, 'ic_launcher_round.png'));

    // ic_launcher_foreground.png (Adaptive icon foreground with safe margins)
    const fgCanvas = new Jimp({ width: b.fgSize, height: b.fgSize, color: 0x00000000 });
    const logoFg = await Jimp.read(logoFinalPath);
    // Safe zone is inner 66% of the 108dp canvas
    const safeW = Math.round(b.fgSize * 0.65);
    const safeH = Math.round(safeW * (logoFg.height / logoFg.width));
    logoFg.resize({ w: safeW, h: safeH });
    const fgX = Math.round((b.fgSize - safeW) / 2);
    const fgY = Math.round((b.fgSize - safeH) / 2);
    fgCanvas.composite(logoFg, fgX, fgY);
    await fgCanvas.write(path.join(dir, 'ic_launcher_foreground.png'));

    console.log(`✅ Updated ${b.name}: ic_launcher (${b.iconSize}px), ic_launcher_foreground (${b.fgSize}px)`);
  }

  console.log('🎉 All Android and Google Play assets generated successfully!');
}

main().catch((err) => {
  console.error('❌ Error generating assets:', err);
  process.exit(1);
});
