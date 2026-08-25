import { z } from 'zod';
import type { ResolveResult } from '@endora-commerce/contracts';
import type { SettingsReadPort } from '@endora-commerce/platform/kernel';
import { SEARCH_SETTING_CODES } from '../../manifest.js';

/** Narrow port over CredentialsService.resolve (feature 058, Principle I). */
export interface CredentialResolvePort {
  resolve(configurationCode: string): Promise<ResolveResult>;
}

export interface EmbedderConfig {
  url: string;
  apiKey: string;
  model: string;
}

const stringSchema = z.string();

/**
 * Resolve the Meilisearch embedder config for a channel (feature 058, T060).
 *
 * The `search.llm.embedder_credentials` reference (a reusable `llm` credential
 * configuration) is the SINGLE source: its `baseUrl` → embedder URL, `apiKey` →
 * embedder API key, `model` → embedder model. When the reference is unset or
 * unresolvable, every field comes back empty and the caller treats LLM search as
 * not configured (fail closed). There are no separate embedder settings.
 *
 * The secret `apiKey` is decrypted in-memory by `resolve`; it never leaves the
 * process.
 */
export async function resolveEmbedderConfig(
  settings: SettingsReadPort,
  channelId: string,
  credentials?: CredentialResolvePort,
): Promise<EmbedderConfig> {
  let refCode = '';
  try {
    refCode = await settings.get(
      SEARCH_SETTING_CODES.LLM_EMBEDDER_CREDENTIALS,
      channelId,
      stringSchema,
    );
  } catch {
    // Not seeded / out of scope — treat as unset.
    refCode = '';
  }

  if (!credentials || !refCode) {
    return { url: '', apiKey: '', model: '' };
  }

  const resolved = await credentials.resolve(refCode).catch(() => null);
  if (!resolved || resolved.status !== 'ok') {
    return { url: '', apiKey: '', model: '' };
  }

  return {
    url: typeof resolved.values['baseUrl'] === 'string' ? resolved.values['baseUrl'] : '',
    apiKey: typeof resolved.values['apiKey'] === 'string' ? resolved.values['apiKey'] : '',
    model: typeof resolved.values['model'] === 'string' ? resolved.values['model'] : '',
  };
}
