import { describe, expect, it } from 'vitest';
import {
  isSecretDeliveryHeader,
  upsertFeedDeliveryRequestSchema,
} from '@endora-commerce/contracts';
import {
  describeTarget,
  normalisePath,
  remotePath,
} from './delivery/delivery-adapter.interface.js';
import { artefactFilename } from './artefact-filename.js';

/**
 * Feature 070 — the boundary shapes.
 *
 * The discriminated union is the reason a body carrying an SFTP host and an HTTP
 * request URL cannot exist: the table is deliberately permissive (three
 * protocols, nullable columns), so the schema is where the combination is made
 * unrepresentable.
 */

describe('upsertFeedDeliveryRequestSchema', () => {
  it('accepts a minimal SFTP body', () => {
    const parsed = upsertFeedDeliveryRequestSchema.safeParse({
      enabled: true,
      protocol: 'sftp',
      host: 'sftp.partner.example',
      username: 'acme',
      password: 'hunter2',
      directoryPath: '/incoming/feeds',
    });
    expect(parsed.success).toBe(true);
  });

  it('refuses an SFTP body carrying an HTTP request URL', () => {
    const parsed = upsertFeedDeliveryRequestSchema.safeParse({
      enabled: true,
      protocol: 'sftp',
      host: 'sftp.partner.example',
      username: 'acme',
      requestUrl: 'https://partner.example/ingest',
    });
    // `requestUrl` is simply not part of the sftp member, so the object parses
    // with it stripped — what must NOT happen is an http-shaped body passing as
    // sftp with no host.
    expect(parsed.success).toBe(true);
    expect(parsed.success && 'requestUrl' in parsed.data).toBe(false);
  });

  it('refuses an SFTP body with no host and no username', () => {
    expect(
      upsertFeedDeliveryRequestSchema.safeParse({ enabled: true, protocol: 'sftp' }).success,
    ).toBe(false);
  });

  it('refuses an HTTP body with no request URL', () => {
    expect(
      upsertFeedDeliveryRequestSchema.safeParse({ enabled: true, protocol: 'http' }).success,
    ).toBe(false);
  });

  it('refuses a header value carrying CR or LF — that is a second header', () => {
    const parsed = upsertFeedDeliveryRequestSchema.safeParse({
      enabled: true,
      protocol: 'http',
      requestUrl: 'https://partner.example/ingest',
      headers: [{ name: 'X-Shop', value: 'acme\r\nAuthorization: Bearer stolen' }],
    });
    expect(parsed.success).toBe(false);
  });

  it('refuses a header name that is not a token', () => {
    const parsed = upsertFeedDeliveryRequestSchema.safeParse({
      enabled: true,
      protocol: 'http',
      requestUrl: 'https://partner.example/ingest',
      headers: [{ name: 'X Shop', value: 'acme' }],
    });
    expect(parsed.success).toBe(false);
  });

  it('refuses an out-of-range port', () => {
    const body = {
      enabled: true,
      protocol: 'ftp' as const,
      host: 'ftp.partner.example',
      username: 'acme',
    };
    expect(upsertFeedDeliveryRequestSchema.safeParse({ ...body, port: 0 }).success).toBe(false);
    expect(upsertFeedDeliveryRequestSchema.safeParse({ ...body, port: 70_000 }).success).toBe(
      false,
    );
    expect(upsertFeedDeliveryRequestSchema.safeParse({ ...body, port: 2222 }).success).toBe(true);
  });
});

describe('isSecretDeliveryHeader — FR-107, rule-driven not operator-driven', () => {
  it('treats the known authenticating names as secret, case-insensitively', () => {
    for (const name of ['Authorization', 'authorization', 'Proxy-Authorization', 'Cookie']) {
      expect(isSecretDeliveryHeader(name)).toBe(true);
    }
  });

  it('treats a name ending in a credential-shaped suffix as secret', () => {
    for (const name of ['X-Api-Key', 'X-Partner-Token', 'X-Client-Secret', 'X-Ftp-Password']) {
      expect(isSecretDeliveryHeader(name)).toBe(true);
    }
  });

  it('leaves ordinary headers plain', () => {
    for (const name of ['Content-Type', 'X-Shop-Id', 'Accept', 'User-Agent']) {
      expect(isSecretDeliveryHeader(name)).toBe(false);
    }
  });
});

describe('target rendering — FR-108', () => {
  it('drops the query string from an HTTP target: it often carries the token', () => {
    const rendered = describeTarget({
      protocol: 'http',
      host: null,
      port: null,
      username: null,
      password: null,
      privateKey: null,
      directoryPath: null,
      passiveMode: true,
      requestUrl: 'https://partner.example/ingest?key=s3cret',
      headers: {},
    });
    expect(rendered).toBe('https://partner.example/ingest');
    expect(rendered).not.toContain('s3cret');
  });

  it('renders an SFTP target as user@host:port/path and never the password', () => {
    const rendered = describeTarget({
      protocol: 'sftp',
      host: 'sftp.partner.example',
      port: 2222,
      username: 'acme',
      password: 'hunter2',
      privateKey: null,
      directoryPath: 'incoming/feeds/',
      passiveMode: true,
      requestUrl: null,
      headers: {},
    });
    expect(rendered).toBe('sftp://acme@sftp.partner.example:2222/incoming/feeds');
    expect(rendered).not.toContain('hunter2');
  });
});

describe('remote path joining', () => {
  it('normalises a directory to a leading slash and no trailing slash', () => {
    expect(normalisePath('incoming/feeds/')).toBe('/incoming/feeds');
    expect(normalisePath('/incoming/feeds')).toBe('/incoming/feeds');
    expect(normalisePath('  ')).toBe('');
  });

  it('joins a filename onto a directory, and stands alone without one', () => {
    expect(remotePath('/incoming', 'feed.xml')).toBe('/incoming/feed.xml');
    expect(remotePath(null, 'feed.xml')).toBe('feed.xml');
  });
});

describe('artefactFilename — one name for the download and the upload', () => {
  it('maps every media type the serializers emit', () => {
    expect(artefactFilename('acme', 'application/xml; charset=utf-8')).toBe('acme.xml');
    expect(artefactFilename('acme', 'text/csv; charset=utf-8')).toBe('acme.csv');
    expect(artefactFilename('acme', 'text/tab-separated-values; charset=utf-8')).toBe('acme.tsv');
    expect(artefactFilename('acme', 'text/plain; charset=utf-8')).toBe('acme.txt');
    expect(
      artefactFilename(
        'acme',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ),
    ).toBe('acme.xlsx');
  });
});
