import type { ConfigurationTypeDescriptor, FieldDefinition } from '@b2b/contracts';

/**
 * Core `llm` configuration type (feature 058, US1 / research §R2).
 *
 * Provider codes align with the existing `prompt_actions.provider` enum
 * (`anthropic | google | openai`) extended with `deepseek`. Every provider
 * shares the same field set: a secret `apiKey`, a required `model`, and an
 * optional `baseUrl` override. The credentials core stays type-agnostic — how a
 * provider is actually called is owned by the consumer (Principle XIV).
 */

function llmFields(): FieldDefinition[] {
  return [
    { key: 'apiKey', label: 'API Key', kind: 'string', required: true, secret: true },
    { key: 'model', label: 'Model', kind: 'string', required: true, secret: false },
    {
      key: 'baseUrl',
      label: 'Base URL',
      kind: 'string',
      required: false,
      secret: false,
      placeholder: 'Optional — override the provider default endpoint',
    },
  ];
}

export const llmConfigurationType: ConfigurationTypeDescriptor = {
  code: 'llm',
  label: 'LLM',
  ownerModule: 'credentials',
  providers: [
    { code: 'openai', label: 'OpenAI (GPT)', fields: llmFields() },
    { code: 'google', label: 'Google (Gemini)', fields: llmFields() },
    { code: 'anthropic', label: 'Anthropic (Claude)', fields: llmFields() },
    { code: 'deepseek', label: 'DeepSeek', fields: llmFields() },
  ],
};
