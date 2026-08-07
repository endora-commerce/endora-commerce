import type { ConfigurationTypeDescriptor } from '@b2b/contracts';

/**
 * The `product_feeds_delivery` configuration type — feature 070 / FR-107.
 *
 * Every secret a delivery target needs lives here rather than in a column of
 * this module's own: the password, the SSH private key, and the value of any
 * header whose name says it carries a token. Registering them on the credentials
 * module's process-wide registry buys AES-256-GCM at rest, masking on every
 * read, and the "never returned in full over HTTP" guarantee with no crypto of
 * this module's own.
 *
 * **One provider variant carries all three protocols' secrets**, rather than one
 * variant per protocol. A configuration's `providerCode` is immutable after
 * create (`CREDENTIAL_TYPE_IMMUTABLE`), so per-protocol variants would mean an
 * operator switching a feed from FTP to SFTP could never reuse the credential
 * row — they would get a refusal naming an internal constraint they cannot see.
 * The fields are all optional; which ones matter is decided by the delivery
 * configuration's `protocol`, which is this module's business, not the
 * credentials core's (Principle XIV).
 *
 * `secretHeaders` is a JSON object serialised into one secret field. A field per
 * header name is impossible — the names are operator-chosen and the descriptor
 * is static — and storing them as separate non-secret entries is exactly what
 * FR-107 forbids.
 */
export const FEED_DELIVERY_CREDENTIAL_TYPE = 'product_feeds_delivery';
export const FEED_DELIVERY_CREDENTIAL_PROVIDER = 'target';

export const feedDeliveryConfigurationType: ConfigurationTypeDescriptor = {
  code: FEED_DELIVERY_CREDENTIAL_TYPE,
  label: 'Product feed delivery target',
  ownerModule: 'product_feeds',
  providers: [
    {
      code: FEED_DELIVERY_CREDENTIAL_PROVIDER,
      label: 'Delivery target',
      fields: [
        {
          key: 'password',
          label: 'Password',
          kind: 'string',
          required: false,
          secret: true,
        },
        {
          key: 'privateKey',
          label: 'Private key',
          kind: 'string',
          required: false,
          secret: true,
        },
        {
          key: 'secretHeaders',
          label: 'Authenticating headers',
          kind: 'string',
          required: false,
          secret: true,
        },
      ],
    },
  ],
};

/**
 * The credential code for one feed's delivery target. Derived from the feed id
 * rather than generated, so the credential survives the delivery row being
 * deleted and recreated — the operator who re-enables delivery after switching
 * it off does not have to retype the password.
 */
export function deliveryCredentialCodeFor(productFeedId: string): string {
  return `product_feeds.delivery.${productFeedId}`;
}
