import { randomUUID } from 'node:crypto';
import { ERROR_CODES, type TaxonomyProviderCode } from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { FeedTaxonomyMapping } from '../entities/feed-taxonomy-mapping.entity.js';

/**
 * `product_feeds.taxonomy_mapping.set` — feature 067 / FR-079, FR-081, FR-059.
 *
 * One Command covers set, change and clear, because from the operator's point
 * of view they are one decision ("what does this category mean to Google?") and
 * auditing them as three actions would make the log harder to read, not easier.
 * `nodeExternalId: null` clears the explicit mapping so the category inherits
 * again — the way an override is undone without touching an ancestor's row.
 *
 * Setting a mapping always clears `stale`: the operator has just chosen a node
 * that exists in the current revision, so the flag would be a lie.
 */

function envelope(): { eventId: string; occurredAt: string } {
  return { eventId: randomUUID(), occurredAt: new Date().toISOString() };
}

export interface SetTaxonomyMappingResult {
  providerCode: TaxonomyProviderCode;
  categoryId: string;
  /** Null when the explicit mapping was cleared. */
  nodeExternalId: string | null;
}

export function makeSetTaxonomyMappingCommand(args: {
  providerCode: TaxonomyProviderCode;
  categoryId: string;
  nodeExternalId: string | null;
}): Command<SetTaxonomyMappingResult> {
  return {
    action: 'product_feeds.taxonomy_mapping.set',
    objectType: 'product_feed_taxonomy_mapping',
    // The category is the stable identity here: the mapping row comes and goes
    // as the operator sets and clears it, so keying the audit trail on the row
    // id would scatter one category's history across several object ids.
    objectId: args.categoryId,
    capture: async ({ em }) => {
      const existing = await em.findOne(FeedTaxonomyMapping, {
        taxonomyProviderCode: args.providerCode,
        categoryId: args.categoryId,
      });
      return existing
        ? {
            providerCode: existing.taxonomyProviderCode,
            categoryId: existing.categoryId,
            nodeExternalId: existing.nodeExternalId,
            stale: existing.stale,
          }
        : { providerCode: args.providerCode, categoryId: args.categoryId, nodeExternalId: null };
    },
    run: async ({ em }) => {
      const existing = await em.findOne(FeedTaxonomyMapping, {
        taxonomyProviderCode: args.providerCode,
        categoryId: args.categoryId,
      });

      if (args.nodeExternalId === null) {
        if (!existing) {
          // Nothing to clear — no write, therefore no audit row.
          return {
            result: {
              providerCode: args.providerCode,
              categoryId: args.categoryId,
              nodeExternalId: null,
            },
            skipAudit: true,
          };
        }
        await em.removeAndFlush(existing);
        return {
          result: {
            providerCode: args.providerCode,
            categoryId: args.categoryId,
            nodeExternalId: null,
          },
          after: null,
        };
      }

      const row =
        existing ??
        em.create(FeedTaxonomyMapping, {
          taxonomyProviderCode: args.providerCode,
          categoryId: args.categoryId,
          nodeExternalId: args.nodeExternalId,
        });
      row.nodeExternalId = args.nodeExternalId;
      // The operator just picked a node from the current revision.
      row.stale = false;
      await em.persistAndFlush(row);

      return {
        result: {
          providerCode: args.providerCode,
          categoryId: args.categoryId,
          nodeExternalId: args.nodeExternalId,
        },
        after: {
          providerCode: row.taxonomyProviderCode,
          categoryId: row.categoryId,
          nodeExternalId: row.nodeExternalId,
          stale: row.stale,
        },
      };
    },
    event: (result) => ({
      eventName: 'product_feeds.taxonomy_mapping_changed',
      payload: {
        ...envelope(),
        providerCode: result.providerCode,
        categoryId: result.categoryId,
      },
    }),
  };
}

/** Thrown as `400` when the chosen node is not in the installed revision. */
export function unknownTaxonomyNode(nodeExternalId: string): HttpError {
  return new HttpError(
    400,
    ERROR_CODES.VALIDATION_FAILED,
    `nodeExternalId: "${nodeExternalId}" is not in the installed taxonomy revision`,
    { field: 'nodeExternalId' },
  );
}
