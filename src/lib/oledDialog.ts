export interface OledDialogRequest {
  id: string;
  kind: "alert" | "confirm";
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  resolve: (result: boolean) => void;
}

type DialogListener = (request: OledDialogRequest | null) => void;

const queue: OledDialogRequest[] = [];
let activeRequest: OledDialogRequest | null = null;
const listeners = new Set<DialogListener>();

function notify() {
  for (const listener of listeners) {
    listener(activeRequest);
  }
}

function advanceQueue() {
  activeRequest = queue.shift() || null;
  notify();
}

export function subscribeOledDialog(listener: DialogListener): () => void {
  listeners.add(listener);
  listener(activeRequest);
  return () => {
    listeners.delete(listener);
  };
}

export function resolveActiveOledDialog(result: boolean): void {
  if (!activeRequest) return;
  const current = activeRequest;
  activeRequest = null;
  current.resolve(result);
  advanceQueue();
}

export function showOledAlert(message: string, confirmLabel = "Entendido"): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (listeners.size === 0) {
    window.alert(message);
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    const req: OledDialogRequest = {
      id: `dlg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      kind: "alert",
      message,
      confirmLabel,
      resolve: () => resolve(),
    };
    if (!activeRequest) {
      activeRequest = req;
      notify();
    } else {
      queue.push(req);
    }
  });
}

export function showOledConfirm(
  message: string,
  options?: { confirmLabel?: string; cancelLabel?: string }
): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (listeners.size === 0) {
    return Promise.resolve(window.confirm(message));
  }
  return new Promise<boolean>((resolve) => {
    const req: OledDialogRequest = {
      id: `dlg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      kind: "confirm",
      message,
      confirmLabel: options?.confirmLabel || "Confirmar",
      cancelLabel: options?.cancelLabel || "Cancelar",
      resolve,
    };
    if (!activeRequest) {
      activeRequest = req;
      notify();
    } else {
      queue.push(req);
    }
  });
}
