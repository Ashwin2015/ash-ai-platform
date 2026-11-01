import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseFileStore } from "../src/storage/supabase-files.ts";

test("private storage paths cannot escape the user prefix [unit]", async () => {
  const store = new SupabaseFileStore("https://example.supabase.co", "test-service-role", "ash-private-files");
  await assert.rejects(() => store.write("user-1", "../other", new Uint8Array([1])), /Invalid attachment path/);
  await assert.rejects(() => store.write("user-1", "a/b", new Uint8Array([1])), /Invalid attachment path/);
  await assert.rejects(() => store.write("..", "file.bin", new Uint8Array([1])), /Invalid attachment path/);
});
