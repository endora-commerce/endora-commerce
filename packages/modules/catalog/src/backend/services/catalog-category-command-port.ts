import { z, type ZodType } from 'zod';
import {
  createCategoryRequestSchema,
  ERROR_CODES,
  thresholdTripleSchema,
  updateCategoryRequestSchema,
  uuidSchema,
  type AggregateCommandOptions,
  type CatalogCategoryCommandPort,
  type CatalogCategoryRecord,
  type CategoryInventoryThresholdPatch,
  type CategoryMoveInput,
  type CreateCategoryRequest,
  type CustomFieldMerge,
  type UpdateCategoryInput,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { assertCallerSource, type CallerOptions } from '../commands/caller-options.js';
import { toCatalogCategoryRecord } from './catalog-category-read.service.js';
import type { CategoryAdminService } from './category-admin.service.js';

/**
 * `catalogCategoryCommandPort` (`specs/186-aggregate-ports/` US8, issue #1826)
 * — the Category aggregate's write port. The contract, the refusals and the
 * options are `CatalogCategoryCommandPort` in `@endora-commerce/contracts`.
 *
 * **It checks no permission.** The caller is the gate. Each method validates
 * `source` before it reads anything (issue #1922), parses its input with the
 * admin route's schema (a refusal is `422 VALIDATION_FAILED`), and runs the
 * Command factory the route runs, through the route's own runner,
 * `CategoryAdminService`, which adds the caller's `source` and `extensions`
 * (`withCallerOptions`) and performs what the route does beside the write —
 * the default-channel bind after a create. `expectedVersion` is ignored: a
 * category has no version (research R-5).
 *
 * The service arrives as a getter so it is resolved from the container per
 * call — the module's own gated port, which a singleton may not hold.
 */

/** `move`'s input, as the admin `PATCH` would carry it: a parent (or none) and an optional sort order. */
const moveInputSchema = z
  .object({ parentId: uuidSchema.nullable(), position: z.number().int().optional() })
  .strict();

/** `setInventoryThresholds`' patch, with the bounds of `inventory`'s `PATCH …/thresholds`. */
const thresholdPatchSchema = thresholdTripleSchema.partial().strict();

/**
 * Parses a port input with the admin route's schema; a refusal is the
 * platform's `422 VALIDATION_FAILED` with a field error per issue.
 */
function parseOrRefuse<T>(schema: ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new HttpError(
    422,
    ERROR_CODES.VALIDATION_FAILED,
    'The category write is invalid.',
    parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), issue: issue.message })),
  );
}

/** Drops the keys a parse answered as `undefined`: an absent key is left alone, never written. */
function definedOnly<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

/**
 * The caller's options as the Commands take them. `source` is refused here,
 * first, so nothing is read or written for a malformed one (issue #1922).
 */
function callerOf(options: AggregateCommandOptions): CallerOptions {
  assertCallerSource(options);
  return { source: options.source, extensions: options.extensions };
}

export class CatalogCategoryCommandService implements CatalogCategoryCommandPort {
  constructor(private readonly getService: () => CategoryAdminService) {}

  async create(input: CreateCategoryRequest, options: AggregateCommandOptions = {}): Promise<CatalogCategoryRecord> {
    const caller = callerOf(options);
    const body = definedOnly(parseOrRefuse(createCategoryRequestSchema, input));
    return toCatalogCategoryRecord(await this.getService().create(body, caller));
  }

  async update(
    id: string,
    input: UpdateCategoryInput,
    options: AggregateCommandOptions = {},
  ): Promise<CatalogCategoryRecord> {
    const caller = callerOf(options);
    const patch = definedOnly(parseOrRefuse(updateCategoryRequestSchema, input ?? {})) as UpdateCategoryInput;
    return toCatalogCategoryRecord(await this.getService().update(id, patch, caller));
  }

  async move(id: string, input: CategoryMoveInput, options: AggregateCommandOptions = {}): Promise<CatalogCategoryRecord> {
    const caller = callerOf(options);
    const { parentId, position } = parseOrRefuse(moveInputSchema, input);
    // Research R-20.1 — the admin tree editor moves a category with the same
    // `PATCH` that edits it, so a move is `category.update` with the parent
    // (and the sort order, when given) and nothing else.
    const cat = await this.getService().update(
      id,
      { parentCategoryId: parentId, ...(position !== undefined ? { sortOrder: position } : {}) },
      caller,
    );
    return toCatalogCategoryRecord(cat);
  }

  async delete(id: string, options: AggregateCommandOptions = {}): Promise<void> {
    const caller = callerOf(options);
    await this.getService().softDelete(id, caller);
  }

  async setCustomFieldValues(
    id: string,
    merge: CustomFieldMerge,
    options: AggregateCommandOptions = {},
  ): Promise<CatalogCategoryRecord> {
    const caller = callerOf(options);
    if (typeof merge !== 'function') {
      throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'The category write is invalid.', [
        { path: 'merge', issue: 'Expected a function.' },
      ]);
    }
    return toCatalogCategoryRecord(await this.getService().setCustomFieldValues(id, merge, caller));
  }

  async setInventoryThresholds(
    id: string,
    patch: CategoryInventoryThresholdPatch,
    options: AggregateCommandOptions = {},
  ): Promise<CatalogCategoryRecord> {
    const caller = callerOf(options);
    const body = definedOnly(parseOrRefuse(thresholdPatchSchema, patch ?? {})) as CategoryInventoryThresholdPatch;
    return toCatalogCategoryRecord(await this.getService().setInventoryThresholds(id, body, caller));
  }
}
