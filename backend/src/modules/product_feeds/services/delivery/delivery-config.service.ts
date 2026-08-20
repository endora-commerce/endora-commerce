import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  FEED_DELIVERY_REDACTED,
  PRODUCT_FEED_ERROR_CODES,
  isSecretDeliveryHeader,
  type FeedDeliveryConfig,
  type CredentialsPort,
  type FeedDeliveryHeader,
  type UpsertFeedDeliveryRequest,
} from '@b2b/contracts';
import type { CommandBus } from '../../../../commands/index.js';
import { HttpError } from '../../../../http/error-envelope.js';
import { FeedDelivery } from '../../entities/feed-delivery.entity.js';
import { ProductFeed } from '../../entities/product-feed.entity.js';
import {
  makeDeleteFeedDeliveryCommand,
  makeUpsertFeedDeliveryCommand,
  type FeedDeliveryWriteValues,
} from '../../commands/feed-delivery.commands.js';
import {
  FEED_DELIVERY_CREDENTIAL_PROVIDER,
  FEED_DELIVERY_CREDENTIAL_TYPE,
  deliveryCredentialCodeFor,
} from './delivery-credential.type.js';
import { validateDeliveryTargetUrl } from './delivery-target-url.js';
import type { FeedDeliveryTarget } from './delivery-adapter.interface.js';

/**
 * The delivery configuration surface — feature 070 / FR-100, FR-101, FR-107.
 *
 * Three responsibilities, and the interesting one is the split between the
 * second and the third:
 *
 *  1. **Read** returns a shape on which every secret is a boolean. There is no
 *     code path from this class to a plaintext password over HTTP, which is what
 *     AS-5 asserts.
 *  2. **Write** splits the operator's submission in two. Everything that is not
 *     a secret goes to `product_feed_deliveries` through a Command, so it is
 *     audited once and attributed. Everything that is — the password, the SSH
 *     key, and the value of any header whose *name* says it carries a token —
 *     goes to the credentials module, which audits its own write and applies
 *     write-only semantics: an omitted, blank or `[redacted]` secret preserves
 *     what is stored, so editing a directory path cannot silently erase a key.
 *  3. **Resolve** is the one path that produces decrypted values, in memory,
 *     for a transport adapter. It is never an HTTP response body.
 *
 * The header split is **rule-driven, not operator-driven** (`isSecretDeliveryHeader`):
 * an operator who has to remember to tick "this one is secret" will one day not,
 * and the token lands in a jsonb column that every read returns.
 */

export interface DeliveryConfigServiceDeps {
  emFactory: () => EntityManager;
  commandBus: CommandBus;
  credentials: CredentialsPort;
}

export class DeliveryConfigService {
  constructor(private readonly deps: DeliveryConfigServiceDeps) {}

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  async find(productFeedId: string): Promise<FeedDelivery | null> {
    return this.deps.emFactory().findOne(FeedDelivery, { productFeedId });
  }

  /** The admin read model. Every secret is a boolean; nothing here is replayable. */
  async view(productFeedId: string): Promise<FeedDeliveryConfig | null> {
    const delivery = await this.find(productFeedId);
    if (!delivery) return null;

    const credential = await this.deps.credentials.getByCode(delivery.credentialCode);
    const isSet = (key: string): boolean =>
      credential?.fields.find((field) => field.key === key)?.isSet === true;

    // The names of the stored secret headers, so the admin can render
    // `Authorization: [redacted]` rather than losing the row from the textarea
    // — a header an operator cannot see is a header they will re-add by hand.
    const secretHeaderNames = await this.storedSecretHeaderNames(delivery.credentialCode);

    const headers: FeedDeliveryHeader[] = [
      ...Object.entries(delivery.headers).map(([name, value]) => ({
        name,
        value,
        secret: false,
        isSet: true,
      })),
      ...secretHeaderNames.map((name) => ({
        name,
        value: null,
        secret: true,
        isSet: true,
      })),
    ].sort((a, b) => a.name.localeCompare(b.name));

    return {
      id: delivery.id,
      productFeedId: delivery.productFeedId,
      enabled: delivery.enabled,
      protocol: delivery.protocol,
      httpLabel: delivery.httpLabel ?? null,
      host: delivery.host ?? null,
      port: delivery.port ?? null,
      username: delivery.username ?? null,
      directoryPath: delivery.directoryPath ?? null,
      passiveMode: delivery.passiveMode,
      requestUrl: delivery.requestUrl ?? null,
      headers,
      passwordSet: isSet('password'),
      privateKeySet: isSet('privateKey'),
      version: delivery.version,
      createdAt: delivery.createdAt.toISOString(),
      updatedAt: delivery.updatedAt.toISOString(),
    };
  }

