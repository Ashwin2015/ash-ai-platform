import type { PlatformConfig } from "../config.ts";
import { FileStore } from "./files.ts";
import { SupabaseFileStore } from "./supabase-files.ts";

export type StoredFile = {
  userId: string;
  storageName: string;
  bytes: Uint8Array;
};

export type AppFileStore = FileStore | SupabaseFileStore;

export function createFileStore(config: PlatformConfig, fallbackDirectory: string): AppFileStore {
  if (config.supabaseUrl && config.supabaseServiceRoleKey) {
    return new SupabaseFileStore(
      config.supabaseUrl,
      config.supabaseServiceRoleKey,
      config.supabaseStorageBucket || "ash-private-files",
    );
  }
  return new FileStore(config.filesDirectory || fallbackDirectory);
}
