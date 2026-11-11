import { createWorker } from "tesseract.js";
import { PlatformError } from "../errors.ts";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const PDF_TYPE = "application/pdf";
const IMAGE_LIMIT = 12 * 1024 * 1024;
const PDF_LIMIT = 20 * 1024 * 1024;
const PDF_PAGE_LIMIT = 100;
const PDF_TEXT_LIMIT = 80_000;
const OCR_PAGE_LIMIT = 20;

function hasJpegSignature(bytes: Uint8Array) {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}
function hasPngSignature(bytes: Uint8Array) {
  return bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
}
function hasWebpSignature(bytes: Uint8Array) {
  return bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
}
function hasPdfSignature(bytes: Uint8Array) {
  return bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

export type ProcessedDocument = {
  kind: "image" | "pdf";
  mimeType: string;
  extractedText: string;
  pageCount: number;
  scanned: boolean;
};

function extractPdfTextFallback(bytes: Uint8Array) {
  const raw = Buffer.from(bytes).toString("latin1");
  const pages = raw.split(/\/Type\s*\/Page[^s]/i).length - 1;
  const chunks: string[] = [];
  const streamPattern = /BT([\s\S]*?)ET/g;
  let match: RegExpExecArray | null;
  while ((match = streamPattern.exec(raw))) {
    const text = [...match[1].matchAll(/\((?:\\.|[^\\)])*\)/g)]
      .map((item) => item[0].slice(1, -1).replace(/\\n/g, "\n").replace(/\\r/g, "").replace(/\\\(/g, "(").replace(/\\\)/g, ")"))
      .join(" ");
    if (text.trim()) chunks.push(text.trim());
  }
  return { text: chunks.join("\n"), pageCount: Math.max(pages, 1) };
}

async function extractPdfJs(bytes: Uint8Array) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const document = await pdfjs.getDocument({ data: bytes, disableWorker: true }).promise;
  if (document.numPages > PDF_PAGE_LIMIT) {
    throw new PlatformError("invalid_request", `PDFs are limited to ${PDF_PAGE_LIMIT} pages.`, 400);
  }
  const pages: string[] = [];
  let scanned = 0;
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items.map((item) => "str" in item ? String(item.str) : "").join(" ").trim();
    if (text.length < 40) scanned += 1;
    pages.push(`Page ${pageNumber}:\n${text || "[little or no extractable text; likely scanned]"}`);
  }
  return { text: pages.join("\n\n"), pageCount: document.numPages, scanned: scanned > document.numPages / 2 };
}

export async function processUpload(fileName: string, mimeType: string, bytes: Uint8Array): Promise<ProcessedDocument> {
  const lower = fileName.toLowerCase();
  if (IMAGE_TYPES.has(mimeType) || /\.(jpe?g|png|webp)$/.test(lower)) {
    if (bytes.length === 0 || bytes.length > IMAGE_LIMIT) {
      throw new PlatformError("invalid_request", "Images must be smaller than 12 MB.", 400);
    }
    if (!(hasJpegSignature(bytes) || hasPngSignature(bytes) || hasWebpSignature(bytes))) {
      throw new PlatformError("invalid_request", "Image attachment is not a valid JPEG, PNG, or WebP file.", 400);
    }
    let extractedText = "";
    if (process.env.ASH_PLATFORM_OCR !== "0") {
      try {
        extractedText = await Promise.race([
          (async () => {
            const worker = await createWorker("eng");
            const result = await worker.recognize(Buffer.from(bytes));
            await worker.terminate();
            return result.data.text.trim();
          })(),
          new Promise((_, reject) => setTimeout(() => reject(new Error("OCR timed out.")), 20_000)),
        ]);
      } catch {
        extractedText = "";
      }
    }
    return {
      kind: "image",
      mimeType: hasJpegSignature(bytes) ? "image/jpeg" : hasPngSignature(bytes) ? "image/png" : "image/webp",
      extractedText: extractedText.slice(0, PDF_TEXT_LIMIT),
      pageCount: 1,
      scanned: !extractedText,
    };
  }

  if (mimeType === PDF_TYPE || lower.endsWith(".pdf")) {
    if (bytes.length === 0 || bytes.length > PDF_LIMIT) {
      throw new PlatformError("invalid_request", "PDFs must be smaller than 20 MB.", 400);
    }
    if (!hasPdfSignature(bytes)) throw new PlatformError("invalid_request", "PDF attachment is not a valid PDF.", 400);
    try {
      const extracted = await extractPdfJs(bytes);
      return {
        kind: "pdf",
        mimeType: PDF_TYPE,
        extractedText: extracted.text.slice(0, PDF_TEXT_LIMIT),
        pageCount: extracted.pageCount,
        scanned: extracted.scanned,
      };
    } catch (error) {
      if (error instanceof PlatformError) throw error;
      const fallback = extractPdfTextFallback(bytes);
      return {
        kind: "pdf",
        mimeType: PDF_TYPE,
        extractedText: fallback.text.slice(0, PDF_TEXT_LIMIT),
        pageCount: Math.min(fallback.pageCount, PDF_PAGE_LIMIT),
        scanned: fallback.text.length < 80,
      };
    }
  }

  throw new PlatformError("invalid_request", "Only JPEG, PNG, WebP, and PDF uploads are supported.", 400);
}

export function chunkText(text: string, size = 900, overlap = 120) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const chunks: string[] = [];
  for (let index = 0; index < clean.length; index += size - overlap) {
    chunks.push(clean.slice(index, index + size));
    if (index + size >= clean.length) break;
  }
  return chunks.slice(0, 80);
}

export const OCR_PAGE_LIMIT_NOTE = OCR_PAGE_LIMIT;