  /**
   * The configuration merged with its decrypted secrets, for a transport
   * adapter's in-memory use only. **Never an HTTP response body.**
   *
   * Returns `null` when the configuration is gone or its credential no longer
   * resolves; the caller records `not_configured` rather than attempting a
   * half-authenticated connection.
   */
  async resolveTarget(delivery: FeedDelivery): Promise<FeedDeliveryTarget | null> {
    const resolved = await this.deps.credentials.resolve(delivery.credentialCode);
    const values = resolved.status === 'ok' ? resolved.values : {};

    const password = typeof values['password'] === 'string' ? values['password'] : null;
    const privateKey = typeof values['privateKey'] === 'string' ? values['privateKey'] : null;
    const secretHeaders = parseSecretHeaders(values['secretHeaders']);

    if (delivery.protocol === 'http') {
      if (!delivery.requestUrl) return null;
    } else if (!delivery.host || !delivery.username) {
      return null;
    } else if (password === null && privateKey === null) {
      // Neither a password nor a key: there is nothing to authenticate with, and
      // a connection attempt would only produce a confusing auth failure.
      return null;
    }

    return {
      protocol: delivery.protocol,
      host: delivery.host ?? null,
      port: delivery.port ?? null,
      username: delivery.username ?? null,
      password,
      privateKey,
      directoryPath: delivery.directoryPath ?? null,
      passiveMode: delivery.passiveMode,
      requestUrl: delivery.requestUrl ?? null,
      headers: { ...delivery.headers, ...secretHeaders },
    };
  }

  /** Every secret value in play for one target, for the redactor (FR-108). */
  static secretsOf(target: FeedDeliveryTarget, plainHeaders: Record<string, string>): string[] {
    const plainNames = new Set(Object.keys(plainHeaders).map((name) => name.toLowerCase()));
    const secretHeaderValues = Object.entries(target.headers)
      .filter(([name]) => !plainNames.has(name.toLowerCase()))
      .map(([, value]) => value);
    return [target.password, target.privateKey, ...secretHeaderValues].filter(
      (value): value is string => typeof value === 'string' && value !== '',
    );
  }

  // -------------------------------------------------------------------------
  // Writes
  // -------------------------------------------------------------------------

  /**
   * Create or replace the configuration.
   *
   * The order matters, and it is the order `ErgonodeConnectionService.upsert`
   * uses for the same reason: validate first, so a refused address writes
   * nothing anywhere; then the credential, because it is the value the row's
   * `credentialCode` has to be able to point at; then the row, as one Command.
   */
  async upsert(
    productFeedId: string,
    input: UpsertFeedDeliveryRequest,
  ): Promise<FeedDeliveryConfig> {
    await this.requireFeed(productFeedId);
    const credentialCode = deliveryCredentialCodeFor(productFeedId);

    // `buildWriteValues` always returns EVERY column, including the ones the
    // chosen protocol does not use, explicitly nulled. Switching a feed from
    // SFTP to HTTP therefore cannot leave a stale host behind on a row that is
    // now enabled and pointing at a URL.
    const values = await this.buildWriteValues(input, credentialCode);
    await this.writeCredential(credentialCode, input);

    await this.deps.commandBus.run(
      makeUpsertFeedDeliveryCommand({
        productFeedId,
        expectedVersion: input.expectedVersion ?? null,
        values,
      }),
    );

    const view = await this.view(productFeedId);
    if (!view) {
      throw new HttpError(
        500,
        ERROR_CODES.INTERNAL,
        'The delivery configuration could not be read back after saving.',
      );
    }
    return view;
  }

