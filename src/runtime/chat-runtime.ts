import { capGeneration } from "../chat/assistant-prompt.ts";
import { PlatformError } from "../errors.ts";
import { scoreModelForTask } from "../providers/free-catalog.ts";
import type { ProviderRegistry } from "../providers/registry.ts";
import type { ChatTask, ChatTurn, ModelDescriptor, StreamFinish } from "../providers/provider.ts";

export type RoutingMode = "auto" | "free_cloud" | "local_only" | "manual";

type PreparedChat = {
  model: ModelDescriptor;
  stream: AsyncIterable<string>;
};

export type PrepareOptions = {
  task?: ChatTask;
  requireVision?: boolean;
  maxOutputTokens?: number;
  minOutputTokens?: number;
  temperature?: number;
};

const MODEL_FAILURE_COOLDOWN_MS = 30_000;
const RATE_LIMIT_COOLDOWN_MS = 5_000;
const AUTO_CANDIDATE_LIMIT = 6;
const AUTO_PER_PROVIDER_LIMIT = 2;

function streamOptions(options: PrepareOptions, model: ModelDescriptor, messages: ChatTurn[]) {
  const promptChars = messages.reduce((sum, message) => sum + message.content.length, 0);
  return {
    maxOutputTokens: options.maxOutputTokens
      ? capGeneration(options.maxOutputTokens, model, promptChars)
      : undefined,
    temperature: options.temperature,
  };
}

export class ChatRuntime {
  private readonly providers: ProviderRegistry;
  private readonly now: () => number;
  private readonly failedUntil = new Map<string, number>();

  constructor(providers: ProviderRegistry, now: () => number = Date.now) {
    this.providers = providers;
    this.now = now;
  }

