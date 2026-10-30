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

// 5. Update android/app/build.gradle versionCode and versionName
const gradlePath = path.join(__dirname, '../android/app/build.gradle');
if (fs.existsSync(gradlePath)) {
  let gradleContent = fs.readFileSync(gradlePath, 'utf8');
  // Base 40000 ensures monotonic Android versionCode increase after resetting visible version to 2.0
  const vCode = 40000 + parts[1] * 100 + parts[2];
  gradleContent = gradleContent.replace(/versionCode\s+\d+/, `versionCode ${vCode}`);
  gradleContent = gradleContent.replace(/versionName\s+["'].*?["']/, `versionName "${displayVersion}"`);
  fs.writeFileSync(gradlePath, gradleContent, 'utf8');
  console.log(`Updated android/app/build.gradle with: versionCode ${vCode}, versionName "${displayVersion}"`);
}
