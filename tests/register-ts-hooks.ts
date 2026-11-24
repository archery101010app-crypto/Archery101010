import fs from "node:fs";
import nodeModule from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

interface ResolveContext {
  conditions: string[];
  importAttributes: Record<string, string>;
  parentURL?: string;
}

interface ResolveResult {
  url: string;
  format?: string | null;
  shortCircuit?: boolean;
}

interface LoadContext {
  conditions: string[];
  format?: string | null;
  importAttributes: Record<string, string>;
}

interface LoadResult {
  format: string;
  source?: string | ArrayBuffer | ArrayBufferView;
  shortCircuit?: boolean;
}

interface ModuleWithRegisterHooks {
  registerHooks?: (hooks: {
    resolve?: (
      specifier: string,
      context: ResolveContext,
      nextResolve: (specifier: string, context?: ResolveContext) => ResolveResult
    ) => ResolveResult;
    load?: (
      url: string,
      context: LoadContext,
      nextLoad: (url: string, context?: LoadContext) => LoadResult
    ) => LoadResult;
  }) => unknown;
}

const SRC_ROOT = path.resolve(process.cwd(), "src");

function tryResolveTsFile(baseCandidatePath: string): string | null {
  const candidates = [
    baseCandidatePath,
    `${baseCandidatePath}.ts`,
    `${baseCandidatePath}.tsx`,
    `${baseCandidatePath}.js`,
    path.join(baseCandidatePath, "index.ts"),
    path.join(baseCandidatePath, "index.tsx"),
    path.join(baseCandidatePath, "index.js")
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return pathToFileURL(candidate).href;
    }
  }
  return null;
}

const modWithHooks = nodeModule as unknown as ModuleWithRegisterHooks;

if (typeof modWithHooks.registerHooks === "function") {
  modWithHooks.registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.startsWith("@/")) {
        const subPath = specifier.slice(2);
        const resolvedUrl = tryResolveTsFile(path.join(SRC_ROOT, subPath));
        if (resolvedUrl) {
          return {
            url: resolvedUrl,
            shortCircuit: true
          };
        }
      }

      if (
        (specifier.startsWith("./") || specifier.startsWith("../")) &&
        context.parentURL?.startsWith("file:") &&
        !path.extname(specifier)
      ) {
        const parentDir = path.dirname(fileURLToPath(context.parentURL));
        const resolvedUrl = tryResolveTsFile(path.resolve(parentDir, specifier));
        if (resolvedUrl) {
          return {
            url: resolvedUrl,
            shortCircuit: true
          };
        }
      }

      return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      if (url.startsWith("file:") && (url.endsWith(".ts") || url.endsWith(".tsx"))) {
        return nextLoad(url, {
          ...context,
          format: "module-typescript"
        });
      }
      return nextLoad(url, context);
    }
  });
}
