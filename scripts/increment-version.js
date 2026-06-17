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

// 2. Bump minor version (e.g., from 2.3.0 to 2.4.0)
const parts = currentVersion.split('.').map(Number);
if (parts.length === 3) {
  parts[1] += 1; // Increment minor
  parts[2] = 0;   // Reset patch
} else {
  console.warn("Invalid version format, defaulting to 2.4.0");
  parts[0] = 2;
  parts[1] = 4;
  parts[2] = 0;
}
const newVersion = parts.join('.');

packageJson.version = newVersion;
fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n', 'utf8');
console.log(`Bumped package.json version from ${currentVersion} to ${newVersion}`);

// 3. Write src/lib/version.ts
const versionTsPath = path.join(__dirname, '../src/lib/version.ts');
const versionTsDir = path.dirname(versionTsPath);
if (!fs.existsSync(versionTsDir)) {
  fs.mkdirSync(versionTsDir, { recursive: true });
}

fs.writeFileSync(versionTsPath, `export const APP_VERSION = "${newVersion}";\n`, 'utf8');
console.log(`Updated src/lib/version.ts with: export const APP_VERSION = "${newVersion}";`);

// 4. Update public/sw.js cache name
const swJsPath = path.join(__dirname, '../public/sw.js');
if (fs.existsSync(swJsPath)) {
  let swContent = fs.readFileSync(swJsPath, 'utf8');
  const cacheNameRegex = /const CACHE_NAME = "archery-101010-cache-v[^"]+";/;
  const newCacheName = `const CACHE_NAME = "archery-101010-cache-v${newVersion}";`;
  if (cacheNameRegex.test(swContent)) {
    swContent = swContent.replace(cacheNameRegex, newCacheName);
    fs.writeFileSync(swJsPath, swContent, 'utf8');
    console.log(`Updated public/sw.js with CACHE_NAME: ${newCacheName}`);
  } else {
    console.warn("Warning: CACHE_NAME pattern not found in public/sw.js");
  }
} else {
  console.warn("Warning: public/sw.js not found, skipping cache name update");
}
