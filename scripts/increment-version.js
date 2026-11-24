const fs = require('fs');
const path = require('path');

// 1. Read package.json
const packageJsonPath = path.join(__dirname, '../package.json');
if (!fs.existsSync(packageJsonPath)) {
  console.error(`Error: package.json not found at ${packageJsonPath}`);
  process.exit(1);
}

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const currentVersion = packageJson.version;

// 2. Bump minor version (e.g., from 2.0.0 to 2.1.0)
const parts = currentVersion.split('.').map(Number);
if (parts.length === 3) {
  parts[1] += 1; // Increment minor
  parts[2] = 0;   // Reset patch
} else {
  console.warn("Invalid version format, defaulting to 2.0.0");
  parts[0] = 2;
  parts[1] = 0;
  parts[2] = 0;
}
const newVersion = parts.join('.');
const displayVersion = parts[2] === 0 ? `${parts[0]}.${parts[1]}` : newVersion;

packageJson.version = newVersion;
fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n', 'utf8');
console.log(`Bumped package.json version from ${currentVersion} to ${newVersion}`);

// 3. Write src/lib/version.ts
const versionTsPath = path.join(__dirname, '../src/lib/version.ts');
const versionTsDir = path.dirname(versionTsPath);
if (!fs.existsSync(versionTsDir)) {
  fs.mkdirSync(versionTsDir, { recursive: true });
}

fs.writeFileSync(versionTsPath, `export const APP_VERSION = "${displayVersion}";\n`, 'utf8');
console.log(`Updated src/lib/version.ts with: export const APP_VERSION = "${displayVersion}";`);

