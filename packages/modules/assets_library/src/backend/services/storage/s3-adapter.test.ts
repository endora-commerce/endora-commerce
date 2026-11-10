import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';

// specs/156-asset-stable-url/contracts/storage-and-retention.md §1 and
// contracts/file-serving.md §4 — what the S3 adapter sends, recorded at the SDK seam.

const sent: Array<{ command: string; input: Record<string, unknown> }> = [];
let failNext = false;

vi.mock('@aws-sdk/client-s3', () => {
  class Command {
    constructor(public readonly input: Record<string, unknown>) {}
  }
  const named = (name: string) =>
    class extends Command {
      readonly commandName = name;
    };
  return {
    S3Client: class {
      async send(cmd: { commandName: string; input: Record<string, unknown> }) {
        sent.push({ command: cmd.commandName, input: cmd.input });
        if (failNext) {
          failNext = false;
          throw Object.assign(new Error('AccessDenied'), { name: 'AccessDenied' });
        }
        return {};
      }
    },
    PutObjectCommand: named('PutObjectCommand'),
    GetObjectCommand: named('GetObjectCommand'),
    HeadBucketCommand: named('HeadBucketCommand'),
    DeleteObjectCommand: named('DeleteObjectCommand'),
    PutObjectAclCommand: named('PutObjectAclCommand'),
    CopyObjectCommand: named('CopyObjectCommand'),
  };
});
const presigned: Array<{ command: string; input: Record<string, unknown>; options: unknown }> = [];
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(
    async (_client: unknown, cmd: { commandName: string; input: Record<string, unknown> }, options: unknown) => {
      presigned.push({ command: cmd.commandName, input: cmd.input, options });
      return 'signed';
    },
  ),
}));

const { S3StorageAdapter } = await import('./s3-adapter.js');
const { BackendUnavailableError } = await import('./errors.js');

const ID = 'aabbccdd-1111-2222-3333-444455556666';

function adapter() {
  return new S3StorageAdapter({
    bucket: 'media-bucket',
    region: 'eu-central-1',
    accessKeyId: 'key',
    secretAccessKey: 'secret',
    publicApiBaseUrl: 'https://api.example.test',
    privateUrlTtlSec: 300,
  });
}

beforeEach(() => {
  sent.length = 0;
  presigned.length = 0;
  failNext = false;
});

describe('S3StorageAdapter.put — object metadata', () => {
  it('sends CacheControl and ContentDisposition when given', async () => {
    await adapter().put({
      locator: `aa/bb/${ID}.pdf`,
      mimeType: 'application/pdf',
      visibility: 'public',
      stream: Readable.from(['x']),
      sizeBytes: 1,
      cacheControl: 'no-cache',
      contentDisposition: 'inline; filename="certificate.pdf"',
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.command).toBe('PutObjectCommand');
    expect(sent[0]!.input).toMatchObject({
      CacheControl: 'no-cache',
      ContentDisposition: 'inline; filename="certificate.pdf"',
      ACL: 'public-read',
    });
  });

  it('omits them otherwise', async () => {
    await adapter().put({
      locator: `aa/bb/${ID}.pdf`,
      mimeType: 'application/pdf',
      visibility: 'private',
      stream: Readable.from(['x']),
      sizeBytes: 1,
    });
    expect(sent[0]!.input).not.toHaveProperty('CacheControl');
    expect(sent[0]!.input).not.toHaveProperty('ContentDisposition');
  });
});

describe('S3StorageAdapter.copy', () => {
  const from = `media/aa/bb/${ID}.stage-${'0'.repeat(32)}.pdf`;
  const to = `media/aa/bb/${ID}.pdf`;

  it.each([
    ['public', 'public-read'],
    ['private', 'private'],
  ] as const)('sends one CopyObjectCommand replacing metadata, ACL %s → %s', async (visibility, acl) => {
    await adapter().copy({
      from,
      to,
      visibility,
      mimeType: 'application/pdf',
      cacheControl: 'no-cache',
      contentDisposition: 'inline; filename="certificate.pdf"',
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.command).toBe('CopyObjectCommand');
    expect(sent[0]!.input).toEqual({
      Bucket: 'media-bucket',
      CopySource: `media-bucket/${from.split('/').map(encodeURIComponent).join('/')}`,
      Key: to,
      MetadataDirective: 'REPLACE',
      ContentType: 'application/pdf',
      CacheControl: 'no-cache',
      ContentDisposition: 'inline; filename="certificate.pdf"',
      ACL: acl,
    });
  });

  it('url-encodes the source key', async () => {
    await adapter().copy({ from: 'a b/c+d.pdf', to, visibility: 'private', mimeType: 'application/pdf' });
    expect(sent[0]!.input.CopySource).toBe('media-bucket/a%20b/c%2Bd.pdf');
    expect(sent[0]!.input.ACL).toBe('private');
  });

  it('turns a rejected send into BackendUnavailableError', async () => {
    failNext = true;
    await expect(
      adapter().copy({ from, to, visibility: 'public', mimeType: 'application/pdf' }),
    ).rejects.toBeInstanceOf(BackendUnavailableError);
  });
});

// Issue #815 — a bucket response cannot carry `X-Content-Type-Options`, so the
// signed URL at least pins the type and disposition the bucket answers with.
describe('S3StorageAdapter.resolveUrl — response overrides on a signed URL', () => {
  it('signs ResponseContentType and ResponseContentDisposition when given', async () => {
    const out = await adapter().resolveUrl({
      locator: `aa/bb/${ID}.pdf`,
      visibility: 'private',
      responseHeaders: {
        contentType: 'application/pdf',
        contentDisposition: 'attachment; filename="scan.pdf"',
      },
    });
    expect(out.url).toBe('signed');
    expect(presigned).toHaveLength(1);
    expect(presigned[0]!.command).toBe('GetObjectCommand');
    expect(presigned[0]!.input).toEqual({
      Bucket: 'media-bucket',
      Key: `aa/bb/${ID}.pdf`,
      ResponseContentType: 'application/pdf',
      ResponseContentDisposition: 'attachment; filename="scan.pdf"',
    });
    expect(presigned[0]!.options).toEqual({ expiresIn: 300 });
  });

  it('signs a bare GetObject without them', async () => {
    await adapter().resolveUrl({ locator: `aa/bb/${ID}.pdf`, visibility: 'private' });
    expect(presigned[0]!.input).toEqual({ Bucket: 'media-bucket', Key: `aa/bb/${ID}.pdf` });
  });

  it('never signs a public URL, overrides or not', async () => {
    const out = await adapter().resolveUrl({
      locator: `aa/bb/${ID}.pdf`,
      visibility: 'public',
      responseHeaders: { contentType: 'application/pdf', contentDisposition: 'inline' },
    });
    expect(presigned).toHaveLength(0);
    expect(out.expiresAt).toBeNull();
  });
});
