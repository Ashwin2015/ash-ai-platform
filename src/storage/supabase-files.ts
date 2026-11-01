import { PlatformError } from "../errors.ts";

function encodePath(userId: string, storageName: string) {
  if (userId.includes("..") || storageName.includes("..") || storageName.includes("/") || storageName.includes("\\")) {
    throw new Error("Invalid attachment path.");
  }
  return `${encodeURIComponent(userId)}/${encodeURIComponent(storageName)}`;
}

export class SupabaseFileStore {
  private readonly baseUrl: string;
  private readonly serviceKey: string;
  private readonly bucket: string;

  constructor(supabaseUrl: string, serviceRoleKey: string, bucket = "ash-private-files") {
    this.baseUrl = supabaseUrl.replace(/\/$/, "");
    this.serviceKey = serviceRoleKey;
    this.bucket = bucket;
  }

  private headers(extra: Record<string, string> = {}) {
    return {
      Authorization: `Bearer ${this.serviceKey}`,
      apikey: this.serviceKey,
      ...extra,
    };
  }

  async write(userId: string, storageName: string, bytes: Uint8Array) {
    const objectPath = encodePath(userId, storageName);
    const response = await fetch(`${this.baseUrl}/storage/v1/object/${this.bucket}/${objectPath}`, {
      method: "POST",
      headers: this.headers({
        "Content-Type": "application/octet-stream",
        "x-upsert": "true",
      }),
      body: Buffer.from(bytes),
    });
    if (!response.ok) throw new PlatformError("provider_unavailable", "Private file storage rejected the upload.", 503);
    return objectPath;
  }

  async read(userId: string, storageName: string) {
    const objectPath = encodePath(userId, storageName);
    const response = await fetch(`${this.baseUrl}/storage/v1/object/${this.bucket}/${objectPath}`, {
      headers: this.headers(),
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new PlatformError("provider_unavailable", "Private file storage could not read the file.", 503);
    return Buffer.from(await response.arrayBuffer());
  }

  async signedUrl(userId: string, storageName: string, expiresIn = 60) {
    const objectPath = encodePath(userId, storageName);
    const response = await fetch(`${this.baseUrl}/storage/v1/object/sign/${this.bucket}/${objectPath}`, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ expiresIn }),
    });
    if (!response.ok) throw new PlatformError("provider_unavailable", "A signed file URL could not be created.", 503);
    const data = await response.json() as { signedURL?: string };
    const relative = data.signedURL || "";
    return relative.startsWith("http") ? relative : `${this.baseUrl}/storage/v1${relative}`;
  }

  async remove(userId: string, storageName: string) {
    const objectPath = encodePath(userId, storageName);
    await fetch(`${this.baseUrl}/storage/v1/object/${this.bucket}`, {
      method: "DELETE",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ prefixes: [objectPath] }),
    });
  }

  async removeUser(userId: string) {
    await fetch(`${this.baseUrl}/storage/v1/object/${this.bucket}`, {
      method: "DELETE",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ prefixes: [encodeURIComponent(userId)] }),
    });
  }
}
