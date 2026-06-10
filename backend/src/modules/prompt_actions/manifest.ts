import { defineModuleManifest, defineModuleSettingsManifest } from '@b2b/contracts';

/**
 * Prompt Actions module — feature 043.
 *
 * Natural-language prompt mode for the admin command palette: the operator
 * types an instruction (PL/EN), the backend interprets it with an LLM via
 * tool use / function calling against a curated, module-contributed tool
 * catalogue, presents a confirmable plan, and executes it through existing
 * module services under the operator's own permissions.
 *
 * Settings (research §R4):
 *   - prompt_actions.enabled      — platform-wide kill switch (FR-015).
 *   - prompt_actions.provider     — 'anthropic' | 'google' | 'openai'.
 *   - prompt_actions.model        — provider model ID.
 *   - prompt_actions.api_key      — provider credential; `secret` value type
 *                                   (write-only, encrypted at rest, FR-021).
 *   - prompt_actions.bulk_limit   — max affected records per prompt (FR-010).
 *
 * No palette `actions:` entry: feature 020 actions are navigation-only, and
 * the prompt mode has no standalone route — its entry point is the
 * capability-gated "Ask the assistant" row the admin shell pins inside the
 * palette itself.
 */

export const PROMPT_ACTIONS_SETTING_CODES = {
  ENABLED: 'prompt_actions.enabled',
  PROVIDER: 'prompt_actions.provider',
  MODEL: 'prompt_actions.model',
  API_KEY: 'prompt_actions.api_key',
  BULK_LIMIT: 'prompt_actions.bulk_limit',
} as const;

export const PROMPT_ACTIONS_USE_PERMISSION = 'prompt_actions:use';

const settings = defineModuleSettingsManifest({
  moduleCode: 'prompt_actions',
  groups: [{ code: 'prompt_actions', name: 'Prompt actions (AI assistant)' }],
  settings: [
    {
      code: PROMPT_ACTIONS_SETTING_CODES.ENABLED,
      name: 'Assistant enabled',
      description:
        'Platform-wide switch for the natural-language prompt mode in the admin command palette. When off, the palette behaves exactly as without the module.',
      groupCode: 'prompt_actions',
      valueType: 'boolean',
      defaultValue: false,
    },
    {
      code: PROMPT_ACTIONS_SETTING_CODES.PROVIDER,
      name: 'LLM provider',
      description:
        "Which provider interprets operator prompts: 'anthropic' (Claude), 'google' (Gemini) or 'openai' (GPT).",
      groupCode: 'prompt_actions',
      valueType: 'string',
      defaultValue: 'anthropic',
    },
    {
      code: PROMPT_ACTIONS_SETTING_CODES.MODEL,
      name: 'LLM model',
      description:
        "Model ID for the selected provider, e.g. 'claude-sonnet-4-6', 'gemini-2.5-flash' or 'gpt-4o'.",
      groupCode: 'prompt_actions',
      valueType: 'string',
      defaultValue: 'claude-sonnet-4-6',
    },
    {
      code: PROMPT_ACTIONS_SETTING_CODES.API_KEY,
      name: 'Provider API key',
      description:
        'Credential for the selected LLM provider. Write-only: the value is encrypted at rest and never returned by the settings API after saving.',
      groupCode: 'prompt_actions',
      valueType: 'secret',
      defaultValue: '',
    },
    {
      code: PROMPT_ACTIONS_SETTING_CODES.BULK_LIMIT,
      name: 'Bulk operation limit',
      description:
        'Maximum number of records a single prompt may affect. Plans whose preview exceeds the limit are blocked before execution.',
      groupCode: 'prompt_actions',
      valueType: 'number',
      defaultValue: 500,
    },
  ],
});

export const manifest = defineModuleManifest({
  id: 'prompt_actions',
  name: 'Prompt Actions',
  description:
    'Natural-language prompt mode for the admin command palette: interpret an operator instruction with an LLM, preview the plan, execute it through existing module services after explicit confirmation.',
  version: '1.0.0',
  dependencies: ['_lifecycle', '_i18n', 'settings'],
  settings,
  i18n: { bundlesDir: 'i18n' },
  permissions: [
    {
      code: PROMPT_ACTIONS_USE_PERMISSION,
      label: 'Use the prompt assistant',
      description:
        'Allows the operator to open the prompt mode in the admin command palette and execute confirmed plans (each planned operation is additionally re-checked against the permission of its underlying action).',
    },
  ],
});
