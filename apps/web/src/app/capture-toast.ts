/**
 * Live capture / scout status (non-blocking UI).
 */
import { SonicToast } from "@supersoniks/concorde/toast";

const TOAST_ID = "glane-capture";

function upsert(opts: {
  title: string;
  text: string;
  status: "info" | "success" | "error" | "warning";
}): void {
  const inst = SonicToast.getInstance();
  const next = {
    id: TOAST_ID,
    title: opts.title,
    text: opts.text,
    status: opts.status,
    preserve: true,
  };
  const idx = inst.toasts.findIndex((x) => x.id === TOAST_ID);
  if (idx >= 0) {
    const copy = [...inst.toasts];
    copy[idx] = next;
    inst.toasts = copy;
    return;
  }
  SonicToast.add(next);
}

function clear(): void {
  const inst = SonicToast.getInstance();
  if (!inst.toasts.some((x) => x.id === TOAST_ID)) return;
  inst.toasts = inst.toasts.filter((x) => x.id !== TOAST_ID);
}

export const captureToast = {
  show(opts: {
    title: string;
    text: string;
    status: "info" | "success" | "error" | "warning";
  }): void {
    upsert(opts);
  },
  clear,
} as const;
