import type { ConfigurationTypeDescriptor } from '@b2b/contracts';

/**
 * Core `email_adapter` configuration type (feature 058, US1 / research §R2).
 *
 * Mirrors the newsletter SMTP/SES field set. Each provider declares exactly one
 * secret field (`password` / `secretAccessKey` / `apiKey`); the rest are plain.
 * Provider meaning (how mail is actually sent) is owned by the consumer.
 */

export const emailAdapterConfigurationType: ConfigurationTypeDescriptor = {
  code: 'email_adapter',
  label: 'Email adapter',
  ownerModule: 'credentials',
  providers: [
    {
      code: 'smtp',
      label: 'SMTP',
      fields: [
        { key: 'host', label: 'Host', kind: 'string', required: true, secret: false },
        { key: 'port', label: 'Port', kind: 'number', required: true, secret: false },
        { key: 'secure', label: 'Use TLS', kind: 'boolean', required: false, secret: false },
        { key: 'username', label: 'Username', kind: 'string', required: false, secret: false },
        { key: 'password', label: 'Password', kind: 'string', required: false, secret: true },
      ],
    },
    {
      code: 'amazon_ses',
      label: 'Amazon SES',
      fields: [
        { key: 'region', label: 'Region', kind: 'string', required: true, secret: false },
        { key: 'accessKeyId', label: 'Access key ID', kind: 'string', required: true, secret: false },
        {
          key: 'secretAccessKey',
          label: 'Secret access key',
          kind: 'string',
          required: true,
          secret: true,
        },
      ],
    },
    {
      code: 'sendgrid',
      label: 'SendGrid',
      fields: [
        { key: 'apiKey', label: 'API Key', kind: 'string', required: true, secret: true },
        { key: 'senderEmail', label: 'Sender email', kind: 'string', required: true, secret: false },
      ],
    },
  ],
};
