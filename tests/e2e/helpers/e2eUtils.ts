import fs from "node:fs";
import path from "node:path";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";

export const REPO_ROOT = process.cwd();

export const FORBIDDEN_TRADEMARKS = [
  "Strava",
  "Spotify",
  "WHOOP",
  "Garmin",
  "Apple Watch",
  "Nike",
  "Instagram",
  "Facebook"
] as const;

export interface FntParseResult {
  filePath: string;
  declaredCount: number;
  charIds: number[];
  hasPercentGlyph: boolean;
}

export interface ZipEntryInfo {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
  compressionMethod: number;
}

export interface SubprocessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export function repoPath(...segments: string[]): string {
  return path.join(REPO_ROOT, ...segments);
}

export function readRepoText(...segments: string[]): string {
  return fs.readFileSync(repoPath(...segments), "utf8");
}

export function readRepoJson<T = Record<string, unknown>>(...segments: string[]): T {
  return JSON.parse(readRepoText(...segments)) as T;
}

export function repoFileExists(...segments: string[]): boolean {
  return fs.existsSync(repoPath(...segments));
}

export function readAppVersion(): string {
  const content = readRepoText("src", "lib", "version.ts");
  const match = content.match(/APP_VERSION\s*=\s*["']([^"']+)["']/);
  if (!match) {
    throw new Error("Could not parse APP_VERSION from src/lib/version.ts");
  }
  return match[1];
}

export function parseExpectedVersionCodes(appVersion: string): {
  fullVersion: string;
  mobileVersionCode: number;
  wearVersionCode: number;
} {
  const parts = appVersion.split(".").map(Number);
  const major = parts[0] ?? 2;
  const minor = parts[1] ?? 0;
  const patch = parts[2] ?? 0;
  const fullVersion = `${major}.${minor}.${patch}`;
  const mobileVersionCode = 40000 + minor * 100 + patch;
  const wearVersionCode = 100000 + mobileVersionCode;
  return { fullVersion, mobileVersionCode, wearVersionCode };
}

export function parseBitmapFont(relSegments: string[]): FntParseResult {
  const filePath = repoPath(...relSegments);
  const raw = fs.readFileSync(filePath, "utf8");
  const countMatch = raw.match(/chars\s+count=(\d+)/);
  const declaredCount = countMatch ? Number(countMatch[1]) : 0;
  const charIds: number[] = [];
  let hasPercentGlyph = false;
  for (const match of raw.matchAll(/^char\s+([^\r\n]+)$/gm)) {
    const line = match[1];
    const idMatch = line.match(/\bid=(\d+)/);
    if (!idMatch) continue;
    const id = Number(idMatch[1]);
    charIds.push(id);
    if (id === 37) {
      const wMatch = line.match(/\bwidth=(\d+)/);
      const hMatch = line.match(/\bheight=(\d+)/);
      const width = wMatch ? Number(wMatch[1]) : 0;
      const height = hMatch ? Number(hMatch[1]) : 0;
      if (width > 0 && height > 0) {
        hasPercentGlyph = true;
      }
    }
  }
  return {
    filePath,
    declaredCount,
    charIds,
    hasPercentGlyph
  };
}

export interface IqPackageInfo {
  filePath: string;
  byteLength: number;
  isSevenZip: boolean;
  isZip: boolean;
  hasManifestXml: boolean;
  prgEntries: string[];
}

