import SftpClient from 'ssh2-sftp-client';
import { FEED_DELIVERY_LIMITS, type FeedDeliveryProtocol } from '@b2b/contracts';
import {
  FeedDeliveryError,
  normalisePath,
  remotePath,
  type FeedDeliveryAdapter,
  type FeedDeliverySendInput,
  type FeedDeliveryTarget,
} from '../delivery-adapter.interface.js';

/**
 * SFTP delivery — feature 070, the target the operator request named first.
 *
 * SFTP is SSH-framed binary: there is no standard-library path to it and nothing
 * already in this stack speaks it, which is the Constitution IV justification
 * recorded in `plan.md` § Complexity tracking for `ssh2-sftp-client`.
 *
 * ## Two ways to authenticate, and why both
 *
 * A password and a private key are both offered because partners are split
 * roughly evenly between them and a platform that supports only one turns "we
 * can deliver to you" into "we can deliver to you if your ops team changes their
 * policy". Both come out of the credentials module; neither is ever written to
 * disk — `ssh2` takes the key as a string, which is also why shelling out to
 * `sftp(1)` was rejected: that path requires materialising the key as a file.
 *
 * ## Upload is atomic from the partner's point of view
 *
 * The artefact is written to `<name>.part` and renamed into place. A partner
 * polling the directory must never pick up a file that is still being written —
 * that is the classic way a feed integration ingests half a catalogue and
 * disables the products that "disappeared". The rename is the one operation SFTP
 * gives us that the partner's poller cannot observe mid-flight.
 */

/** `ssh2` reports a failed password/key with these in the message. */
const AUTH_MARKERS = [
  'all configured authentication methods failed',
  'authentication failure',
  'permission denied',
  'no matching authentication',
];

export interface SftpDeliveryAdapterOptions {
  /** Injected so a test can drive the adapter without a container. */
  createClient?: () => SftpClient;
  connectTimeoutMs?: number;
}

export class SftpDeliveryAdapter implements FeedDeliveryAdapter {
  readonly protocol: FeedDeliveryProtocol = 'sftp';

  private readonly createClient: () => SftpClient;
  private readonly connectTimeoutMs: number;

  constructor(options: SftpDeliveryAdapterOptions = {}) {
    this.createClient = options.createClient ?? ((): SftpClient => new SftpClient());
    this.connectTimeoutMs = options.connectTimeoutMs ?? FEED_DELIVERY_LIMITS.CONNECT_TIMEOUT_MS;
  }

  async send(input: FeedDeliverySendInput): Promise<void> {
    await this.withClient(input.target, async (client) => {
      const directory = normalisePath(input.target.directoryPath ?? '');
      if (directory !== '') await ensureDirectory(client, directory);

      const finalPath = remotePath(input.target.directoryPath, input.filename);
      const partPath = `${finalPath}.part`;
      try {
        await client.put(input.body, partPath);
      } catch (err) {
        // Best effort: a half-written temporary file left behind would be
        // collected by the next attempt's overwrite anyway, but leaving the
        // partner's directory tidy is cheap.
        await client.delete(partPath, true).catch(() => undefined);
        throw new FeedDeliveryError('transfer_failed', 'The file could not be uploaded.', err);
      }
      try {
        // `delete` first: SFTP `rename` refuses an existing destination on most
        // servers, and a feed is overwritten on every run by design.
        await client.delete(finalPath, true).catch(() => undefined);
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

  /**
   * FR-106 — connect, authenticate, and prove the directory is actually
   * writable, which is the failure a "connection test" that only connects would
   * miss entirely. One small fixed-name file, written and removed; no artefact.
   */
  async check(target: FeedDeliveryTarget): Promise<void> {
    await this.withClient(target, async (client) => {
      const directory = normalisePath(target.directoryPath ?? '');
      if (directory !== '') {
        const exists = await client.exists(directory === '' ? '.' : directory);
        if (exists === false) {
          throw new FeedDeliveryError(
            'transfer_failed',
            `The directory "${directory}" does not exist on the target.`,
          );
        }
      }
      const probePath = remotePath(target.directoryPath, FEED_DELIVERY_LIMITS.TEST_FILENAME);
      try {
        await client.put(Buffer.from(FEED_DELIVERY_LIMITS.TEST_PAYLOAD, 'utf8'), probePath);
      } catch (err) {
        throw new FeedDeliveryError(
          'transfer_failed',
          'The connection works, but the directory could not be written to.',
          err,
        );
      }
      await client.delete(probePath, true).catch(() => undefined);
    });
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * Connects, runs the body, and closes — always, including on the throw path.
   * A leaked SSH connection is a file descriptor and a remote session that
   * survive the worker's job, and a scheduled feed would leak one per run.
   */
  private async withClient(
    target: FeedDeliveryTarget,
    body: (client: SftpClient) => Promise<void>,
  ): Promise<void> {
    const client = this.createClient();
    try {
      try {
        await client.connect({
          host: target.host ?? '',
          port: target.port ?? 22,
          username: target.username ?? '',
          ...(target.password ? { password: target.password } : {}),
          ...(target.privateKey ? { privateKey: target.privateKey } : {}),
          readyTimeout: this.connectTimeoutMs,
          // One attempt: the caller already retries with backoff (FR-104), and a
          // library-level retry would multiply into a lockout on a target that
          // counts failed logins.
          retries: 0,
        });
      } catch (err) {
        throw new FeedDeliveryError(
          classifyConnectFailure(err),
          classifyConnectFailure(err) === 'authentication_failed'
            ? 'The target refused the username, password or key.'
            : `The target could not be reached at ${target.host ?? '(no host)'}:${target.port ?? 22}.`,
          err,
        );
      }
      await body(client);
    } finally {
      await client.end().catch(() => undefined);
    }
  }
}

/**
 * Creates the directory chain if it is missing. A partner who says "put it in
 * `/incoming/feeds`" usually means the directory should exist; failing the
 * delivery because one level of it does not is a support ticket, not a
 * safeguard.
 */
async function ensureDirectory(client: SftpClient, directory: string): Promise<void> {
  const exists = await client.exists(directory).catch(() => false);
  if (exists !== false) return;
  try {
    await client.mkdir(directory, true);
  } catch (err) {
    throw new FeedDeliveryError(
      'transfer_failed',
      `The directory "${directory}" does not exist and could not be created.`,
      err,
    );
  }
}

function classifyConnectFailure(err: unknown): 'authentication_failed' | 'connection_failed' {
  const message = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return AUTH_MARKERS.some((marker) => message.includes(marker))
    ? 'authentication_failed'
    : 'connection_failed';
}
