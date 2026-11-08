export const IMAGE_LIMIT = 12 * 1024 * 1024;
export const PDF_LIMIT = 20 * 1024 * 1024;

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function formatBytes(size) {
  const bytes = Number(size) || 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function classifyLocalFile(file) {
  const fileName = String(file?.name || "attachment");
  const mimeType = String(file?.type || "").toLowerCase();
  const lower = fileName.toLowerCase();
  const isPdf = mimeType === "application/pdf" || lower.endsWith(".pdf");
  const isImage = IMAGE_TYPES.has(mimeType) || /\.(jpe?g|png|webp)$/.test(lower);
  if (!isPdf && !isImage) {
    return { ok: false, error: "Only JPEG, PNG, WebP, and PDF files can be attached." };
  }
  const size = Number(file?.size) || 0;
  if (size <= 0) return { ok: false, error: "The selected file is empty." };
  if (isPdf && size > PDF_LIMIT) return { ok: false, error: "PDFs must be smaller than 20 MB." };
  if (!isPdf && size > IMAGE_LIMIT) return { ok: false, error: "Images must be smaller than 12 MB." };
  return {
    ok: true,
    kind: isPdf ? "pdf" : "image",
    fileName,
    mimeType: mimeType || (isPdf ? "application/pdf" : "application/octet-stream"),
    size,
    lastModified: Number(file?.lastModified) || 0,
  };
}

export function sameLocalFile(left, right) {
  return Boolean(left && right
    && left.fileName === right.fileName
    && left.size === right.size
    && left.lastModified === right.lastModified);
}

export function beginAttachment(list, file, localId) {
  const check = classifyLocalFile(file);
  if (!check.ok) return { list, error: check.error, item: null };
  const identity = { fileName: check.fileName, size: check.size, lastModified: check.lastModified };
  if (list.some((item) => item.status !== "removed" && sameLocalFile(item, identity))) {
    return { list, error: "That file is already attached.", item: null };
  }
  const item = {
    localId,
    fileName: check.fileName,
    mimeType: check.mimeType,
    size: check.size,
    lastModified: check.lastModified,
    kind: check.kind,
    status: "uploading",
    progress: 0,
    error: "",
    attachmentId: "",
    previewUrl: "",
  };
  return { list: [...list, item], error: "", item };
}

function replaceItem(list, localId, patch) {
  return list.map((item) => item.localId === localId ? { ...item, ...patch } : item);
}

export function markProgress(list, localId, progress) {
  const value = Math.max(0, Math.min(100, Math.round(Number(progress) || 0)));
  return replaceItem(list, localId, { progress: value, status: "uploading" });
}

export function markReady(list, localId, attachment) {
  return list.map((item) => {
    if (item.localId !== localId) return item;
    return {
      ...item,
      status: "ready",
      progress: 100,
      error: "",
      attachmentId: attachment?.id || "",
      fileName: attachment?.fileName || item.fileName,
      kind: attachment?.kind || item.kind,
      mimeType: attachment?.mimeType || item.mimeType,
      file: undefined,
    };
  });
}

export function markFailed(list, localId, message) {
  return replaceItem(list, localId, {
    status: "error",
    error: message || "Upload failed.",
  });
}

export function removeAttachment(list, localId) {
  return list.filter((item) => item.localId !== localId);
}

export function readyAttachmentIds(list) {
  return list.filter((item) => item.status === "ready" && item.attachmentId).map((item) => item.attachmentId);
}

export function sendBlockReason(list) {
  if (list.some((item) => item.status === "uploading")) {
    return "Wait for the attachment to finish uploading, or remove it before sending.";
  }
  if (list.some((item) => item.status === "error")) {
    return "An attachment failed to upload. Retry it or remove it before sending.";
  }
  return "";
}

export function messageContentForSend(text, attachments) {
  const trimmed = String(text || "").trim();
  if (trimmed) return trimmed;
  if (readyAttachmentIds(attachments).length) return "(See attached file.)";
  return "";
}
