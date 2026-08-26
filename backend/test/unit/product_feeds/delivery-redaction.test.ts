import { describe, expect, it } from 'vitest';
import {
  REDACTED_MARKER,
  redactSecrets,
  toFailureDetail,
} from '../../../../packages/modules/product_feeds/src/backend/services/delivery/delivery-redaction.js';

/**
 * Feature 070 / FR-108 — nothing a delivery attempt records may be a credential.
 *
 * The cases below are the real ones. `ssh2` names the authentication it tried,
 * `basic-ftp` echoes the control conversation with the `PASS` line in it, and a
 * fetch failure stringifies the request. Every one of those ends up in
 * `failure_detail`, which is rendered on an admin screen.
 */

describe('redactSecrets', () => {
  it('removes a password a transport echoed back verbatim', () => {
    const line = 'FTP response: 530 Login incorrect for user acme with PASS hunter2xyz';
    expect(redactSecrets(line, { secrets: ['hunter2xyz'] })).toBe(
      `FTP response: 530 Login incorrect for user acme with PASS ${REDACTED_MARKER}`,
    );
  });

  it('is case-insensitive — a transport may upper-case what it echoes', () => {
    expect(redactSecrets('token=ABCDEF', { secrets: ['abcdef'] })).toBe(
      `token=${REDACTED_MARKER}`,
    );
  });

  it('removes every occurrence, not only the first', () => {
    const out = redactSecrets('tried s3cret, retrying with s3cret', { secrets: ['s3cret'] });
    expect(out).not.toContain('s3cret');
    expect(out.match(new RegExp(REDACTED_MARKER.replace(/[[\]]/g, '\\$&'), 'g'))).toHaveLength(2);
  });

  it('removes a single quoted LINE of a private key, not only the whole block', () => {
    const key = [
      '-----BEGIN OPENSSH PRIVATE KEY-----',
      'b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAAB',
      '-----END OPENSSH PRIVATE KEY-----',
    ].join('\n');
    const line = `parse error near b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAAB`;
    expect(redactSecrets(line, { secrets: [key] })).toBe(`parse error near ${REDACTED_MARKER}`);
  });

  it('leaves a short "secret" alone — blanking "ab" would shred the message', () => {
    expect(redactSecrets('an unstable connection', { secrets: ['ab'] })).toBe(
      'an unstable connection',
    );
  });

  it('ignores null and undefined secrets rather than throwing', () => {
    expect(redactSecrets('all fine', { secrets: [null, undefined] })).toBe('all fine');
  });
});

describe('toFailureDetail', () => {
  it('renders one line with no stack and the secret gone', () => {
    const err = new Error('connect ECONNREFUSED\n  at Socket.<anonymous>\npassword=letmein99');
    const detail = toFailureDetail(err, { secrets: ['letmein99'] });
    expect(detail).not.toContain('letmein99');
    expect(detail).not.toContain('\n');
    expect(detail).toContain('ECONNREFUSED');
  });

  it('bounds the length, so one chatty library cannot flood the table', () => {
    const detail = toFailureDetail(new Error('x'.repeat(9_000)), { secrets: [] });
    expect(detail.length).toBeLessThanOrEqual(2_000);
  });

  it('survives a thrown non-Error', () => {
    expect(toFailureDetail({ toString: () => 'weird' }, { secrets: [] })).toBe('weird');
  });
});
