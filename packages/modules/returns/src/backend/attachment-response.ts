import { Readable } from 'node:stream';
import type { FastifyReply } from 'fastify';
import type { ServedAttachment } from './services/return-attachment-service.js';

/** The assets library's sandbox policy: a served file can run nothing (research R-12). */
const SANDBOX_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

/**
 * Stream a case's file (`specs/180-off-platform-complaints/` admin-api.md §B3,
 * customer-api.md §C5): the stored, sniffed type with `nosniff`, never cached, and a
 * download unless `inline` is asked for an image.
 */
export function sendAttachment(reply: FastifyReply, served: ServedAttachment, opts: { inlineImages: boolean }): FastifyReply {
  const inline = opts.inlineImages && served.mimeType.startsWith('image/');
  const ascii = served.filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  reply
    .header('Content-Type', served.mimeType)
    .header('X-Content-Type-Options', 'nosniff')
    .header('Content-Security-Policy', SANDBOX_CSP)
    .header('Cache-Control', 'private, no-store')
    .header(
      'Content-Disposition',
      `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(served.filename)}`,
    );
  if (served.sizeBytes > 0) reply.header('Content-Length', String(served.sizeBytes));
  return reply.send(Readable.from(served.stream));
}
