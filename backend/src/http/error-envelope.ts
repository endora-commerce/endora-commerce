import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ERROR_CODES, type ErrorCode, type ErrorEnvelope } from '@b2b/contracts';
import { ZodError, type core as zodCore } from 'zod';
import { hasZodFastifySchemaValidationErrors } from '@fastify/type-provider-zod';

/**
 * Fastify plugin that converts every error — Zod validation failures, MikroORM unique-constraint
 * violations, HttpError throws, or unexpected exceptions — into the project-wide error envelope
 * documented in specs/001-b2b-platform-foundation/contracts/README.md.
 */

export class HttpError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly details?: Array<{ path: string; issue: string }>;

  constructor(
    statusCode: number,
    code: ErrorCode,
    message: string,
    details?: Array<{ path: string; issue: string }>,
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    }
    this.name = 'HttpError';
  }
}

export function registerErrorEnvelope(app: FastifyInstance): void {
  app.setErrorHandler((error, request: FastifyRequest, reply: FastifyReply) => {
    const requestId = request.id;

    // Fastify wraps Zod validation errors from the Zod type provider — detect them via
    // the helper exposed by @fastify/type-provider-zod, then fall back to a plain ZodError.
    if (hasZodFastifySchemaValidationErrors(error)) {
      const envelope: ErrorEnvelope = {
        error: {
          code: ERROR_CODES.VALIDATION_FAILED,
          message: 'Request failed validation.',
          details: error.validation.map((issue) => ({
            path: issue.instancePath.replace(/^\//, '').replace(/\//g, '.'),
            issue: issue.message ?? 'invalid',
          })),
          requestId,
        },
      };
      reply.status(400).send(envelope);
      return;
    }

    if (error instanceof ZodError) {
      const envelope: ErrorEnvelope = {
        error: {
          code: ERROR_CODES.VALIDATION_FAILED,
          message: 'Request failed validation.',
          details: error.issues.map((issue: zodCore.$ZodIssue) => ({
            path: issue.path.map(String).join('.'),
            issue: issue.message,
          })),
          requestId,
        },
      };
      reply.status(400).send(envelope);
      return;
    }

    if (error instanceof HttpError) {
      const envelope: ErrorEnvelope = {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
          requestId,
        },
      };
      reply.status(error.statusCode).send(envelope);
      return;
    }

    // MikroORM unique-constraint violation: `UniqueConstraintViolationException` has a
    // stable class name we can test without importing the full ORM type.
    if ((error as { constructor?: { name?: string } }).constructor?.name === 'UniqueConstraintViolationException') {
      const envelope: ErrorEnvelope = {
        error: {
          code: ERROR_CODES.VERSION_CONFLICT,
          message: 'Unique constraint violated.',
          requestId,
        },
      };
      reply.status(409).send(envelope);
      return;
    }

    // Fallback — 500. Log the full error; do not leak details to the client.
    request.log.error({ err: error }, 'unhandled error');
    const envelope: ErrorEnvelope = {
      error: {
        code: ERROR_CODES.INTERNAL,
        message: 'Internal server error.',
        requestId,
      },
    };
    reply.status(500).send(envelope);
  });

  // 404 fallback (Fastify's default is a plain text; we want the envelope).
  app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    const envelope: ErrorEnvelope = {
      error: {
        code: ERROR_CODES.NOT_FOUND,
        message: `Route ${request.method} ${request.url} not found.`,
        requestId: request.id,
      },
    };
    reply.status(404).send(envelope);
  });
}
