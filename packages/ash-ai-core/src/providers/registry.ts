import { PlatformError } from "../errors.ts";
import type { ModelDescriptor, ModelProvider } from "./provider.ts";

export class ProviderRegistry {
  private readonly providers = new Map<string, ModelProvider>();

  register(provider: ModelProvider) {
    if (this.providers.has(provider.id)) throw new Error(`Provider "${provider.id}" is already registered.`);
    this.providers.set(provider.id, provider);
  }

  get(providerId: string) {
    return this.providers.get(providerId);
  }

  async listModels(signal?: AbortSignal): Promise<ModelDescriptor[]> {
    const results = await Promise.allSettled(
      Array.from(this.providers.values(), (provider) => provider.listModels(signal)),
    );
    const catalogues = results
      .filter((result): result is PromiseFulfilledResult<ModelDescriptor[]> => result.status === "fulfilled")
      .map((result) => result.value);
    if (catalogues.length === 0 && results.some((result) => result.status === "rejected")) {
      throw new PlatformError("provider_unavailable", "No registered AI provider is currently available.", 503);
    }
    return catalogues.flat().sort((left, right) =>
      left.providerId.localeCompare(right.providerId) || left.displayName.localeCompare(right.displayName),
    );
  }
}
