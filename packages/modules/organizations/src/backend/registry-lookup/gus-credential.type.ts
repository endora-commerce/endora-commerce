import type { ConfigurationTypeDescriptor } from '@endora-commerce/contracts';

/**
 * The `organizations_gus_bir` configuration type — feature 173 (research
 * R-12, data-model §5).
 *
 * The GUS REGON (BIR1.1) user key lives in `credentials`, which gives it
 * AES-256-GCM at rest, masking on every read and the "never returned in full"
 * guarantee with no crypto here (owner decision OD-1). This module owns the
 * type because the key means something only to its registration lookup.
 *
 * `environment` is a select, never a URL: the two endpoints are constants in
 * `integrations/gus-bir-soap.ts`, so an operator cannot point the client
 * anywhere else (research R-7 layer 6). It is an `endpoint` field, so changing
 * it asks for the key again — a production key is not carried over to the test
 * environment, nor the other way round.
 */
export const ORGANIZATIONS_GUS_CREDENTIAL_TYPE = 'organizations_gus_bir';
export const ORGANIZATIONS_GUS_CREDENTIAL_PROVIDER = 'bir11';

export const gusBirConfigurationType: ConfigurationTypeDescriptor = {
  code: ORGANIZATIONS_GUS_CREDENTIAL_TYPE,
  label: 'GUS REGON registry (BIR1.1)',
  ownerModule: 'organizations',
  providers: [
    {
      code: ORGANIZATIONS_GUS_CREDENTIAL_PROVIDER,
      label: 'BIR1.1',
      fields: [
        { key: 'apiKey', label: 'User key', kind: 'string', required: true, secret: true },
        {
          key: 'environment',
          label: 'Environment',
          kind: 'select',
          required: true,
          secret: false,
          endpoint: true,
          options: [
            { value: 'production', label: 'Production' },
            { value: 'test', label: 'Test' },
          ],
        },
      ],
    },
  ],
};
