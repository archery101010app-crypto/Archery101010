import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import type { Socket } from "node:net";

export interface FirebaseHeaderRule {
  source?: string;
  regex?: string;
  headers: Array<{ key: string; value: string }>;
}

export interface FirebaseRedirectRule {
  source?: string;
  regex?: string;
  destination: string;
  type?: number;
}

export interface FirebaseRewriteRule {
  source?: string;
  regex?: string;
  destination?: string;
}

export interface FirebaseHostingConfig {
  public?: string;
  ignore?: string[];
  cleanUrls?: boolean;
  trailingSlash?: boolean;
  headers?: FirebaseHeaderRule[];
  redirects?: FirebaseRedirectRule[];
  rewrites?: FirebaseRewriteRule[];
}

export interface StaticOutServerOptions {
  rootDir?: string;
  outDir?: string;
  firebaseJsonPath?: string;
}

export interface StaticOutServerHandle {
  port: number;
  baseUrl: string;
  outDir: string;
  hostingConfig: FirebaseHostingConfig;
  close: () => Promise<void>;
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".pdf": "application/pdf",
  ".mp4": "video/mp4",
  ".iq": "application/octet-stream",
  ".aab": "application/octet-stream",
  ".apk": "application/vnd.android.package-archive",
  ".zip": "application/zip",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8"
};

function findMatchingParenEnd(pattern: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === "(") {
      depth++;
    } else if (ch === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function splitTopLevelPipes(inner: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === "(" || ch === "{") {
      depth++;
    } else if (ch === ")" || ch === "}") {
      depth = Math.max(0, depth - 1);
    } else if (ch === "|" && depth === 0) {
      parts.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(inner.slice(start));
  return parts;
}

function splitTopLevelCommas(inner: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === "(" || ch === "{") {
      depth++;
    } else if (ch === ")" || ch === "}") {
      depth = Math.max(0, depth - 1);
    } else if (ch === "," && depth === 0) {
      parts.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(inner.slice(start));
  return parts;
}

function globSegmentToRegex(glob: string): string {
  let out = "";
  let i = 0;
  while (i < glob.length) {
    const ch = glob[i];
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        if (glob[i + 2] === "/") {
          out += "(?:.*/)?";
          i += 3;
        } else {
          out += ".*";
          i += 2;
        }
      } else {
        out += "[^/]*";
        i += 1;
      }
      continue;
    }

    if ((ch === "!" || ch === "@" || ch === "?" || ch === "+") && glob[i + 1] === "(") {
      const end = findMatchingParenEnd(glob, i + 1);
      if (end !== -1) {
        const inner = glob.slice(i + 2, end);
        const alts = splitTopLevelPipes(inner).map((p) => globSegmentToRegex(p)).join("|");
        if (ch === "!") {
          const isMultiSegment = inner.includes("**") || inner.includes("/");
          const body = isMultiSegment ? ".*" : "[^/]*";
          const isAtEnd = end + 1 >= glob.length;
          out += isAtEnd ? `(?!(?:${alts})$)${body}` : `(?!${alts})${body}`;
        } else if (ch === "@") {
          out += `(?:${alts})`;
        } else if (ch === "?") {
          out += `(?:${alts})?`;
        } else {
          out += `(?:${alts})+`;
        }
        i = end + 1;
        continue;
      }
    }

    if (ch === "{") {
      let depth = 0;
      let end = -1;
      for (let j = i; j < glob.length; j++) {
        if (glob[j] === "{") depth++;
        else if (glob[j] === "}") {
          depth--;
          if (depth === 0) {
            end = j;
            break;
          }
        }
      }
      if (end !== -1) {
        const inner = glob.slice(i + 1, end);
        const alts = splitTopLevelCommas(inner).map((p) => globSegmentToRegex(p)).join("|");
        out += `(?:${alts})`;
        i = end + 1;
        continue;
      }
    }

    if (ch === "?") {
      out += "[^/]";
      i += 1;
      continue;
    }

    if ("\\.^$+()[]|".includes(ch)) {
      out += `\\${ch}`;
    } else {
      out += ch;
    }
    i += 1;
  }
  return out;
}

export function matchHostingRule(
  rule: { source?: string; regex?: string },
  requestPath: string
): boolean {
  const normalizedPath = requestPath.startsWith("/") ? requestPath : `/${requestPath}`;
  const withoutLeadingSlash = normalizedPath.slice(1);

  if (typeof rule.regex === "string" && rule.regex.length > 0) {
    try {
      const re = new RegExp(rule.regex);
      return re.test(normalizedPath);
    } catch {
      return false;
    }
  }

  if (typeof rule.source !== "string" || rule.source.length === 0) {
    return false;
  }

  const rawSource = rule.source.trim();
  if (rawSource === "**" || rawSource === "/**") {
    return true;
  }

  // Handle negated extglob root patterns like "/!(*.aab|*.iq)" or "!(**/*.aab)"
  const candidateSource = rawSource.startsWith("/") ? rawSource : `/${rawSource}`;
  const regexStr = `^${globSegmentToRegex(candidateSource)}$`;
  const re = new RegExp(regexStr);
  if (re.test(normalizedPath)) {
    return true;
  }

  // Firebase Hosting also treats patterns without leading "/" as matching from root or any subpath
  if (!rawSource.startsWith("/")) {
    const bareRegex = new RegExp(`^${globSegmentToRegex(rawSource)}$`);
    return bareRegex.test(withoutLeadingSlash) || bareRegex.test(normalizedPath);
  }

  return false;
}

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || "application/octet-stream";
}

