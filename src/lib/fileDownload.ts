/**
 * Cross-platform file export & download utility (Web + Android Capacitor WebView + Mobile Share).
 * Uses ArcheryNativeShare.saveOrShareFile on Android WebView (where blob: <a download> fails silently)
 * and falls back to standard browser Blob download on desktop/mobile web.
 */

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...Array.from(chunk));
  }
  return btoa(binary);
}

export async function downloadOrShareFile(options: {
  fileName?: string;
  filename?: string;
  mimeType: string;
  data?: string | Uint8Array | ArrayBuffer;
  content?: string | Uint8Array | ArrayBuffer;
  isBase64?: boolean;
  addUtf8Bom?: boolean;
  shareTitle?: string;
}): Promise<boolean> {
  if (typeof window === "undefined") return false;

  const fileName = options.fileName || options.filename || "export.dat";
  const data = options.data ?? options.content ?? "";
  const { mimeType, isBase64 = false, addUtf8Bom = false, shareTitle } = options;

  let bytes: Uint8Array;
  let base64Payload: string;

  if (isBase64 && typeof data === "string") {
    const clean = data.includes(",") ? data.split(",")[1] : data;
    base64Payload = clean;
    const binStr = atob(clean);
    bytes = new Uint8Array(binStr.length);
    for (let i = 0; i < binStr.length; i++) {
      bytes[i] = binStr.charCodeAt(i);
    }
  } else if (typeof data === "string") {
    const textContent = addUtf8Bom && !data.startsWith("\uFEFF") ? "\uFEFF" + data : data;
    bytes = new TextEncoder().encode(textContent);
    base64Payload = bytesToBase64(bytes);
  } else if (data instanceof Uint8Array) {
    bytes = data;
    base64Payload = bytesToBase64(bytes);
  } else {
    bytes = new Uint8Array(data);
    base64Payload = bytesToBase64(bytes);
  }

  // 1. Native Android WebView bridge (MainActivity.ArcheryNativeShare.saveOrShareFile)
  const nativeShare = (window as unknown as {
    ArcheryNativeShare?: {
      saveOrShareFile?: (base64Data: string, fileName: string, mimeType: string, title?: string) => void;
    };
  }).ArcheryNativeShare;

  if (nativeShare && typeof nativeShare.saveOrShareFile === "function") {
    try {
      nativeShare.saveOrShareFile(
        base64Payload,
        fileName,
        mimeType,
        shareTitle || fileName
      );
      return true;
    } catch (err) {
      console.error("[fileDownload] Native saveOrShareFile failed, trying fallback:", err);
    }
  }

  // 2. Standard Browser Blob Download
  try {
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", fileName);
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      try {
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      } catch {
        // ignore cleanup error
      }
    }, 1500);
    return true;
  } catch (err) {
    console.error("[fileDownload] Browser download failed:", err);
    return false;
  }
}