  async prepare(
    mode: RoutingMode,
    providerId: string,
    modelId: string,
    messages: ChatTurn[],
    signal?: AbortSignal,
    options: PrepareOptions = {},
  ): Promise<PreparedChat> {
    const models = await this.providers.listModels(signal);
    const candidates = this.candidates(mode, providerId, modelId, models, options)
      .filter((model) => mode === "manual" || !this.isCoolingDown(model));
    if (candidates.length === 0) {
      throw new PlatformError(
        "model_unavailable",
        options.requireVision
          ? "No available free vision model supports this request."
          : mode === "free_cloud"
            ? "No verified free cloud chat model is currently available."
            : mode === "auto"
              ? "No available free chat model supports this request."
              : mode === "local_only"
                ? "No available local chat model supports this request."
                : "The selected provider and model are not currently available.",
        422,
      );
    }

    if (mode === "manual") {
      const model = candidates[0];
      this.assertTextChat(model, options);
      const provider = this.providers.get(model.providerId);
      if (!provider) throw new PlatformError("model_unavailable", "The selected provider is not registered.", 422);
      return { model, stream: provider.streamChat(model.id, messages, signal, streamOptions(options, model, messages)) };
    }

    let lastFailure: PlatformError | undefined;
    const attempted: string[] = [];
    for (const model of candidates) {
      const provider = this.providers.get(model.providerId);
      if (!provider) continue;
      attempted.push(`${model.providerId}/${model.id}`);
      try {
        const iterator = provider.streamChat(model.id, messages, signal, streamOptions(options, model, messages))[Symbol.asyncIterator]();
        const first = await this.firstText(iterator);
        if (!first) {
          throw new PlatformError("provider_unavailable", "The model returned an empty response.", 502);
        }
        this.failedUntil.delete(this.modelKey(model));
        return {
          model,
          stream: this.prepend(first, iterator),
        };
      } catch (error) {
        if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) {
          throw error instanceof PlatformError
            ? error
            : new PlatformError("provider_unavailable", "The chat request was interrupted or timed out.", 504);
        }
        const mapped = error instanceof PlatformError
          ? error
          : new PlatformError("provider_unavailable", error instanceof Error ? error.message : "The model could not complete this request.", 503);
        if (this.shouldCooldown(mapped)) {
          const cooldown = mapped.code === "rate_limited" ? RATE_LIMIT_COOLDOWN_MS : MODEL_FAILURE_COOLDOWN_MS;
          this.failedUntil.set(this.modelKey(model), this.now() + cooldown);
        }
        lastFailure = mapped;
      }
    }
    throw this.exhaustedCandidatesError(mode, attempted, lastFailure);
  }

  private candidates(
    mode: RoutingMode,
    providerId: string,
    modelId: string,
    models: ModelDescriptor[],
    options: PrepareOptions,
  ) {
    const task = options.task ?? "chat";
    const eligible = models.filter((model) =>
      model.capabilities.textInput && model.capabilities.textOutput && model.capabilities.streaming &&
      (!options.requireVision || model.capabilities.imageInput),
    );
    if (mode === "manual") {
      return eligible.filter((model) => model.providerId === providerId && model.id === modelId).slice(0, 1);
    }
    const extras = { minOutputTokens: options.minOutputTokens ?? options.maxOutputTokens };
    const sorted = (list: ModelDescriptor[]) => list.sort((left, right) =>
      scoreModelForTask(right, task, extras) - scoreModelForTask(left, task, extras) ||
      Number(left.locality !== "local") - Number(right.locality !== "local") ||
      Number(left.pricing === "limited_free") - Number(right.pricing === "limited_free") ||
      (right.contextWindow ?? 0) - (left.contextWindow ?? 0) ||
      (right.maxOutputTokens ?? 0) - (left.maxOutputTokens ?? 0) ||
      left.providerId.localeCompare(right.providerId) ||
      left.id.localeCompare(right.id),
    );
    if (mode === "local_only") return sorted(eligible.filter((model) => model.locality === "local"));
    const cloudOrAuto = mode === "free_cloud"
      ? eligible.filter((model) =>
        model.locality === "cloud" && (model.pricing === "free" || model.pricing === "limited_free"),
      )
      : eligible.filter((model) => model.pricing === "free" || model.pricing === "limited_free");
    return this.limitAutoCandidates(sorted(cloudOrAuto));
  }

  private limitAutoCandidates(models: ModelDescriptor[]) {
    const limited: ModelDescriptor[] = [];
    const perProvider = new Map<string, number>();
    const queues = new Map<string, ModelDescriptor[]>();
    for (const model of models) {
      const queue = queues.get(model.providerId) || [];
      queue.push(model);
      queues.set(model.providerId, queue);
    }
    let progressed = true;
    while (limited.length < AUTO_CANDIDATE_LIMIT && progressed) {
      progressed = false;
      for (const [providerId, queue] of queues) {
        const used = perProvider.get(providerId) || 0;
        if (used >= AUTO_PER_PROVIDER_LIMIT || !queue.length) continue;
        limited.push(queue.shift()!);
        perProvider.set(providerId, used + 1);
        progressed = true;
        if (limited.length >= AUTO_CANDIDATE_LIMIT) break;
      }
    }
    return limited;
  }

  private shouldCooldown(error: PlatformError) {
    if (error.code === "model_unavailable") return false;
    return error.code === "provider_unavailable" || error.code === "rate_limited";
  }

  private exhaustedCandidatesError(mode: RoutingMode, attempted: string[], lastFailure?: PlatformError) {
    const detail = attempted.length
      ? ` Tried ${attempted.join(", ")}.`
      : "";
    const tail = lastFailure
      ? ` Last error: ${lastFailure.message}`
      : "";
    const message = mode === "auto" || mode === "free_cloud"
      ? `No eligible free model could complete this request.${detail}${tail}`
      : `No available model could complete this request.${detail}${tail}`;
    return new PlatformError(lastFailure?.code || "provider_unavailable", message, lastFailure?.statusCode || 503);
  }

  private async firstText(iterator: AsyncIterator<string>) {
    while (true) {
      const item = await iterator.next();
      if (item.done) return "";
      if (item.value) return item.value;
    }
  }

  private assertTextChat(model: ModelDescriptor, options: PrepareOptions) {
    if (!model.capabilities.textInput || !model.capabilities.textOutput || !model.capabilities.streaming) {
      throw new PlatformError("model_unavailable", "The selected model does not support streaming text chat.", 422);
    }
    if (options.requireVision && !model.capabilities.imageInput) {
      throw new PlatformError("model_unavailable", "The selected model does not support image understanding.", 422);
    }
  }

  private modelKey(model: ModelDescriptor) {
    return `${model.providerId}\u0000${model.id}`;
  }

  private isCoolingDown(model: ModelDescriptor) {
    const key = this.modelKey(model);
    const failedUntil = this.failedUntil.get(key);
    if (failedUntil === undefined) return false;
    if (failedUntil <= this.now()) {
      this.failedUntil.delete(key);
      return false;
    }
    return true;
  }

  private async *prepend(first: string, iterator: AsyncIterator<string, StreamFinish | void>): AsyncGenerator<string, StreamFinish | void> {
    yield first;
    while (true) {
      const next = await iterator.next();
      if (next.done) return next.value;
      if (next.value) yield next.value;
    }
  }
}