function resolveFileInOut(
  outDir: string,
  requestPath: string,
  cleanUrls: boolean
): string | null {
  let decodedPath = requestPath;
  try {
    decodedPath = decodeURIComponent(requestPath);
  } catch {
    return null;
  }

  const cleanRel = decodedPath.replace(/^\/+/, "");
  const resolvedOut = path.resolve(outDir);

  const tryCandidate = (relPath: string): string | null => {
    const abs = path.resolve(resolvedOut, relPath);
    if (abs !== resolvedOut && !abs.startsWith(resolvedOut + path.sep)) {
      return null;
    }
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      return abs;
    }
    return null;
  };

  if (cleanRel === "") {
    return tryCandidate("index.html");
  }

  const exact = tryCandidate(cleanRel);
  if (exact) {
    return exact;
  }

  if (cleanUrls && !path.extname(cleanRel)) {
    const htmlSibling = tryCandidate(`${cleanRel.replace(/\/+$/, "")}.html`);
    if (htmlSibling) {
      return htmlSibling;
    }
  }

  const dirIndex = tryCandidate(path.join(cleanRel, "index.html"));
  if (dirIndex) {
    return dirIndex;
  }

  return null;
}

export async function startStaticOutServer(
  options: StaticOutServerOptions = {}
): Promise<StaticOutServerHandle> {
  const rootDir = options.rootDir ?? process.cwd();
  const firebaseJsonPath = options.firebaseJsonPath ?? path.join(rootDir, "firebase.json");
  const firebaseParsed = JSON.parse(fs.readFileSync(firebaseJsonPath, "utf8")) as {
    hosting?: FirebaseHostingConfig;
  };
  const hostingConfig: FirebaseHostingConfig = firebaseParsed.hosting ?? {};
  const outDir = options.outDir ?? path.join(rootDir, hostingConfig.public ?? "out");

  if (!fs.existsSync(outDir) || !fs.statSync(outDir).isDirectory()) {
    throw new Error(
      `Static export directory '${outDir}' is missing. Run 'npm run build' before running E2E server tests.`
    );
  }

  const cleanUrls = hostingConfig.cleanUrls !== false;
  const activeSockets = new Set<Socket>();

  const server = http.createServer((req, res) => {
    const rawUrl = req.url ?? "/";
    let pathname = "/";
    try {
      const parsed = new URL(rawUrl, "http://127.0.0.1");
      pathname = parsed.pathname;
    } catch {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Bad Request");
      return;
    }

    // 1. Evaluate redirects from firebase.json
    for (const redirect of hostingConfig.redirects ?? []) {
      if (matchHostingRule(redirect, pathname)) {
        res.writeHead(redirect.type ?? 301, {
          Location: redirect.destination
        });
        res.end();
        return;
      }
    }

    // 2. Resolve static file or cleanUrl match inside out/
    let resolvedFile = resolveFileInOut(outDir, pathname, cleanUrls);
    let statusCode = 200;

    // 3. If not found on disk, check firebase.json rewrites
    if (!resolvedFile) {
      let rewriteDestination: string | null = null;
      for (const rewrite of hostingConfig.rewrites ?? []) {
        if (rewrite.destination && matchHostingRule(rewrite, pathname)) {
          rewriteDestination = rewrite.destination;
          break;
        }
      }

      if (rewriteDestination) {
        resolvedFile = resolveFileInOut(outDir, rewriteDestination, cleanUrls);
      }

      if (!resolvedFile) {
        statusCode = 404;
        const notFoundPage = resolveFileInOut(outDir, "/404.html", false);
        if (notFoundPage && !path.extname(pathname)) {
          const headers: Record<string, string> = {
            "Content-Type": "text/html; charset=utf-8"
          };
          res.writeHead(404, headers);
          if (req.method === "HEAD") {
            res.end();
            return;
          }
          fs.createReadStream(notFoundPage).pipe(res);
          return;
        }
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        if (req.method === "HEAD") {
          res.end();
          return;
        }
        res.end("404 Not Found");
        return;
      }
    }

    // 4. Build response headers from firebase.json (later matching rules override earlier ones)
    const headerMap = new Map<string, { name: string; value: string }>();
    headerMap.set("content-type", { name: "Content-Type", value: getMimeType(resolvedFile) });

    for (const rule of hostingConfig.headers ?? []) {
      if (matchHostingRule(rule, pathname)) {
        for (const h of rule.headers ?? []) {
          headerMap.set(h.key.toLowerCase(), { name: h.key, value: h.value });
        }
      }
    }

    const finalHeaders: Record<string, string> = {};
    for (const entry of headerMap.values()) {
      finalHeaders[entry.name] = entry.value;
    }

    res.writeHead(statusCode, finalHeaders);
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    fs.createReadStream(resolvedFile).pipe(res);
  });

  server.on("connection", (socket) => {
    activeSockets.add(socket);
    socket.on("close", () => {
      activeSockets.delete(socket);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Failed to bind staticOutServer to an ephemeral TCP port.");
  }

  return {
    port: address.port,
    baseUrl: `http://127.0.0.1:${address.port}`,
    outDir,
    hostingConfig,
    close: async () => {
      for (const socket of activeSockets) {
        socket.destroy();
      }
      activeSockets.clear();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
  };
}
