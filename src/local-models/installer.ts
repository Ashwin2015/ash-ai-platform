import { availableParallelism } from "node:os";
import { statfsSync } from "node:fs";
import { PlatformError } from "../errors.ts";

export type ModelPlan = {
  name: string;
  purpose: string;
  license: string;
  sizeBytes: number;
  minRamBytes: number;
};

export const CANDIDATE_MODELS: ModelPlan[] = [
  { name: "nomic-embed-text", purpose: "embeddings", license: "Apache-2.0", sizeBytes: 274_000_000, minRamBytes: 2_000_000_000 },
  { name: "moondream", purpose: "vision", license: "Apache-2.0", sizeBytes: 1_730_000_000, minRamBytes: 10_000_000_000 },
];

export async function inspectHardware(ollamaUrl: string) {
  const memory = Number(process.env.ASH_PLATFORM_MEMORY_BYTES) || (process as NodeJS.Process & { constrainedMemory?: () => number }).constrainedMemory?.() || 8_000_000_000;
  let freeDisk = 0;
  try {
    const stats = statfsSync(process.cwd());
    freeDisk = Number(stats.bavail) * Number(stats.bsize);
  } catch {
    freeDisk = 0;
  }
  let installed: string[] = [];
  try {
    const response = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(3_000) });
    const data = await response.json() as { models?: Array<{ name?: string }> };
    installed = (data.models ?? []).map((model) => model.name || "").filter(Boolean);
  } catch {
    installed = [];
  }
  return {
    ramBytes: memory,
    freeDiskBytes: freeDisk,
    cpu: availableParallelism(),
    installed,
    ollamaUrl,
  };
}

export async function ensureLocalModels(ollamaUrl: string, pull = true) {
  const hardware = await inspectHardware(ollamaUrl);
  const installedLower = hardware.installed.map((name) => name.toLowerCase());
  const planned: Array<ModelPlan & { action: "keep" | "pull" | "skip"; reason: string }> = [];
  for (const model of CANDIDATE_MODELS) {
    if (installedLower.some((name) => name.startsWith(model.name))) {
      planned.push({ ...model, action: "keep", reason: "Already installed." });
      continue;
    }
    if (hardware.ramBytes < model.minRamBytes) {
      planned.push({ ...model, action: "skip", reason: "Not enough RAM for a safe local install." });
      continue;
    }
    if (hardware.freeDiskBytes && hardware.freeDiskBytes < model.sizeBytes * 2) {
      planned.push({ ...model, action: "skip", reason: "Not enough free disk space." });
      continue;
    }
    planned.push({ ...model, action: "pull", reason: "Needed for a supported local capability." });
  }

  const pulled: string[] = [];
  if (pull) {
    for (const model of planned.filter((item) => item.action === "pull")) {
      const response = await fetch(`${ollamaUrl}/api/pull`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: model.name, stream: false }),
        signal: AbortSignal.timeout(30 * 60_000),
      }).catch(() => null);
      if (!response?.ok) {
        throw new PlatformError("provider_unavailable", `Could not install local model ${model.name}.`, 503);
      }
      pulled.push(model.name);
    }
  }
  return { hardware, planned, pulled };
}