// 4. Update public/sw.js CACHE_NAME
const swPath = path.join(__dirname, '../public/sw.js');
if (fs.existsSync(swPath)) {
  let swContent = fs.readFileSync(swPath, 'utf8');
  const cacheRegex = /const\s+CACHE_NAME\s*=\s*["'`].*?["'`];/;
  if (cacheRegex.test(swContent)) {
    swContent = swContent.replace(cacheRegex, `const CACHE_NAME = "archery-101010-cache-v${displayVersion}";`);
    fs.writeFileSync(swPath, swContent, 'utf8');
    console.log(`Updated public/sw.js CACHE_NAME to: "archery-101010-cache-v${displayVersion}"`);
  } else {
    console.warn("Could not find CACHE_NAME definition in public/sw.js");
  }
} else {
  console.warn("public/sw.js not found, skipping cache name bump");
}

// 5. Update android/app/build.gradle and android/wear/build.gradle versionCode and versionName
const gradlePath = path.join(__dirname, '../android/app/build.gradle');
const vCode = 40000 + parts[1] * 100 + parts[2];
if (fs.existsSync(gradlePath)) {
  let gradleContent = fs.readFileSync(gradlePath, 'utf8');
  // Base 40000 ensures monotonic Android versionCode increase after resetting visible version to 2.0
  gradleContent = gradleContent.replace(/versionCode\s+\d+/, `versionCode ${vCode}`);
  gradleContent = gradleContent.replace(/versionName\s+["'].*?["']/, `versionName "${displayVersion}"`);
  fs.writeFileSync(gradlePath, gradleContent, 'utf8');
  console.log(`Updated android/app/build.gradle with: versionCode ${vCode}, versionName "${displayVersion}"`);
}
const wearGradlePath = path.join(__dirname, '../android/wear/build.gradle');
const wearVCode = 100000 + vCode;
if (fs.existsSync(wearGradlePath)) {
  let wearGradleContent = fs.readFileSync(wearGradlePath, 'utf8');
  wearGradleContent = wearGradleContent.replace(/versionCode\s+\d+/, `versionCode ${wearVCode}`);
  wearGradleContent = wearGradleContent.replace(/versionName\s+["'].*?["']/, `versionName "${displayVersion}"`);
  fs.writeFileSync(wearGradlePath, wearGradleContent, 'utf8');
  console.log(`Updated android/wear/build.gradle with: versionCode ${wearVCode}, versionName "${displayVersion}"`);
}

// 5b. Update garmin-ciq/manifest.xml version automatically alongside Mobile & Wear OS
const garminManifestPath = path.join(__dirname, '../garmin-ciq/manifest.xml');
if (fs.existsSync(garminManifestPath)) {
  let garminManifest = fs.readFileSync(garminManifestPath, 'utf8');
  garminManifest = garminManifest.replace(/^<\?xml\s+version=["'][^"']+["']\?>/, '<?xml version="1.0"?>');
  garminManifest = garminManifest.replace(/(<iq:application[^>]*?\bversion=["'])[0-9.]+(["'])/, `$1${newVersion}$2`);
  fs.writeFileSync(garminManifestPath, garminManifest, 'utf8');
  console.log(`Updated garmin-ciq/manifest.xml with: version="${newVersion}"`);
}

// 5c. Update iOS Xcode project (ios/App/App.xcodeproj/project.pbxproj) MARKETING_VERSION & CURRENT_PROJECT_VERSION
const iosPbxprojPath = path.join(__dirname, '../ios/App/App.xcodeproj/project.pbxproj');
if (fs.existsSync(iosPbxprojPath)) {
  let pbxContent = fs.readFileSync(iosPbxprojPath, 'utf8');
  pbxContent = pbxContent.replace(/MARKETING_VERSION\s*=\s*[^;]+;/g, `MARKETING_VERSION = ${displayVersion};`);
  pbxContent = pbxContent.replace(/CURRENT_PROJECT_VERSION\s*=\s*[^;]+;/g, `CURRENT_PROJECT_VERSION = ${vCode};`);
  fs.writeFileSync(iosPbxprojPath, pbxContent, 'utf8');
  console.log(`Updated ios/App/App.xcodeproj/project.pbxproj with: MARKETING_VERSION = ${displayVersion}, CURRENT_PROJECT_VERSION = ${vCode}`);
}

// 5d. Update watchOS companion Info.plist (ios-watchos/WatchApp/Info.plist) CFBundleShortVersionString & CFBundleVersion
const watchInfoPlistPath = path.join(__dirname, '../ios-watchos/WatchApp/Info.plist');
if (fs.existsSync(watchInfoPlistPath)) {
  let watchPlist = fs.readFileSync(watchInfoPlistPath, 'utf8');
  watchPlist = watchPlist.replace(
    /(<key>CFBundleShortVersionString<\/key>\s*<string>)[^<]*(<\/string>)/,
    `$1${displayVersion}$2`
  );
  watchPlist = watchPlist.replace(
    /(<key>CFBundleVersion<\/key>\s*<string>)[^<]*(<\/string>)/,
    `$1${wearVCode}$2`
  );
  fs.writeFileSync(watchInfoPlistPath, watchPlist, 'utf8');
  console.log(`Updated ios-watchos/WatchApp/Info.plist with: CFBundleShortVersionString "${displayVersion}", CFBundleVersion "${wearVCode}"`);
}

// 6. Write public/ota-version.json (and ios/App/App/public/ota-version.json if present) with the live version
// for all modern Google Play, App Store & Web clients (v2.110+), while keeping legacy public/version.json &
// public/app-version.json at "0.0.0" so old v2.100 shells never freeze or jump to external browser.
const otaVersionJsonPath = path.join(__dirname, '../public/ota-version.json');
const appVersionJsonPath = path.join(__dirname, '../public/app-version.json');
const versionJsonPath = path.join(__dirname, '../public/version.json');
const nowIso = new Date().toISOString();
const otaPayload = {
  version: displayVersion,
  latestVersion: displayVersion,
  fullVersion: newVersion,
  versionCode: vCode,
  updatedAt: nowIso
};
const disarmedLegacyPayload = {
  version: '0.0.0',
  latestVersion: displayVersion,
  fullVersion: newVersion,
  versionCode: vCode,
  updatedAt: nowIso
};
fs.writeFileSync(otaVersionJsonPath, JSON.stringify(otaPayload, null, 2) + '\n', 'utf8');
fs.writeFileSync(appVersionJsonPath, JSON.stringify(disarmedLegacyPayload, null, 2) + '\n', 'utf8');
fs.writeFileSync(versionJsonPath, JSON.stringify(disarmedLegacyPayload, null, 2) + '\n', 'utf8');
console.log(`Updated public/ota-version.json for v${displayVersion} (versionCode ${vCode}) and silenced legacy v2.100 manifest`);

const iosOtaVersionJsonPath = path.join(__dirname, '../ios/App/App/public/ota-version.json');
if (fs.existsSync(iosOtaVersionJsonPath)) {
  fs.writeFileSync(iosOtaVersionJsonPath, JSON.stringify(otaPayload, null, 2) + '\n', 'utf8');
  console.log(`Updated ios/App/App/public/ota-version.json for v${displayVersion} (versionCode ${vCode})`);
}
const iosAppVersionJsonPath = path.join(__dirname, '../ios/App/App/public/app-version.json');
if (fs.existsSync(iosAppVersionJsonPath)) {
  fs.writeFileSync(iosAppVersionJsonPath, JSON.stringify(disarmedLegacyPayload, null, 2) + '\n', 'utf8');
}
const iosVersionJsonPath = path.join(__dirname, '../ios/App/App/public/version.json');
if (fs.existsSync(iosVersionJsonPath)) {
  fs.writeFileSync(iosVersionJsonPath, JSON.stringify(disarmedLegacyPayload, null, 2) + '\n', 'utf8');
}

// 7. Keep firebase.json .aab headers & Android-safe .firebaseapp.com download redirects synchronized
//    while strictly preserving Coach Rodrigo's PDF attachment headers and CSP rules intact!
const firebaseJsonPath = path.join(__dirname, '../firebase.json');
if (fs.existsSync(firebaseJsonPath)) {
  let fbContent = fs.readFileSync(firebaseJsonPath, 'utf8');
  fbContent = fbContent.replace(/Archery101010-Mobile-v\d+\.\d+(?:\.\d+)?\.aab/g, `Archery101010-Mobile-v${displayVersion}.aab`);
  fbContent = fbContent.replace(/Archery101010-WearOS-v\d+\.\d+(?:\.\d+)?\.aab/g, `Archery101010-WearOS-v${displayVersion}.aab`);
  if (
    !fbContent.includes('/Plan-Asesoria-Coach-Rodrigo-Saborio-Archery101010.pdf') ||
    !fbContent.includes('/Plan-Asesoria-Documento-Coach-Rodrigo-Saborio-Archery101010.pdf')
  ) {
    console.error('Error: Coach Rodrigo PDF headers missing in firebase.json! Aborting firebase.json write.');
    process.exit(1);
  }
  fs.writeFileSync(firebaseJsonPath, fbContent, 'utf8');
  console.log(`Synchronized firebase.json .aab download endpoints to v${displayVersion} (Coach Rodrigo PDF headers intact)`);
}

// 8. Keep DOCUMENTACION_COMPLETA.md and public/manual/index.html version banners synchronized
const docsPath = path.join(__dirname, '../DOCUMENTACION_COMPLETA.md');
if (fs.existsSync(docsPath)) {
  let docsContent = fs.readFileSync(docsPath, 'utf8');
  docsContent = docsContent.replace(/Versión Actual:\s*v\d+\.\d+(?:\.\d+)?/g, `Versión Actual: v${displayVersion}`);
  fs.writeFileSync(docsPath, docsContent, 'utf8');
  console.log(`Synchronized DOCUMENTACION_COMPLETA.md banner to v${displayVersion}`);
}
const manualHtmlPath = path.join(__dirname, '../public/manual/index.html');
if (fs.existsSync(manualHtmlPath)) {
  let manualHtml = fs.readFileSync(manualHtmlPath, 'utf8');
  manualHtml = manualHtml.replace(/Manual\s+v\d+\.\d+(?:\.\d+)?/g, `Manual v${displayVersion}`);
  manualHtml = manualHtml.replace(/v\d+\.\d+(?:\.\d+)?\s*—\s*Manual de Usuario/g, `v${displayVersion} — Manual de Usuario`);
  fs.writeFileSync(manualHtmlPath, manualHtml, 'utf8');
  console.log(`Synchronized public/manual/index.html badges to v${displayVersion}`);
}