export function readIqPackageInfo(absIqPath: string): IqPackageInfo {
  const buf = fs.readFileSync(absIqPath);
  const isSevenZip =
    buf.length >= 6 &&
    buf[0] === 0x37 &&
    buf[1] === 0x7a &&
    buf[2] === 0xbc &&
    buf[3] === 0xaf &&
    buf[4] === 0x27 &&
    buf[5] === 0x1c;
  const isZip = buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;

  if (!isSevenZip && !isZip) {
    throw new Error(`Invalid .iq archive magic bytes (expected 7z or ZIP): ${absIqPath}`);
  }

  if (isZip) {
    const entries = readZipEntries(absIqPath);
    const prgEntries = entries.map((e) => e.name).filter((n) => n.toLowerCase().endsWith(".prg"));
    const hasManifestXml = entries.some((e) => e.name.toLowerCase().endsWith("manifest.xml"));
    return {
      filePath: absIqPath,
      byteLength: buf.length,
      isSevenZip: false,
      isZip: true,
      hasManifestXml,
      prgEntries
    };
  }

  // Validate 7z signature header (32 bytes) and NextHeader bounds before decoding header metadata
  if (buf.length < 32) {
    throw new Error(`Invalid 7z .iq archive (header < 32 bytes): ${absIqPath}`);
  }
  const nextHeaderOffset = buf.readBigUInt64LE(12);
  const nextHeaderSize = buf.readBigUInt64LE(20);
  const headerStart = BigInt(32) + nextHeaderOffset;
  const headerEnd = headerStart + nextHeaderSize;
  if (nextHeaderSize <= BigInt(0) || headerEnd > BigInt(buf.length)) {
    throw new Error(
      `Corrupt 7z .iq header bounds (nextHeaderOffset=${nextHeaderOffset}, nextHeaderSize=${nextHeaderSize}, byteLength=${buf.length}): ${absIqPath}`
    );
  }

  const headerWindow = buf.subarray(Number(headerStart), Number(headerEnd)).toString("utf16le");
  const prgEntries = headerWindow.match(/[A-Za-z0-9_.-]+\.prg/gi) ?? [];
  const hasManifestXml = /manifest\.xml/i.test(headerWindow);
  return {
    filePath: absIqPath,
    byteLength: buf.length,
    isSevenZip: true,
    isZip: false,
    hasManifestXml,
    prgEntries
  };
}

/**
 * Pure Node.js ZIP End-of-Central-Directory + Central Directory parser (supports .aab / .zip inspection).
 */
export function readZipEntries(absZipPath: string): ZipEntryInfo[] {
  const buf = fs.readFileSync(absZipPath);
  // Locate EOCD signature 0x06054b50 from the end of file
  let eocdOffset = -1;
  const minStart = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= minStart; i--) {
    if (
      buf[i] === 0x50 &&
      buf[i + 1] === 0x4b &&
      buf[i + 2] === 0x05 &&
      buf[i + 3] === 0x06
    ) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) {
    throw new Error(`Invalid ZIP archive (EOCD signature missing): ${absZipPath}`);
  }

  const totalEntries = buf.readUInt16LE(eocdOffset + 10);
  const cdOffset = buf.readUInt32LE(eocdOffset + 16);
  const entries: ZipEntryInfo[] = [];

  let cursor = cdOffset;
  for (let idx = 0; idx < totalEntries; idx++) {
    if (cursor + 46 > buf.length || buf.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error(`Corrupt ZIP central directory entry at offset ${cursor} in ${absZipPath}`);
    }
    const compressionMethod = buf.readUInt16LE(cursor + 10);
    const compressedSize = buf.readUInt32LE(cursor + 20);
    const uncompressedSize = buf.readUInt32LE(cursor + 24);
    const nameLen = buf.readUInt16LE(cursor + 28);
    const extraLen = buf.readUInt16LE(cursor + 30);
    const commentLen = buf.readUInt16LE(cursor + 32);
    const name = buf.subarray(cursor + 46, cursor + 46 + nameLen).toString("utf8");
    entries.push({
      name,
      compressedSize,
      uncompressedSize,
      compressionMethod
    });
    cursor += 46 + nameLen + extraLen + commentLen;
  }

  return entries;
}

export function findTrademarkViolations(
  text: string,
  brands: readonly string[] = FORBIDDEN_TRADEMARKS
): Array<{ brand: string; snippet: string }> {
  const hits: Array<{ brand: string; snippet: string }> = [];
  for (const brand of brands) {
    const escaped = brand
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\s+/g, "\\s+");
    const re = new RegExp(`\\b${escaped}\\b`, "i");
    const match = re.exec(text);
    if (match) {
      const start = Math.max(0, match.index - 24);
      const end = Math.min(text.length, match.index + match[0].length + 24);
      hits.push({ brand, snippet: text.slice(start, end).replace(/\s+/g, " ").trim() });
    }
  }
  return hits;
}

