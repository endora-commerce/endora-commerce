import type { Readable } from 'node:stream';
import type { FeedDeliveryProtocol } from '@endora-commerce/contracts';

/**
 * The delivery transport SPI — feature 070 / plan.md § Transport SPI.
 *
 * One interface, three implementations, and the seam an overlay uses to add a
 * partner's bespoke protocol with `tsc` as the contract gate (Principle XV).
 *
 * **A stream in, never a buffer.** A feed artefact is routinely tens of
 * megabytes and the serializers were built so that nothing in this module ever
 * holds a whole one — an adapter that took a `Buffer` would undo that at the
 * last step, which is the step where the process is also holding a socket.
 */

/**
 * A fully resolved target: the configuration merged with the decrypted secrets.
 * **This object is never logged, never recorded and never returned over HTTP.**
 * It exists between `DeliveryService` resolving a credential and an adapter
 * finishing its send.
 */
export interface FeedDeliveryTarget {
  protocol: FeedDeliveryProtocol;
  /** sftp / ftp. */
  host: string | null;
  /** Null means the adapter's own protocol default. */
  port: number | null;
  username: string | null;
  password: string | null;
  /** SFTP only; an OpenSSH private key in PEM form. */
  privateKey: string | null;
  directoryPath: string | null;
  passiveMode: boolean;
  /** http. */
  requestUrl: string | null;
  /** Plain and secret headers already merged; the adapter cannot tell them apart. */
  headers: Record<string, string>;
}

export interface FeedDeliverySendInput {
  /** Consumed exactly once. Length is unknown up front — feeds are streamed. */
  body: Readable;
  /** The name the file takes on the target. */
  filename: string;
  contentType: string;
  /** Known for an artefact read back from storage; used only where a protocol needs it. */
  byteSize: number | null;
  target: FeedDeliveryTarget;
  /** Cancels the attempt when the whole-delivery budget runs out. */
  signal?: AbortSignal;
}

/**
 * The transport refusal every adapter throws now lives in
 * `@endora-commerce/contracts` (feature 080, T040b) — re-exported here so the
 * adapters beside this file keep one import, and because it is part of this
 * SPI whichever package declares it.
 *
 * It moved because an adapter is a **contribution**: the composition roots
 * contribute the real three and the test harness contributes refusing ones, so
 * the class has to be nameable from outside this module. Once `product_feeds`
 * is a package, a second evaluation of these sources would be a second class
 * object and `DeliveryService`'s `instanceof` would be false across the two
 * copies — every declared refusal reclassified as `internal_error` and made
 * retryable, silently (D-160.6.1).
 */
export { FeedDeliveryError } from '@endora-commerce/contracts';

export interface FeedDeliveryAdapter {
  readonly protocol: FeedDeliveryProtocol;

  /** Delivers the artefact. Resolves on success; throws {@link FeedDeliveryError}. */
  send(input: FeedDeliverySendInput): Promise<void>;

  /**
   * FR-106 — proves reachability and authentication and **sends no artefact**.
   *
   * It must also not be usable as a general-purpose request tool (SR-5): the
   * HTTP check sends a fixed, non-operator-controlled body, and the file
   * transports write and immediately remove one small fixed-name file, which is
   * the only way to prove a directory is actually writable.
   */
  check(target: FeedDeliveryTarget, signal?: AbortSignal): Promise<void>;
}

/** The redacted display form recorded on every attempt (FR-108). */
export function describeTarget(target: FeedDeliveryTarget): string {
  if (target.protocol === 'http') {
    // Query and fragment dropped: a partner's ingest URL sometimes carries the
    // token as a parameter, and this string is shown to every reader.
    try {
      const url = new URL(target.requestUrl ?? '');
      return `${url.origin}${url.pathname}`;
    } catch {
      return 'https://(unparseable)';
    }
  }
  const user = target.username ? `${target.username}@` : '';
  const port = target.port ? `:${target.port}` : '';
  const path = target.directoryPath ? normalisePath(target.directoryPath) : '/';
  return `${target.protocol}://${user}${target.host ?? '(no host)'}${port}${path}`;
}

/** Leading slash, no trailing slash, so joining a filename is unambiguous. */
export function normalisePath(directoryPath: string): string {
  const trimmed = directoryPath.trim().replace(/\/+$/, '');
  if (trimmed === '') return '';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

/** Joins a directory and a filename for a remote POSIX-style filesystem. */
export function remotePath(directoryPath: string | null, filename: string): string {
  const directory = normalisePath(directoryPath ?? '');
  return directory === '' ? filename : `${directory}/${filename}`;
}
