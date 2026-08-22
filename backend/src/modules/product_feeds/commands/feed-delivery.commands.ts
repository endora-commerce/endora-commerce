import { randomUUID } from 'node:crypto';
import { ERROR_CODES, type FeedDeliveryHttpLabel, type FeedDeliveryProtocol } from '@endora-commerce/contracts';
import type { Command } from '../../../commands/command.js';
import { HttpError } from '../../../http/error-envelope.js';
import { FeedDelivery } from '../entities/feed-delivery.entity.js';

/**
 * Delivery-configuration Commands — feature 070, Principle XIII.
 *
 * Configuring where a feed is pushed is an administrative write with real
 * consequences — it starts sending a priced catalogue to a third party — so it
 * runs through `CommandBus.run` and gets exactly one audit entry attributed to
 * the administrator who made it.
 *
 * The audit projection is the whole row **because the row carries no secret**:
 * the password, the key and the authenticating headers live in the credentials
 * module, which audits its own write separately and never records a plaintext.
 * The `headers` map is included because it is non-secret by construction —
 * `isSecretDeliveryHeader` diverts anything that is not before it reaches the
 * column.
 */

function envelope(): { eventId: string; occurredAt: string } {
  return { eventId: randomUUID(), occurredAt: new Date().toISOString() };
}

function auditState(delivery: FeedDelivery): Record<string, unknown> {
  return {
    id: delivery.id,
    productFeedId: delivery.productFeedId,
    enabled: delivery.enabled,
    protocol: delivery.protocol,
    httpLabel: delivery.httpLabel ?? null,
    host: delivery.host ?? null,
    port: delivery.port ?? null,
    username: delivery.username ?? null,
    directoryPath: delivery.directoryPath ?? null,
    passiveMode: delivery.passiveMode,
    requestUrl: delivery.requestUrl ?? null,
    // Names only. A value that mattered would have been diverted to the
    // credential, but an audit entry is not the place to find that out.
    headerNames: Object.keys(delivery.headers).sort(),
    credentialCode: delivery.credentialCode,
    version: delivery.version,
  };
}

export interface FeedDeliveryWriteValues {
  enabled: boolean;
  protocol: FeedDeliveryProtocol;
  httpLabel: FeedDeliveryHttpLabel | null;
  host: string | null;
  port: number | null;
  username: string | null;
  directoryPath: string | null;
  passiveMode: boolean;
  requestUrl: string | null;
  headers: Record<string, string>;
  credentialCode: string;
}

/**
 * Creates or replaces the one delivery configuration a feed may carry (FR-100).
 *
 * `expectedVersion` is checked inside the Command's transaction rather than by
 * the caller reading first: two administrators saving the same screen must not
 * both succeed, and a read-then-write outside the transaction is exactly the
 * race that lets them.
 */
export function makeUpsertFeedDeliveryCommand(input: {
  productFeedId: string;
  expectedVersion: number | null;
  values: FeedDeliveryWriteValues;
}): Command<FeedDelivery> {
  return {
    action: 'product_feeds.delivery.upsert',
    objectType: 'product_feed',
    objectId: input.productFeedId,
    capture: async ({ em }) => {
      const existing = await em.findOne(FeedDelivery, { productFeedId: input.productFeedId });
      return existing ? auditState(existing) : null;
    },
    run: async ({ em }) => {
      const existing = await em.findOne(FeedDelivery, { productFeedId: input.productFeedId });

      if (existing) {
        if (input.expectedVersion !== null && input.expectedVersion !== existing.version) {
          throw new HttpError(
            409,
            ERROR_CODES.VERSION_CONFLICT,
            'The delivery configuration was modified by someone else.',
          );
        }
        Object.assign(existing, input.values);
        existing.version += 1;
        await em.persistAndFlush(existing);
        return { result: existing, after: auditState(existing) };
      }

      const created = em.create(FeedDelivery, {
        productFeedId: input.productFeedId,
        ...input.values,
      });
      await em.persistAndFlush(created);
      return { result: created, after: auditState(created) };
    },
    event: (result) => ({
      eventName: 'product_feeds.delivery_changed',
      payload: { ...envelope(), feedId: result.productFeedId, enabled: result.enabled },
    }),
  };
}

/**
 * Removes the configuration. The attempt history is deliberately kept: "did the
 * partner get last month's file?" is still a fair question after delivery has
 * been switched off, and FR-105 exists to be able to answer it.
 */
export function makeDeleteFeedDeliveryCommand(
  productFeedId: string,
): Command<{ credentialCode: string | null }> {
  return {
    action: 'product_feeds.delivery.delete',
    objectType: 'product_feed',
    objectId: productFeedId,
    capture: async ({ em }) => {
      const existing = await em.findOne(FeedDelivery, { productFeedId });
      return existing ? auditState(existing) : null;
    },
    run: async ({ em }) => {
      const existing = await em.findOne(FeedDelivery, { productFeedId });
      if (!existing) {
        throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'This feed has no delivery configuration.');
      }
      const credentialCode = existing.credentialCode;
      await em.removeAndFlush(existing);
      return { result: { credentialCode }, after: null };
    },
    event: () => ({
      eventName: 'product_feeds.delivery_changed',
      payload: { ...envelope(), feedId: productFeedId, enabled: false },
    }),
  };
}
