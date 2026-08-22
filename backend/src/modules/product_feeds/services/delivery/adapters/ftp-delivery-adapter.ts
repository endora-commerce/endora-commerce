import { Client as FtpClient } from 'basic-ftp';
import { Readable } from 'node:stream';
import { FEED_DELIVERY_LIMITS, type FeedDeliveryProtocol } from '@endora-commerce/contracts';
import {
  FeedDeliveryError,
  normalisePath,
  remotePath,
  type FeedDeliveryAdapter,
  type FeedDeliverySendInput,
  type FeedDeliveryTarget,
} from '../delivery-adapter.interface.js';

/**
 * FTP / FTPS delivery — feature 070.
 *
 * FTP is plaintext by nature. That is the operator's informed choice (spec
 * § SR-4), and the admin screen says so, but the adapter still does what it can:
 * `secure: true` asks for explicit TLS (`AUTH TLS`) on every connection and
 * **falls back to plaintext only when the server refuses it**, rather than
 * starting in the clear. A partner who has FTPS gets it without being asked to
 * configure a second protocol.
 *
 * ## Passive mode only, and this is not just a library limitation
 *
 * `basic-ftp` implements passive mode alone, and the reference screenshot offers
 * a Passive Mode toggle. Active mode requires the *remote* server to open a
 * connection back to this platform, which does not survive the NAT and egress
 * filtering of any containerised deployment — so `passiveMode: false` is refused
 * at write time with a sentence, rather than accepted and silently ignored.
 * Storing a setting the transport does not honour is the failure an operator
 * cannot see.
 *
 * ## Upload is atomic from the partner's point of view
 *
 * As with SFTP: written to `<name>.part`, then renamed. A poller must never pick
 * up a half-written feed.
 */

const AUTH_MARKERS = ['530', 'login incorrect', 'not logged in', 'authentication failed'];

export interface FtpDeliveryAdapterOptions {
  /** Injected so a test can drive the adapter without a container. */
  createClient?: (timeoutMs: number) => FtpClient;
  connectTimeoutMs?: number;
}

export class FtpDeliveryAdapter implements FeedDeliveryAdapter {
  readonly protocol: FeedDeliveryProtocol = 'ftp';

  private readonly createClient: (timeoutMs: number) => FtpClient;
  private readonly connectTimeoutMs: number;

  constructor(options: FtpDeliveryAdapterOptions = {}) {
    this.createClient = options.createClient ?? ((timeoutMs): FtpClient => new FtpClient(timeoutMs));
    this.connectTimeoutMs = options.connectTimeoutMs ?? FEED_DELIVERY_LIMITS.CONNECT_TIMEOUT_MS;
  }

  async send(input: FeedDeliverySendInput): Promise<void> {
    // command-coverage-ignore: this mutates a PARTNER'S filesystem, not this
    // platform's data — there is no row here to audit and no actor to attribute
    // it to. The operator write that authorised it is
    // `product_feeds.delivery.upsert`, and the transfer itself is recorded as a
    // `product_feed_delivery_attempts` row (FR-105), which is the audit trail a
    // delivery actually needs.
    await this.withClient(input.target, async (client) => {
      const directory = normalisePath(input.target.directoryPath ?? '');
      if (directory !== '') {
        try {
          await client.ensureDir(directory);
        } catch (err) {
          throw new FeedDeliveryError(
            'transfer_failed',
            `The directory "${directory}" does not exist and could not be created.`,
            err,
          );
        }
      }

      const finalPath = remotePath(input.target.directoryPath, input.filename);
      const partPath = `${finalPath}.part`;
      try {
        await client.uploadFrom(input.body, partPath);
      } catch (err) {
        await client.remove(partPath, true).catch(() => undefined);
        throw new FeedDeliveryError('transfer_failed', 'The file could not be uploaded.', err);
      }
      try {
        // Most servers refuse `RNTO` onto an existing name, and a feed is
        // overwritten on every run by design.
        await client.remove(finalPath, true).catch(() => undefined);
        await client.rename(partPath, finalPath);
      } catch (err) {
        throw new FeedDeliveryError(
          'transfer_failed',
          'The file uploaded but could not be renamed into place.',
          err,
        );
      }
    });
  }

  /** FR-106 — connect, authenticate, prove the directory is writable, send no artefact. */
  async check(target: FeedDeliveryTarget): Promise<void> {
    // command-coverage-ignore: the only write is one fixed-name probe file on
    // the partner's own server, created and removed inside this call. Nothing on
    // this platform changes, and the attempt is recorded as a test row (FR-106).
    await this.withClient(target, async (client) => {
      const directory = normalisePath(target.directoryPath ?? '');
      if (directory !== '') {
        try {
          await client.cd(directory);
        } catch (err) {
          throw new FeedDeliveryError(
            'transfer_failed',
            `The directory "${directory}" could not be opened on the target.`,
            err,
          );
        }
      }
      const probePath = remotePath(target.directoryPath, FEED_DELIVERY_LIMITS.TEST_FILENAME);
      try {
        await client.uploadFrom(
          Readable.from([Buffer.from(FEED_DELIVERY_LIMITS.TEST_PAYLOAD, 'utf8')]),
          probePath,
        );
      } catch (err) {
        throw new FeedDeliveryError(
          'transfer_failed',
          'The connection works, but the directory could not be written to.',
          err,
        );
      }
      await client.remove(probePath, true).catch(() => undefined);
    });
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async withClient(
    target: FeedDeliveryTarget,
    body: (client: FtpClient) => Promise<void>,
  ): Promise<void> {
    const client = this.createClient(this.connectTimeoutMs);
    try {
      await this.access(client, target);
      await body(client);
    } finally {
      // `close()` is synchronous and never throws for an already-closed client.
      client.close();
    }
  }

  /**
   * Explicit TLS first, plaintext only if the server will not do it. The
   * downgrade is deliberate and bounded: FTP without TLS is the protocol the
   * operator chose, and refusing it here would mean the platform supports
   * "FTP" in name only.
   */
  private async access(client: FtpClient, target: FeedDeliveryTarget): Promise<void> {
    const options = {
      host: target.host ?? '',
      port: target.port ?? 21,
      user: target.username ?? '',
      password: target.password ?? '',
    };
    try {
      await client.access({ ...options, secure: true });
      return;
    } catch (secureError) {
      if (isAuthFailure(secureError)) {
        throw new FeedDeliveryError(
          'authentication_failed',
          'The target refused the username or password.',
          secureError,
        );
      }
      try {
        await client.access({ ...options, secure: false });
      } catch (plainError) {
        throw new FeedDeliveryError(
          isAuthFailure(plainError) ? 'authentication_failed' : 'connection_failed',
          isAuthFailure(plainError)
            ? 'The target refused the username or password.'
            : `The target could not be reached at ${options.host}:${options.port}.`,
          plainError,
        );
      }
    }
  }
}

function isAuthFailure(err: unknown): boolean {
  const message = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return AUTH_MARKERS.some((marker) => message.includes(marker));
}