export function extractBracedBlock(source: string, headerPattern: RegExp): string | null {
  const match = headerPattern.exec(source);
  if (!match) return null;
  const searchFrom = match[0].endsWith("{")
    ? match.index + match[0].length - 1
    : match.index + match[0].length;
  const openIdx = source.indexOf("{", searchFrom);
  if (openIdx === -1) return null;
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let inLineComment = false;
  let inBlockComment = false;
  for (let i = openIdx; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];
    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inSingle) {
      if (ch === "\\") i++;
      else if (ch === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (ch === "\\") i++;
      else if (ch === '"') inDouble = false;
      continue;
    }
    if (inTemplate) {
      if (ch === "\\") i++;
      else if (ch === "`") inTemplate = false;
      continue;
    }
    if (ch === "/" && next === "/") {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i++;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (ch === "`") {
      inTemplate = true;
      continue;
    }
    if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return source.slice(match.index, i + 1);
      }
    }
  }
  return null;
}

export function extractParenCallBlocks(source: string, callPattern: RegExp): string[] {
  const results: string[] = [];
  const globalRe = new RegExp(
    callPattern.source,
    callPattern.flags.includes("g") ? callPattern.flags : `${callPattern.flags}g`
  );
  let match: RegExpExecArray | null;
  while ((match = globalRe.exec(source)) !== null) {
    const openIdx = source.indexOf("(", match.index);
    if (openIdx === -1) continue;
    let depth = 0;
    let inSingle = false;
    let inDouble = false;
    let inTemplate = false;
    let inLineComment = false;
    let inBlockComment = false;
    for (let i = openIdx; i < source.length; i++) {
      const ch = source[i];
      const next = source[i + 1];
      if (inLineComment) {
        if (ch === "\n") inLineComment = false;
        continue;
      }
      if (inBlockComment) {
        if (ch === "*" && next === "/") {
          inBlockComment = false;
          i++;
        }
        continue;
      }
      if (inSingle) {
        if (ch === "\\") i++;
        else if (ch === "'") inSingle = false;
        continue;
      }
      if (inDouble) {
        if (ch === "\\") i++;
        else if (ch === '"') inDouble = false;
        continue;
      }
      if (inTemplate) {
        if (ch === "\\") i++;
        else if (ch === "`") inTemplate = false;
        continue;
      }
      if (ch === "/" && next === "/") {
        inLineComment = true;
        i++;
        continue;
      }
      if (ch === "/" && next === "*") {
        inBlockComment = true;
        i++;
        continue;
      }
      if (ch === "'") {
        inSingle = true;
        continue;
      }
      if (ch === '"') {
        inDouble = true;
        continue;
      }
      if (ch === "`") {
        inTemplate = true;
        continue;
      }
      if (ch === "(") {
        depth++;
      } else if (ch === ")") {
        depth--;
        if (depth === 0) {
          results.push(source.slice(match.index, i + 1));
          break;
        }
      }
    }
  }
  return results;
}

export function listAllFilesRecursive(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) return [];
  const results: string[] = [];
  const stack = [dirPath];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        results.push(full);
      }
    }
  }
  return results;
}

export function getGarminSdkMonkeyCBatPath(): string | null {
  const appData = process.env.APPDATA;
  if (!appData) return null;
  const cfgPath = path.join(appData, "Garmin", "ConnectIQ", "current-sdk.cfg");
  if (fs.existsSync(cfgPath)) {
    const sdkRoot = fs.readFileSync(cfgPath, "utf8").trim();
    const bat = path.join(sdkRoot, "bin", "monkeyc.bat");
    if (fs.existsSync(bat)) return bat;
  }
  const sdksDir = path.join(appData, "Garmin", "ConnectIQ", "Sdks");
  if (!fs.existsSync(sdksDir)) return null;
  for (const dir of fs.readdirSync(sdksDir)) {
    const bat = path.join(sdksDir, dir, "bin", "monkeyc.bat");
    if (fs.existsSync(bat)) return bat;
  }
  return null;
}

