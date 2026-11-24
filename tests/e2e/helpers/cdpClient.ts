import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";

export interface CdpNavigateOptions {
  width?: number;
  height?: number;
  deviceScaleFactor?: number;
  mobile?: boolean;
  settleMs?: number;
  timeoutMs?: number;
  evalScript?: string;
  preLoadScript?: string;
}

export interface CdpNavigationResult<T = unknown> {
  url: string;
  title: string;
  bodyText: string;
  html: string;
  consoleErrors: string[];
  pageErrors: string[];
  blockedExternalUrls: string[];
  evalResult: T;
}

interface CdpMessage {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { code?: number; message?: string };
}

interface PendingRpc {
  resolve: (value: Record<string, unknown>) => void;
  reject: (err: Error) => void;
}

const BROWSER_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"
].filter((candidate): candidate is string => typeof candidate === "string" && candidate.length > 0);

export function resolveHeadlessBrowserPath(): string {
  for (const candidate of BROWSER_CANDIDATES) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(
    `No headless Chromium/Edge binary found. Checked: ${BROWSER_CANDIDATES.join(", ")}`
  );
}

function isLocalAllowedUrl(rawUrl: string): boolean {
  if (
    rawUrl.startsWith("data:") ||
    rawUrl.startsWith("blob:") ||
    rawUrl.startsWith("about:") ||
    rawUrl.startsWith("chrome:")
  ) {
    return true;
  }
  try {
    const parsed = new URL(rawUrl);
    return parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class CdpClient {
  private readonly browserProcess: ChildProcess;
  private readonly userDataDir: string;
  private readonly ws: WebSocket;
  private nextId = 1;
  private readonly pending = new Map<number, PendingRpc>();
  private readonly eventListeners = new Map<string, Array<(params: Record<string, unknown>) => void>>();
  private consoleErrors: string[] = [];
  private pageErrors: string[] = [];
  private blockedExternalUrls: string[] = [];
  private closed = false;

  private constructor(browserProcess: ChildProcess, userDataDir: string, ws: WebSocket) {
    this.browserProcess = browserProcess;
    this.userDataDir = userDataDir;
    this.ws = ws;

    this.ws.addEventListener("message", (event) => {
      const raw = typeof event.data === "string" ? event.data : String(event.data);
      let msg: CdpMessage;
      try {
        msg = JSON.parse(raw) as CdpMessage;
      } catch {
        return;
      }

      if (typeof msg.id === "number") {
        const entry = this.pending.get(msg.id);
        if (entry) {
          this.pending.delete(msg.id);
          if (msg.error) {
            entry.reject(new Error(`CDP error ${msg.error.code ?? ""}: ${msg.error.message ?? "unknown"}`));
          } else {
            entry.resolve(msg.result ?? {});
          }
        }
        return;
      }

      if (typeof msg.method === "string") {
        const listeners = this.eventListeners.get(msg.method);
        if (listeners) {
          for (const listener of listeners) {
            listener(msg.params ?? {});
          }
        }
      }
    });

    this.ws.addEventListener("close", () => {
      for (const [, entry] of this.pending) {
        entry.reject(new Error("CDP WebSocket closed before response."));
      }
      this.pending.clear();
    });
  }

  static async launch(): Promise<CdpClient> {
    const browserPath = resolveHeadlessBrowserPath();
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "archery-e2e-cdp-"));
    const args = [
      "--headless=new",
      "--remote-debugging-port=0",
      "--disable-gpu",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-sync",
      "--mute-audio",
      `--user-data-dir=${userDataDir}`,
      "about:blank"
    ];

    const proc = spawn(browserPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });

    let wsBrowserUrl: string;
    try {
      wsBrowserUrl = await new Promise<string>((resolve, reject) => {
        let stderrBuffer = "";
        let settled = false;
        let timer: ReturnType<typeof setTimeout> | undefined;

        const onChunk = (chunk: Buffer) => {
          stderrBuffer += chunk.toString("utf8");
          const match = stderrBuffer.match(/DevTools listening on (ws:\/\/[^\s]+)/);
          if (match && !settled) {
            settled = true;
            cleanup();
            resolve(match[1]);
          }
        };

        const onExit = (code: number | null) => {
          if (!settled) {
            settled = true;
            cleanup();
            reject(new Error(`Chrome exited prematurely (${code}). stderr:\n${stderrBuffer}`));
          }
        };

        const onError = (err: Error) => {
          if (!settled) {
            settled = true;
            cleanup();
            reject(err);
          }
        };

        const cleanup = () => {
          if (timer !== undefined) {
            clearTimeout(timer);
            timer = undefined;
          }
          proc.stderr?.off("data", onChunk);
          proc.stdout?.off("data", onChunk);
          proc.off("exit", onExit);
          proc.off("error", onError);
        };

        timer = setTimeout(() => {
          if (!settled) {
            settled = true;
            cleanup();
            reject(new Error(`Timed out waiting for Chrome DevTools endpoint. stderr:\n${stderrBuffer}`));
          }
        }, 15_000);

        proc.stderr?.on("data", onChunk);
        proc.stdout?.on("data", onChunk);
        proc.once("exit", onExit);
        proc.once("error", onError);
      });
    } catch (err) {
      await CdpClient.forceKillAndClean(proc, userDataDir);
      throw err;
    }

    let ws: WebSocket | null = null;
    try {
      let pageWsUrl = wsBrowserUrl;
      try {
        const parsedBrowserWs = new URL(wsBrowserUrl);
        const listRes = await fetch(`http://127.0.0.1:${parsedBrowserWs.port}/json/list`);
        if (listRes.ok) {
          const targets = (await listRes.json()) as Array<{ type?: string; webSocketDebuggerUrl?: string }>;
          const pageTarget = targets.find((t) => t.type === "page" && typeof t.webSocketDebuggerUrl === "string");
          if (pageTarget?.webSocketDebuggerUrl) {
            pageWsUrl = pageTarget.webSocketDebuggerUrl;
          }
        }
      } catch {
        // Fallback to browser WS if /json/list is unavailable
      }

      const socket = new WebSocket(pageWsUrl);
      ws = socket;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Timed out connecting CDP WebSocket.")), 10_000);
        socket.addEventListener(
          "open",
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true }
        );
        socket.addEventListener(
          "error",
          () => {
            clearTimeout(timer);
            reject(new Error("CDP WebSocket connection error."));
          },
          { once: true }
        );
      });

      const client = new CdpClient(proc, userDataDir, socket);
      await client.initialize();
      return client;
    } catch (err) {
      try {
        if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
          ws.close();
        }
      } catch {
        // ignore
      }
      await CdpClient.forceKillAndClean(proc, userDataDir);
      throw err;
    }
  }

  private async initialize(): Promise<void> {
    this.on("Runtime.consoleAPICalled", (params) => {
      const type = String(params.type ?? "");
      if (type === "error") {
        const args = Array.isArray(params.args)
          ? (params.args as Array<{ value?: unknown; description?: string }>)
          : [];
        const text = args
          .map((a) => (a.value !== undefined ? String(a.value) : a.description ?? ""))
          .filter(Boolean)
          .join(" ");
        if (text && !this.isExpectedOfflineBlockNoise(text)) {
          this.consoleErrors.push(text);
        }
      }
    });

    this.on("Runtime.exceptionThrown", (params) => {
      const details = params.exceptionDetails as
        | { text?: string; exception?: { description?: string } }
        | undefined;
      const msg = details?.exception?.description || details?.text || "Uncaught page exception";
      this.pageErrors.push(msg);
    });

    this.on("Fetch.requestPaused", (params) => {
      const requestId = String(params.requestId ?? "");
      const req = params.request as { url?: string } | undefined;
      const reqUrl = String(req?.url ?? "");

      if (!requestId) return;
      if (isLocalAllowedUrl(reqUrl)) {
        void this.send("Fetch.continueRequest", { requestId }).catch(() => {});
      } else {
        this.blockedExternalUrls.push(reqUrl);
        void this.send("Fetch.failRequest", {
          requestId,
          errorReason: "InternetDisconnected"
        }).catch(() => {});
      }
    });

    await this.send("Page.enable");
    await this.send("Runtime.enable");
    await this.send("DOM.enable");
    await this.send("Network.enable");
    await this.send("Fetch.enable", {
      patterns: [{ urlPattern: "*", requestStage: "Request" }]
    });
  }

  private isExpectedOfflineBlockNoise(text: string): boolean {
    return (
      text.includes("ERR_INTERNET_DISCONNECTED") ||
      text.includes("Failed to load resource: net::ERR_INTERNET_DISCONNECTED") ||
      text.includes("fonts.googleapis.com") ||
      text.includes("gstatic.com")
    );
  }

  private on(method: string, handler: (params: Record<string, unknown>) => void): () => void {
    const arr = this.eventListeners.get(method) ?? [];
    arr.push(handler);
    this.eventListeners.set(method, arr);
    return () => {
      const current = this.eventListeners.get(method);
      if (!current) return;
      const idx = current.indexOf(handler);
      if (idx !== -1) current.splice(idx, 1);
    };
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    if (this.closed) {
      return Promise.reject(new Error(`CDP client is closed (cannot call ${method}).`));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP call timed out: ${method}`));
        }
      }, 15_000);

      this.pending.set(id, {
        resolve: (res) => {
          clearTimeout(timer);
          resolve(res);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        }
      });

      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async setViewport(
    width: number,
    height: number,
    deviceScaleFactor = 1,
    mobile = width <= 500
  ): Promise<void> {
    await this.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor,
      mobile
    });
  }

  async evaluate<T = unknown>(expression: string): Promise<T> {
    const res = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true
    });
    const exceptionDetails = res.exceptionDetails as
      | { text?: string; exception?: { description?: string } }
      | undefined;
    if (exceptionDetails) {
      throw new Error(
        exceptionDetails.exception?.description || exceptionDetails.text || "Runtime.evaluate exception"
      );
    }
    const resultObj = res.result as { value?: T } | undefined;
    return resultObj?.value as T;
  }

  async navigateAndCollect<T = unknown>(
    url: string,
    options: CdpNavigateOptions = {}
  ): Promise<CdpNavigationResult<T>> {
    const width = options.width ?? 360;
    const height = options.height ?? 800;
    await this.setViewport(
      width,
      height,
      options.deviceScaleFactor ?? 1,
      options.mobile ?? width <= 500
    );

    this.consoleErrors = [];
    this.pageErrors = [];
    this.blockedExternalUrls = [];

    let preloadId: string | null = null;
    if (options.preLoadScript) {
      const scriptRes = await this.send("Page.addScriptToEvaluateOnNewDocument", {
        source: options.preLoadScript
      });
      if (typeof scriptRes.identifier === "string") {
        preloadId = scriptRes.identifier;
      }
    }

    let loadTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      const loadPromise = new Promise<void>((resolve) => {
        let done = false;
        const finish = () => {
          if (!done) {
            done = true;
            if (loadTimer !== undefined) {
              clearTimeout(loadTimer);
              loadTimer = undefined;
            }
            off();
            resolve();
          }
        };
        const off = this.on("Page.loadEventFired", finish);
        loadTimer = setTimeout(finish, options.timeoutMs ?? 12_000);
      });

      await this.send("Page.navigate", { url });
      await loadPromise;
      await sleep(options.settleMs ?? 800);

      // Wait for Next.js client hydration to settle past empty or transient loading states
      const deadline = Date.now() + 8_000;
      while (Date.now() < deadline) {
        const readyText = await this.evaluate<string>(
          "document.body ? document.body.innerText.trim() : ''"
        );
        if (readyText.length > 20 && !/^(Cargando|Loading)\b.*\.\.\.$/i.test(readyText)) {
          break;
        }
        await sleep(150);
      }

      const snapshot = await this.evaluate<{ title: string; bodyText: string; html: string }>(`(() => ({
        title: document.title || "",
        bodyText: document.body ? document.body.innerText : "",
        html: document.documentElement ? document.documentElement.outerHTML : ""
      }))()`);

      let evalResult = undefined as T;
      if (options.evalScript) {
        evalResult = await this.evaluate<T>(options.evalScript);
      }

      return {
        url,
        title: snapshot.title,
        bodyText: snapshot.bodyText,
        html: snapshot.html,
        consoleErrors: [...this.consoleErrors],
        pageErrors: [...this.pageErrors],
        blockedExternalUrls: [...this.blockedExternalUrls],
        evalResult
      };
    } finally {
      if (loadTimer !== undefined) {
        clearTimeout(loadTimer);
        loadTimer = undefined;
      }
      if (preloadId) {
        await this.send("Page.removeScriptToEvaluateOnNewDocument", {
          identifier: preloadId
        }).catch(() => {});
      }
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    try {
      if (this.ws.readyState === WebSocket.OPEN) {
        await Promise.race([
          this.send("Browser.close").catch(() => {}),
          sleep(1_500)
        ]);
      }
    } catch {
      // ignore
    }
    this.closed = true;
    try {
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close();
      }
    } catch {
      // ignore
    }
    await CdpClient.waitForProcExit(this.browserProcess, 1_500);
    await CdpClient.forceKillAndClean(this.browserProcess, this.userDataDir);
  }

  private static async waitForProcExit(proc: ChildProcess, timeoutMs: number): Promise<void> {
    if (proc.exitCode !== null || proc.signalCode !== null) return;
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          proc.off("exit", finish);
          proc.off("close", finish);
          resolve();
        }
      };
      const timer = setTimeout(finish, timeoutMs);
      proc.once("exit", finish);
      proc.once("close", finish);
    });
  }

  private static async forceKillAndClean(proc: ChildProcess, userDataDir: string): Promise<void> {
    const pid = proc.pid;
    if (pid && proc.exitCode === null && proc.signalCode === null) {
      if (process.platform === "win32") {
        spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
          stdio: "ignore",
          windowsHide: true
        });
      } else {
        try {
          proc.kill("SIGKILL");
        } catch {
          // ignore
        }
      }
      await CdpClient.waitForProcExit(proc, 1_000);
    }

    if (fs.existsSync(userDataDir)) {
      try {
        fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 15, retryDelay: 250 });
      } catch {
        // Fall through to async retries below
      }
    }

    for (let attempt = 0; attempt < 15 && fs.existsSync(userDataDir); attempt++) {
      await sleep(250);
      try {
        await fs.promises.rm(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      } catch {
        // Retry until Windows releases remaining file handles
      }
    }
  }
}
