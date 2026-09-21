import type {
  ConfigurationTypeDescriptor,
  CredentialsPort,
  InvoiceLedgerVendorFreeze,
  LedgerDeliveryRecord,
} from '@endora-commerce/contracts';

/**
 * The fixture's credential shape, and the two halves of the ledger's freeze
 * contract that hang off it.
 *
 * A ledger vendor owns three things about a credential and `invoice_ledger` owns
 * none of them: the code, the fields, and the rule for picking a channel override
 * over the instance row. They are here for the same reason the vocabulary is —
 * `credentials` renders the form from the descriptor its contributor pushed, and
 * a code a free module named would be a free module naming a vendor.
 */

export const LEDGER_FIXTURE_CREDENTIAL_CODE = 'ledger_vendor_fixture';
export const LEDGER_FIXTURE_CREDENTIAL_PROVIDER = 'ledger_vendor_fixture';

export function ledgerFixtureChannelCredentialCode(salesChannelId: string): string {
  return `${LEDGER_FIXTURE_CREDENTIAL_CODE}.channel.${salesChannelId}`;
}

export const ledgerFixtureConfigurationType: ConfigurationTypeDescriptor = {
  code: LEDGER_FIXTURE_CREDENTIAL_CODE,
  label: 'Ledger vendor fixture',
  ownerModule: 'ledger_vendor_fixture',
  providers: [
    {
      code: LEDGER_FIXTURE_CREDENTIAL_PROVIDER,
      label: 'Ledger vendor fixture API',
      fields: [
        { key: 'apiKey', label: 'API key', kind: 'string', required: true, secret: true },
        {
          key: 'environment',
          label: 'Environment',
          kind: 'select',
          required: true,
          secret: false,
          options: [
            { value: 'sandbox', label: 'Sandbox' },
            { value: 'production', label: 'Production' },
          ],
        },
        {
          key: 'webhookSecret',
          label: 'Webhook secret',
          kind: 'string',
          required: false,
          secret: true,
        },
      ],
    },
  ],
};

function parseEnvironment(value: unknown): 'sandbox' | 'production' {
  return value === 'production' ? 'production' : 'sandbox';
}

/**
 * What the ledger freezes on the delivery row at enqueue: which credential this
 * delivery will be authenticated with, and against which environment. A channel
 * override wins when one exists; otherwise the instance row.
 *
 * Frozen rather than read live, which is the property the free
 * `retry-idempotency` assertions are actually about: an operator editing the
 * connection after enqueue must not redirect a delivery already in flight.
 */
export async function resolveLedgerFixtureFreeze(
  credentials: CredentialsPort,
  salesChannelId: string | null,
): Promise<InvoiceLedgerVendorFreeze> {
  let credentialCode = LEDGER_FIXTURE_CREDENTIAL_CODE;
  if (salesChannelId) {
    const overrideCode = ledgerFixtureChannelCredentialCode(salesChannelId);
    const override = await credentials.getByCode(overrideCode);
    if (override) credentialCode = overrideCode;
  }
  const stored = await credentials.getByCode(credentialCode);
  const environmentField = stored?.fields.find((field) => field.key === 'environment');
  return { credentialCode, environment: parseEnvironment(environmentField?.value) };
}

export interface FrozenLedgerFixtureAuth {
  apiKey: string;
  environment: 'sandbox' | 'production';
  credentialCode: string;
}

/**
 * API key from the **frozen** credential code, environment from the **frozen**
 * environment. Live settings must not redirect a delivery already enqueued.
 */
export async function loadFrozenLedgerFixtureAuth(
  delivery: Pick<LedgerDeliveryRecord, 'credentialCode' | 'environment'>,
  credentials: CredentialsPort,
): Promise<FrozenLedgerFixtureAuth | null> {
  const resolved = await credentials.resolve(delivery.credentialCode);
  if (resolved.status !== 'ok') return null;
  const apiKey = resolved.values['apiKey'];
  if (typeof apiKey !== 'string' || apiKey === '') return null;
  return {
    apiKey,
    environment: delivery.environment,
    credentialCode: delivery.credentialCode,
  };
}
