// `@fastify/multipart` is registered here, by this module, for the two routes that read
// an upload — inside a child context of its own, as `crm`'s `routes.attachment-upload.ts`
// does, so the parser and its limits reach no other route. The import also carries the
// declaration merging that puts `request.isMultipart()` and `request.file()` on the
// request.
import multipart from '@fastify/multipart';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import {
  ERROR_CODES,
  RETURN_ATTACHMENT_LIMITS,
  returnAttachmentUploadFieldsSchema,
  type ReturnAttachmentType,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { IncomingFile, ReturnAttachmentService } from './services/return-attachment-service.js';
import { tooLarge } from './services/return-attachment-service.js';
import type { ReturnCustomerContext } from './services/return-case-scope.js';

/**
 * The customer's uploads (`specs/180-off-platform-complaints/` customer-api.md §C2, §C4,
 * research R-12): a pending upload the filing claims, and a file added to an open case.
 */
export interface ReturnsUploadRoutesDeps {
  attachmentService: ReturnAttachmentService;
  requireCustomer: (req: FastifyRequest, reply: unknown) => Promise<void>;
  /** `requireCustomer` plus the `returns.create` gate: an upload exists only to be filed. */
  createsReturns: Array<(req: FastifyRequest, reply: unknown) => Promise<void> | void>;
  customerContextOf: (req: FastifyRequest) => ReturnCustomerContext;
}

function noFile(): HttpError {
  return new HttpError(
    400,
    ERROR_CODES.VALIDATION_FAILED,
    'Send the file as the `file` part of a multipart/form-data request, after a `type` field.',
  );
}

/**
 * One file and its non-file fields, as the parser read them, the fields judged by
 * `fieldsSchema`. Exported for the guest routes (`specs/181-guest-complaints/` G6, G10),
 * which register the same parser in a child context of their own.
 */
export async function readMultipartFile<T extends { type: ReturnAttachmentType }>(
  request: FastifyRequest,
  fieldsSchema: z.ZodType<T>,
): Promise<{ filename: string; bytes: Buffer; fields: T }> {
  if (!request.isMultipart()) throw noFile();
  const file = await request.file();
  if (!file) throw noFile();
  const fields: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(file.fields)) {
    const one = Array.isArray(field) ? field[0] : field;
    if (one && one.type === 'field') fields[name] = one.value;
  }
  const parsed = fieldsSchema.safeParse(fields);
  if (!parsed.success) throw noFile();
  let bytes: Buffer;
  try {
    bytes = await file.toBuffer();
  } catch (error) {
    if ((error as { code?: string }).code !== 'FST_REQ_FILE_TOO_LARGE') throw error;
    throw tooLarge();
  }
  return { filename: file.filename || 'attachment', bytes, fields: parsed.data };
}

/** The parser's options for a return's upload: one file, the per-file limit. */
export const RETURN_UPLOAD_MULTIPART_OPTIONS = {
  limits: { files: 1, fields: 5, fileSize: RETURN_ATTACHMENT_LIMITS.maxFileBytes },
} as const;

/** One file and its fields, as the parser read them. */
async function readFile(request: FastifyRequest): Promise<IncomingFile> {
  const { filename, bytes, fields } = await readMultipartFile(request, returnAttachmentUploadFieldsSchema);
  return {
    type: fields.type,
    filename,
    bytes,
    ...(fields.returnCaseItemId ? { returnCaseItemId: fields.returnCaseItemId } : {}),
  };
}

export async function registerReturnsUploadRoutes(app: FastifyInstance, deps: ReturnsUploadRoutesDeps): Promise<void> {
  await app.register(async (upload) => {
    await upload.register(multipart, RETURN_UPLOAD_MULTIPART_OPTIONS);

    upload.post('/api/v1/returns/uploads', { preHandler: deps.createsReturns }, async (request, reply) => {
      const data = await deps.attachmentService.storeUpload(deps.customerContextOf(request), await readFile(request));
      reply.code(201);
      return { data };
    });

    upload.post<{ Params: { id: string } }>(
      '/api/v1/returns/:id/attachments',
      { preHandler: deps.requireCustomer },
      async (request, reply) => {
        const data = await deps.attachmentService.addToCase(
          request.params.id,
          deps.customerContextOf(request),
          await readFile(request),
        );
        reply.code(201);
        return { data };
      },
    );
  });
}
