// `@fastify/multipart` is registered here, by this module, for the one route
// that reads an upload — inside a child context of its own, so the parser and
// its limits reach no other route. The import also carries the declaration
// merging that puts `request.isMultipart()` and `request.file()` on the request.
import multipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';
import { ERROR_CODES, OPPORTUNITY_ATTACHMENT_MAX_BYTES } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import type { OpportunityAttachmentUploadService } from '../services/opportunity-attachment-upload-service.js';

export interface AttachmentUploadRoutesDeps {
  uploadService: OpportunityAttachmentUploadService;
  requireAdmin: RequireAdminFactory;
}

function noFile(): HttpError {
  return new HttpError(
    400,
    ERROR_CODES.VALIDATION_FAILED,
    'Send the file as the `file` part of a multipart/form-data request.',
  );
}

/**
 * `POST /opportunities/:id/attachments/upload`
 * (`specs/143-crm-sales-opportunities/contracts/admin-api.md` §7a) — upload a
 * file and attach it, under `crm:write` alone.
 *
 * The file is read whole before it is handed on, for one reason: a multipart
 * part carries no length, and the media library can only hold a file to its
 * size limit when it is told the size. `OPPORTUNITY_ATTACHMENT_MAX_BYTES` is
 * the bound on that read.
 */
export async function registerCrmAttachmentUploadRoutes(
  app: FastifyInstance,
  deps: AttachmentUploadRoutesDeps,
): Promise<void> {
  const { requireAdmin, uploadService } = deps;

  await app.register(async (upload) => {
    await upload.register(multipart, {
      limits: { files: 1, fields: 10, fileSize: OPPORTUNITY_ATTACHMENT_MAX_BYTES },
    });

    upload.post<{ Params: { id: string } }>(
      '/api/v1/admin/crm/opportunities/:id/attachments/upload',
      { preHandler: requireAdmin('crm:write') },
      async (request, reply) => {
        if (!request.isMultipart()) throw noFile();
        // The Opportunity before the body: one the caller cannot see is 404
        // without a byte of the file having been read.
        await uploadService.assertReachable(request.params.id);

        const file = await request.file();
        if (!file) throw noFile();
        let bytes: Buffer;
        try {
          bytes = await file.toBuffer();
        } catch (error) {
          // The parser's own refusal of a part over `limits.fileSize` — a fact
          // about the upload, answered as one.
          if ((error as { code?: string }).code !== 'FST_REQ_FILE_TOO_LARGE') throw error;
          const maxMb = OPPORTUNITY_ATTACHMENT_MAX_BYTES / (1024 * 1024);
          throw new HttpError(
            413,
            ERROR_CODES.CRM_ATTACHMENT_TOO_LARGE,
            `An attachment may be at most ${maxMb} MB.`,
            { maxMb },
          );
        }

        const attachment = await uploadService.upload(request.params.id, {
          filename: file.filename || 'attachment',
          declaredMime: file.mimetype || 'application/octet-stream',
          bytes,
        });
        reply.code(201);
        return { data: attachment };
      },
    );
  });
}
