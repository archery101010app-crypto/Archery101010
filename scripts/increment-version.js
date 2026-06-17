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

// 4. Update public/sw.js CACHE_NAME
const swPath = path.join(__dirname, '../public/sw.js');
if (fs.existsSync(swPath)) {
  let swContent = fs.readFileSync(swPath, 'utf8');
  const cacheRegex = /const\s+CACHE_NAME\s*=\s*["'`].*?["'`];/;
  if (cacheRegex.test(swContent)) {
    swContent = swContent.replace(cacheRegex, `const CACHE_NAME = "archery-101010-cache-v${newVersion}";`);
    fs.writeFileSync(swPath, swContent, 'utf8');
    console.log(`Updated public/sw.js CACHE_NAME to: "archery-101010-cache-v${newVersion}"`);
  } else {
    console.warn("Could not find CACHE_NAME definition in public/sw.js");
  }
} else {
  console.warn("public/sw.js not found, skipping cache name bump");
}
