import type { IncomingMessage } from "node:http";
import { PlatformError } from "../errors.ts";

const DEFAULT_LIMIT = 21 * 1024 * 1024;

export type MultipartFile = {
  fieldName: string;
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
};

export async function readRawBody(request: IncomingMessage, limit = DEFAULT_LIMIT) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > limit) throw new PlatformError("invalid_request", "Upload is too large.", 413);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export function parseMultipart(contentType: string, body: Buffer): { fields: Record<string, string>; files: MultipartFile[] } {
  const match = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!match) throw new PlatformError("invalid_request", "Multipart boundary is missing.", 400);
  const boundary = `--${match[1] || match[2]}`;
  const parts = body.toString("latin1").split(boundary).slice(1, -1);
  const fields: Record<string, string> = {};
  const files: MultipartFile[] = [];
  for (const part of parts) {
    const splitAt = part.indexOf("\r\n\r\n");
    if (splitAt < 0) continue;
    const header = part.slice(0, splitAt);
    const raw = part.slice(splitAt + 4).replace(/\r\n$/, "");
    const nameMatch = header.match(/name="([^"]+)"/i);
    const fileNameMatch = header.match(/filename="([^"]*)"/i);
    const typeMatch = header.match(/Content-Type:\s*([^\r\n]+)/i);
    if (!nameMatch) continue;
    if (fileNameMatch && fileNameMatch[1]) {
      files.push({
        fieldName: nameMatch[1],
        fileName: fileNameMatch[1],
        mimeType: (typeMatch?.[1] || "application/octet-stream").trim(),
        bytes: Buffer.from(raw, "latin1"),
      });
    } else {
      fields[nameMatch[1]] = Buffer.from(raw, "latin1").toString("utf8");
    }
  }
  return { fields, files };
}
