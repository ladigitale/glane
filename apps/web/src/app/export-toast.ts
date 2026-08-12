/**
 * Progress / result feedback for long exports (non-blocking UI).
 */
import { SonicToast } from "@supersoniks/concorde/toast";
import { t } from "./i18n/messages.js";

const TOAST_ID = "glane-export";

function upsert(opts: {
  text: string;
  status: "info" | "success" | "error" | "warning";
  preserve: boolean;
}): void {
  const inst = SonicToast.getInstance();
  const next = {
    id: TOAST_ID,
    title: t("export.title"),
    text: opts.text,
    status: opts.status,
    preserve: opts.preserve,
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

function clearProgress(): void {
  const inst = SonicToast.getInstance();
  if (!inst.toasts.some((x) => x.id === TOAST_ID)) return;
  inst.toasts = inst.toasts.filter((x) => x.id !== TOAST_ID);
}

export const exportToast = {
  progress(text: string): void {
    upsert({ text, status: "info", preserve: true });
  },
  done(text: string): void {
    clearProgress();
    SonicToast.add({
      title: t("export.title"),
      text,
      status: "success",
    });
  },
  fail(text: string): void {
    clearProgress();
    SonicToast.add({
      title: t("export.title"),
      text,
      status: "error",
    });
  },
  clear: clearProgress,
} as const;
