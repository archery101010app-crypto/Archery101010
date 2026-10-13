const { Jimp } = require('jimp');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const LOGO_PATH = path.join(ROOT_DIR, 'public', 'images', 'logo_final.png');
const RES_DIR = path.join(ROOT_DIR, 'android', 'app', 'src', 'main', 'res');

const ICON_SIZES = {
  'mipmap-mdpi': { icon: 48, foreground: 108 },
  'mipmap-hdpi': { icon: 72, foreground: 162 },
  'mipmap-xhdpi': { icon: 96, foreground: 216 },
  'mipmap-xxhdpi': { icon: 144, foreground: 324 },
  'mipmap-xxxhdpi': { icon: 192, foreground: 432 }
};

const SPLASH_SIZES = [
  { folder: 'drawable', w: 480, h: 800 },
  { folder: 'drawable-port-mdpi', w: 320, h: 480 },
  { folder: 'drawable-port-hdpi', w: 480, h: 800 },
  { folder: 'drawable-port-xhdpi', w: 720, h: 1280 },
  { folder: 'drawable-port-xxhdpi', w: 960, h: 1600 },
  { folder: 'drawable-port-xxxhdpi', w: 1280, h: 1920 },
  { folder: 'drawable-land-mdpi', w: 480, h: 320 },
  { folder: 'drawable-land-hdpi', w: 800, h: 480 },
  { folder: 'drawable-land-xhdpi', w: 1280, h: 720 },
  { folder: 'drawable-land-xxhdpi', w: 1600, h: 960 },
  { folder: 'drawable-land-xxxhdpi', w: 1920, h: 1280 }
];

async function generateAssets() {
  console.log('--- Generando Activos Nativos de Archery 101010 ---');
  const sourceLogo = await Jimp.read(LOGO_PATH);

  // 1. Generate PWA and Store Icons
  console.log('1. Generando iconos base para PWA y Google Play (512x512 y 192x192)...');
  const storeIcon512 = new Jimp({ width: 512, height: 512, color: 0x050505ff });
  const logo512 = sourceLogo.clone();
  logo512.resize({ w: 340 });
  storeIcon512.composite(logo512, Math.round((512 - logo512.bitmap.width) / 2), Math.round((512 - logo512.bitmap.height) / 2));
  await storeIcon512.write(path.join(ROOT_DIR, 'public', 'icon-512.png'));

  const pwaIcon192 = new Jimp({ width: 192, height: 192, color: 0x050505ff });
  const logo192 = sourceLogo.clone();
  logo192.resize({ w: 130 });
  pwaIcon192.composite(logo192, Math.round((192 - logo192.bitmap.width) / 2), Math.round((192 - logo192.bitmap.height) / 2));
  await pwaIcon192.write(path.join(ROOT_DIR, 'public', 'icon-192.png'));

  // 2. Generate Android Mipmap Icons
  console.log('2. Generando iconos mipmap para Android (ic_launcher, ic_launcher_round, ic_launcher_foreground)...');
  for (const [folder, sizes] of Object.entries(ICON_SIZES)) {
    const targetDir = path.join(RES_DIR, folder);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    // Standard Icon (OLED Black background)
    const icon = new Jimp({ width: sizes.icon, height: sizes.icon, color: 0x050505ff });
    const resizedLogo = sourceLogo.clone();
    resizedLogo.resize({ w: Math.round(sizes.icon * 0.72) });
    const x = Math.round((sizes.icon - resizedLogo.bitmap.width) / 2);
    const y = Math.round((sizes.icon - resizedLogo.bitmap.height) / 2);
    icon.composite(resizedLogo, x, y);

    await icon.write(path.join(targetDir, 'ic_launcher.png'));
    await icon.write(path.join(targetDir, 'ic_launcher_round.png'));

    // Adaptive Foreground (Transparent background, safe zone ~65%)
    const fg = new Jimp({ width: sizes.foreground, height: sizes.foreground, color: 0x00000000 });
    const resizedFgLogo = sourceLogo.clone();
    resizedFgLogo.resize({ w: Math.round(sizes.foreground * 0.65) });
    const fgX = Math.round((sizes.foreground - resizedFgLogo.bitmap.width) / 2);
    const fgY = Math.round((sizes.foreground - resizedFgLogo.bitmap.height) / 2);
    fg.composite(resizedFgLogo, fgX, fgY);

    await fg.write(path.join(targetDir, 'ic_launcher_foreground.png'));
    console.log(`   ✓ ${folder} completado`);
  }

  // 3. Update ic_launcher_background color resource to OLED #050505
  console.log('3. Actualizando ic_launcher_background.xml a #050505...');
  const bgXmlPath = path.join(RES_DIR, 'values', 'ic_launcher_background.xml');
  const bgXmlContent = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#050505</color>
</resources>
`;
  fs.writeFileSync(bgXmlPath, bgXmlContent, 'utf8');

  // 4. Generate Android Splash Screens
  console.log('4. Generando Splash Screens en todos los formatos...');
  for (const splash of SPLASH_SIZES) {
    const targetDir = path.join(RES_DIR, splash.folder);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const splashImg = new Jimp({ width: splash.w, height: splash.h, color: 0x050505ff });
    const splashLogo = sourceLogo.clone();
    // Logo should occupy about 50% of the screen width or 200px minimum
    const maxLogoW = Math.min(Math.round(splash.w * 0.55), 600);
    splashLogo.resize({ w: maxLogoW });
    const sX = Math.round((splash.w - splashLogo.bitmap.width) / 2);
    const sY = Math.round((splash.h - splashLogo.bitmap.height) / 2);
    splashImg.composite(splashLogo, sX, sY);

    await splashImg.write(path.join(targetDir, 'splash.png'));
    console.log(`   ✓ ${splash.folder}/splash.png (${splash.w}x${splash.h})`);
  }

  console.log('\n✅ ¡Todos los iconos y Splash Screens generados con éxito!');
}

generateAssets().catch((err) => {
  console.error('Error generando activos:', err);
  process.exit(1);
});