export function runCommandSync(
  command: string,
  args: string[],
  cwd: string = REPO_ROOT,
  timeoutMs = 180_000
): SubprocessResult {
  const res: SpawnSyncReturns<string> = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout: timeoutMs,
    windowsHide: true,
    shell: process.platform === "win32" && command.endsWith(".bat")
  });
  return {
    exitCode: res.status ?? (res.error ? 1 : 0),
    stdout: res.stdout ?? "",
    stderr: (res.stderr ?? "") + (res.error ? `\n${res.error.message}` : "")
  };
}

/**
 * Browser-side script string for CDP `evaluate()` that checks visible DOM nodes for:
 * 1. `text-overflow: ellipsis` or `truncate` / `line-clamp-*` class on visible elements
 * 2. Visible text ending in `...` or `…` (except legitimate transient loading/status phrases)
 * 3. Horizontal or vertical clipping where `scrollWidth > clientWidth + 3` or `scrollHeight > clientHeight + 3`
 *    with `overflow: hidden` on text-bearing elements (including elements with icon children)
 * 4. Horizontal document overflow beyond viewport width
 */
export const CDP_NO_TRUNCATION_AUDIT_SCRIPT = `(() => {
  const vw = window.innerWidth;
  const docOverflow = document.documentElement.scrollWidth > vw + 2;
  const ellipsisElements = [];
  const clippedElements = [];
  const literalEllipsisTexts = [];
  const loadingHintRe = /^(Cargando|Loading|Preparando|Preparing|Sincronizando|Syncing|Conectando|Connecting)\\b.*\\.\\.\\.$/i;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  let node;
  while ((node = walker.nextNode())) {
    const el = node;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      continue;
    }
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;

    const cls = typeof el.className === "string" ? el.className : "";
    if (/\\bsr-only\\b/.test(cls)) continue;
    const text = (el.innerText || "").trim();
    if (!text) continue;

    if (style.textOverflow === "ellipsis" || /\\b(truncate|line-clamp-\\d+)\\b/.test(cls)) {
      ellipsisElements.push({ tag: el.tagName, cls: cls.slice(0, 80), text: text.slice(0, 60) });
    }

    const directText = Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3)
      .map((n) => (n.textContent || "").trim())
      .filter(Boolean)
      .join(" ");
    const isTextBearing = el.children.length === 0 || directText.length > 0;
    const textToAudit = el.children.length === 0 ? text : directText;

    const isScrollableX = style.overflowX === "auto" || style.overflowX === "scroll";
    const isScrollableY = style.overflowY === "auto" || style.overflowY === "scroll";
    const horizClipped =
      !isScrollableX &&
      (style.overflowX === "hidden" || style.overflow === "hidden") &&
      el.clientWidth > 0 &&
      el.scrollWidth > el.clientWidth + 3;
    const vertClipped =
      !isScrollableY &&
      (style.overflowY === "hidden" || style.overflow === "hidden") &&
      el.clientHeight > 0 &&
      el.scrollHeight > el.clientHeight + 3;

    if (isTextBearing && (horizClipped || vertClipped)) {
      clippedElements.push({
        tag: el.tagName,
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        text: textToAudit.slice(0, 60)
      });
    }

    if (
      isTextBearing &&
      (textToAudit.endsWith("...") || textToAudit.endsWith("…")) &&
      !loadingHintRe.test(textToAudit)
    ) {
      literalEllipsisTexts.push({ tag: el.tagName, text: textToAudit.slice(0, 80) });
    }
  }
  return { vw, docOverflow, ellipsisElements, clippedElements, literalEllipsisTexts };
})()`;