  /**
   * Removes the configuration and its credential. The attempt history stays:
   * "did the partner get last month's file?" is still a fair question after
   * delivery has been switched off.
   */
  async remove(productFeedId: string): Promise<void> {
    await this.requireFeed(productFeedId);
    const result = await this.deps.commandBus.run(makeDeleteFeedDeliveryCommand(productFeedId));
    if (result.credentialCode) {
      // Tolerated: a credential already gone is the state we wanted. The delete
      // must not fail a configuration removal that has already committed.
      await this.deps.credentials.delete(result.credentialCode).catch(() => undefined);
    }
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async requireFeed(productFeedId: string): Promise<ProductFeed> {
    const feed = await this.deps.emFactory().findOne(ProductFeed, { id: productFeedId });
    if (!feed) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Product feed not found.');
    return feed;
  }

  private async buildWriteValues(
    input: UpsertFeedDeliveryRequest,
    credentialCode: string,
  ): Promise<FeedDeliveryWriteValues> {
    const base = {
      enabled: input.enabled,
      protocol: input.protocol,
      credentialCode,
    };

    if (input.protocol === 'http') {
      // SR-2 / SR-4 — refused while the operator is still editing the field,
      // with a message naming the reason (AS-4), not as a failed delivery
      // tomorrow morning.
      const verdict = validateDeliveryTargetUrl(input.requestUrl);
      if (!verdict.ok) {
        throw new HttpError(400, ERROR_CODES.VALIDATION_FAILED, verdict.detail, {
          field: 'requestUrl',
          reason: PRODUCT_FEED_ERROR_CODES.DELIVERY_TARGET_REFUSED,
        });
      }
      const submitted = input.headers ?? [];
      assertNoDuplicateHeaders(submitted);
      const plainHeaders: Record<string, string> = {};
      for (const header of submitted) {
        if (isSecretDeliveryHeader(header.name)) continue;
        plainHeaders[header.name.trim()] = header.value;
      }
      return {
        ...base,
        httpLabel: input.httpLabel ?? 'http_server',
        host: null,
        port: null,
        username: null,
        directoryPath: null,
        passiveMode: true,
        requestUrl: verdict.url.toString(),
        headers: plainHeaders,
      };
    }

    if (input.protocol === 'ftp' && input.passiveMode === false) {
      // Refused rather than stored-and-ignored: active mode needs the remote
      // server to open a connection back to this platform, which does not
      // survive the NAT and egress filtering of a containerised deployment.
      throw new HttpError(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        'Active mode is not supported: it requires the FTP server to connect back to this platform. Use passive mode.',
        { field: 'passiveMode' },
      );
    }

    return {
      ...base,
      httpLabel: null,
      host: input.host,
      port: input.port ?? null,
      username: input.username,
      directoryPath: input.directoryPath?.trim() ? input.directoryPath.trim() : null,
      passiveMode: input.protocol === 'ftp' ? (input.passiveMode ?? true) : true,
      requestUrl: null,
      headers: {},
    };
  }

  /**
   * Delegates the secrets to the credentials module. An omitted, blank or
   * `[redacted]` value preserves the stored envelope there, so only the
   * *composite* `secretHeaders` blob needs merging here — replacing a JSON
   * object wholesale would drop every header the operator did not retype.
   */
  private async writeCredential(
    credentialCode: string,
    input: UpsertFeedDeliveryRequest,
  ): Promise<void> {
    const values: Record<string, unknown> = {};

    if (input.protocol !== 'http') {
      if (input.password !== undefined) values['password'] = input.password;
      if (input.protocol === 'sftp' && input.privateKey !== undefined) {
        values['privateKey'] = input.privateKey;
      }
    } else {
      const merged = await this.mergeSecretHeaders(credentialCode, input.headers ?? []);
      // An empty object still has to be written: it is how an operator removes
      // the last authenticating header. `{}` is a non-blank string, so the
      // credentials module treats it as a new value rather than as "keep".
      values['secretHeaders'] = JSON.stringify(merged);
    }

    const existingCredential = await this.deps.credentials.getByCode(credentialCode);
    if (!existingCredential) {
      await this.deps.credentials.create({
        code: credentialCode,
        name: 'Feed delivery target',
        typeCode: FEED_DELIVERY_CREDENTIAL_TYPE,
        providerCode: FEED_DELIVERY_CREDENTIAL_PROVIDER,
        values,
      });
      return;
    }
    await this.deps.credentials.update(credentialCode, { values });
  }

  /**
   * The submitted secret headers merged over the stored ones: a value of
   * `[redacted]` or blank means "keep what is there", a header absent from the
   * submission is removed, and anything else replaces.
   */
  private async mergeSecretHeaders(
    credentialCode: string,
    submitted: ReadonlyArray<{ name: string; value: string }>,
  ): Promise<Record<string, string>> {
    const stored = await this.storedSecretHeaders(credentialCode);
    const storedByLowerName = new Map(
      Object.entries(stored).map(([name, value]) => [name.toLowerCase(), value]),
    );

    const out: Record<string, string> = {};
    for (const header of submitted) {
      const name = header.name.trim();
      if (!isSecretDeliveryHeader(name)) continue;
      const keep = header.value.trim() === '' || header.value.trim() === FEED_DELIVERY_REDACTED;
      const previous = storedByLowerName.get(name.toLowerCase());
      if (keep) {
        if (previous !== undefined) out[name] = previous;
        continue;
      }
      out[name] = header.value;
    }
    return out;
  }

  private async storedSecretHeaders(credentialCode: string): Promise<Record<string, string>> {
    const resolved = await this.deps.credentials.resolve(credentialCode);
    if (resolved.status !== 'ok') return {};
    return parseSecretHeaders(resolved.values['secretHeaders']);
  }

  private async storedSecretHeaderNames(credentialCode: string): Promise<string[]> {
    return Object.keys(await this.storedSecretHeaders(credentialCode)).sort();
  }
}

/**
 * The stored `secretHeaders` blob. Tolerant on purpose: a credential written by
 * an earlier version, by a seed or by hand must not be able to crash a delivery
 * — an unparseable blob means "no authenticating headers", which the target will
 * reject with a clear 401.
 */
function parseSecretHeaders(raw: unknown): Record<string, string> {
  if (typeof raw !== 'string' || raw.trim() === '') return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string') out[name] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function assertNoDuplicateHeaders(headers: ReadonlyArray<{ name: string }>): void {
  const seen = new Set<string>();
  for (const header of headers) {
    const key = header.name.trim().toLowerCase();
    if (seen.has(key)) {
      throw new HttpError(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        `The header "${header.name}" is listed more than once.`,
        { field: 'headers' },
      );
    }
    seen.add(key);
  }
}
