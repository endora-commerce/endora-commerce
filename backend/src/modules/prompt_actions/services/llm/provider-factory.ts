import { z } from 'zod';
import {
  PromptActionsProviderSchema,
  type PromptActionsCapability,
  type PromptActionsProvider,
} from '@b2b/contracts';
import { PROMPT_ACTIONS_SETTING_CODES } from '../../manifest.js';
import { AnthropicAdapter } from './anthropic-adapter.js';
import { GoogleAdapter } from './google-adapter.js';
import { OpenAiAdapter } from './openai-adapter.js';
import type { FetchLike, LlmProviderAdapter } from './provider.js';

/**
 * Settings-driven provider factory + capability derivation (feature 043,
 * T023 / US4). Configuration is resolved per call through the Settings
 * universal getter (Redis/LRU-cached), so provider, model and key changes
 * take effect on the next prompt without a restart (US4/AC4). The API key
 * never leaves this module: the capability DTO carries only the status.
 */

/** Narrow port over SettingsService so the module depends on a shape, not the class. */
export interface SettingsReadPort {
  get<T>(code: string, salesChannelId: string, schema: z.ZodType<T>): Promise<T>;
}

export class AssistantDisabled extends Error {
  override readonly name = 'AssistantDisabled';
  readonly code = 'ASSISTANT_DISABLED' as const;
  constructor() {
    super('The prompt assistant is disabled on this platform.');
  }
}

export class AssistantNotConfigured extends Error {
  override readonly name = 'AssistantNotConfigured';
  readonly code = 'ASSISTANT_NOT_CONFIGURED' as const;
  constructor() {
    super('The prompt assistant is enabled but its provider settings are incomplete.');
  }
}

export interface LlmProviderFactoryDeps {
  settings: SettingsReadPort;
  /** Channel used to resolve the (global-scope) assistant settings. */
  resolveChannelId: () => Promise<string>;
  fetchImpl?: FetchLike;
}

export interface ResolvedAssistant {
  adapter: LlmProviderAdapter;
  provider: PromptActionsProvider;
  model: string;
  bulkLimit: number;
}

export class LlmProviderFactory {
  constructor(private readonly deps: LlmProviderFactoryDeps) {}

  /** Status surface for the palette — never exposes the key (US4/AC2). */
  async capability(): Promise<PromptActionsCapability> {
    const cfg = await this.readConfig();
    if (!cfg.enabled) return { status: 'disabled', bulkLimit: cfg.bulkLimit };
    if (!cfg.provider || !cfg.model || !cfg.apiKey) {
      return { status: 'not_configured', bulkLimit: cfg.bulkLimit };
    }
    return { status: 'ready', bulkLimit: cfg.bulkLimit };
  }

  /** Adapter for one interpretation run; throws typed errors for the routes. */
  async resolve(): Promise<ResolvedAssistant> {
    const cfg = await this.readConfig();
    if (!cfg.enabled) throw new AssistantDisabled();
    if (!cfg.provider || !cfg.model || !cfg.apiKey) throw new AssistantNotConfigured();
    const fetchImpl = this.deps.fetchImpl ?? fetch;
    const adapter: LlmProviderAdapter =
      cfg.provider === 'anthropic'
        ? new AnthropicAdapter(cfg.apiKey, fetchImpl)
        : cfg.provider === 'google'
          ? new GoogleAdapter(cfg.apiKey, fetchImpl)
          : new OpenAiAdapter(cfg.apiKey, fetchImpl);
    return { adapter, provider: cfg.provider, model: cfg.model, bulkLimit: cfg.bulkLimit };
  }

  async bulkLimit(): Promise<number> {
    return (await this.readConfig()).bulkLimit;
  }

  private async readConfig(): Promise<{
    enabled: boolean;
    provider: PromptActionsProvider | null;
    model: string;
    apiKey: string;
    bulkLimit: number;
  }> {
    const channelId = await this.deps.resolveChannelId();
    const read = async <T>(code: string, schema: z.ZodType<T>, fallback: T): Promise<T> => {
      try {
        return await this.deps.settings.get(code, channelId, schema);
      } catch {
        // Not seeded yet / out of scope — treat as unset rather than erroring
        // the palette (mirrors the resolveModerationMode degrade pattern).
        return fallback;
      }
    };
    const [enabled, providerRaw, model, apiKey, bulkLimit] = await Promise.all([
      read(PROMPT_ACTIONS_SETTING_CODES.ENABLED, z.boolean(), false),
      read(PROMPT_ACTIONS_SETTING_CODES.PROVIDER, z.string(), ''),
      read(PROMPT_ACTIONS_SETTING_CODES.MODEL, z.string(), ''),
      read(PROMPT_ACTIONS_SETTING_CODES.API_KEY, z.string(), ''),
      read(PROMPT_ACTIONS_SETTING_CODES.BULK_LIMIT, z.number().int().positive(), 500),
    ]);
    const provider = PromptActionsProviderSchema.safeParse(providerRaw);
    return {
      enabled,
      provider: provider.success ? provider.data : null,
      model: model.trim(),
      apiKey: apiKey.trim(),
      bulkLimit,
    };
  }
}
