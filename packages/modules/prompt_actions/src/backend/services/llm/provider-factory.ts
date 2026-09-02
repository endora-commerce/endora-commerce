import { z } from 'zod';
import { rethrowIfModuleDisabled } from '@endora-commerce/platform/kernel';
import {
  PromptActionsProviderSchema,
  type PromptActionsCapability,
  type PromptActionsProvider,
  type ResolveResult,
} from '@endora-commerce/contracts';
import { PROMPT_ACTIONS_SETTING_CODES } from '../../../manifest.js';
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
 *
 * Feature 058 — the provider/model/key are sourced SOLELY from the
 * `prompt_actions.llm_credentials` reference (a reusable `llm` credential
 * configuration). When that reference is unset or unresolvable, the assistant
 * reports `not_configured` and fails closed; there is no separate provider /
 * model / api_key setting.
 */

/** Narrow port over SettingsService so the module depends on a shape, not the class. */
export interface SettingsReadPort {
  get<T>(code: string, salesChannelId: string, schema: z.ZodType<T>): Promise<T>;
}

/** Narrow port over CredentialsService.resolve (feature 058, Principle I). */
export interface CredentialResolvePort {
  resolve(configurationCode: string): Promise<ResolveResult>;
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
  /** Feature 058 — resolves the `prompt_actions.llm_credentials` reference. */
  credentials?: CredentialResolvePort;
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
    const [enabled, refCode, bulkLimit] = await Promise.all([
      read(PROMPT_ACTIONS_SETTING_CODES.ENABLED, z.boolean(), false),
      read(PROMPT_ACTIONS_SETTING_CODES.LLM_CREDENTIALS, z.string(), ''),
      read(PROMPT_ACTIONS_SETTING_CODES.BULK_LIMIT, z.number().int().positive(), 500),
    ]);

    // Feature 058 — the `prompt_actions.llm_credentials` reference is the SINGLE
    // source of provider/model/apiKey. When it is unset or unresolvable (or
    // resolves to a provider prompt_actions has no adapter for), the assistant
    // reports `not_configured` and fails closed — there is no legacy path.
    const fromCredential = await this.resolveFromCredential(refCode.trim());
    return {
      enabled,
      provider: fromCredential?.provider ?? null,
      model: fromCredential?.model ?? '',
      apiKey: fromCredential?.apiKey ?? '',
      bulkLimit,
    };
  }

  private async resolveFromCredential(
    refCode: string,
  ): Promise<{ provider: PromptActionsProvider; model: string; apiKey: string } | null> {
    if (!this.deps.credentials || !refCode) return null;
    // Tolerated: an unresolvable reference means the assistant is not
    // configured, and reporting that is the product's answer (feature 058).
    // **A presence answer is a different sentence**: with `credentials` off
    // there is nothing for the operator to configure, and `not_configured`
    // would send them to fix a setting that is already right.
    const resolved = await this.deps.credentials.resolve(refCode).catch((error: unknown) => {
      rethrowIfModuleDisabled(error);
      return null;
    });
    if (!resolved || resolved.status !== 'ok') return null;
    // Only providers prompt_actions has an adapter for (anthropic/google/openai)
    // are usable; any other resolved provider (e.g. deepseek) is not_configured.
    const provider = PromptActionsProviderSchema.safeParse(resolved.providerCode);
    if (!provider.success) return null;
    const model = typeof resolved.values['model'] === 'string' ? resolved.values['model'].trim() : '';
    const apiKey = typeof resolved.values['apiKey'] === 'string' ? resolved.values['apiKey'].trim() : '';
    if (!model || !apiKey) return null;
    return { provider: provider.data, model, apiKey };
  }
}
