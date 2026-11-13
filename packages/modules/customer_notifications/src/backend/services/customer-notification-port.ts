import type { EntityManager } from '@mikro-orm/postgresql';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
import type {
  CustomerNotificationMessage,
  CustomerNotificationRecord,
  CustomerNotificationRecordPort,
  RecordCustomerNotificationInput,
} from '@endora-commerce/contracts';
import {
  CustomerNotification,
  type StoredCustomerNotificationMessage,
} from '../entities/customer-notification.entity.js';

/**
 * The published face of `customer_notifications` —
 * `customerNotificationRecordPort` (`specs/179-rfq-and-customer-notifications/`
 * `contracts/delivery-and-ports.md` §1). The admin bell's port is the model on
 * purpose (research R-13): `record` on an EntityManager of its own,
 * `recordWithin` on the caller's.
 *
 * Every input is checked **before** anything is created, and refused with a
 * plain `Error`: the port is an in-process call whose TypeScript signature
 * already says all of this, and a caller that reaches it through a cast or
 * from a package compiled against another version is a programming error, not
 * a delivery outcome. What is checked is what the storefront later trusts —
 * the link it renders, the params it interpolates as text, the body it falls
 * back to.
 */
export interface CustomerNotificationRecordPortDeps {
  readonly emFactory: () => EntityManager;
}

export function createCustomerNotificationRecordPort(
  deps: CustomerNotificationRecordPortDeps,
): CustomerNotificationRecordPort<EntityManager> {
  return {
    async record(input) {
      const data = normalizeInput(input);
      const em = deps.emFactory().fork();
      const existing = await em.findOne(CustomerNotification, {
        sourceModule: data.sourceModule,
        sourceKey: data.sourceKey,
      });
      if (existing) return toRecord(existing);
      // command-coverage-ignore: customer notification bookkeeping — an entry a
      // producer records for a buyer, not an audited domain-state mutation
      // (research R-19); the producer's own change is what is audited.
      const entry = em.create(CustomerNotification, data);
      try {
        await em.persistAndFlush(entry);
      } catch (error) {
        // Two producers racing on one source key: the database's unique key
        // decided, so the other one's entry is the answer.
        if (!(error instanceof UniqueConstraintViolationException)) throw error;
        const winner = await deps.emFactory().fork().findOne(CustomerNotification, {
          sourceModule: data.sourceModule,
          sourceKey: data.sourceKey,
        });
        if (!winner) throw error;
        return toRecord(winner);
      }
      return toRecord(entry);
    },

    recordWithin(em, input) {
      const data = normalizeInput(input);
      // command-coverage-ignore: customer notification bookkeeping, persisted
      // into the caller's unit of work — the caller's change is what commits it.
      const entry = em.create(CustomerNotification, data);
      em.persist(entry);
      return toRecord(entry);
    },
  };
}

function toRecord(entry: CustomerNotification): CustomerNotificationRecord {
  return { id: entry.id, createdAt: entry.createdAt };
}

/** Column widths of `customer_notifications` (data-model §2). */
const MAX = {
  sourceModule: 64,
  sourceKey: 128,
  kind: 64,
  subjectType: 64,
  title: 255,
  linkPath: 512,
  scope: 64,
  key: 255,
} as const;

const MESSAGE_SCOPE_RE = /^[a-z_][a-z0-9_]*$/u;

interface NormalizedInput {
  organizationId: string;
  customerAccountId: string;
  salesChannelId: string | null;
  sourceModule: string;
  sourceKey: string;
  kind: string;
  subjectType: string | null;
  subjectId: string | null;
  title: string;
  titleMessage: StoredCustomerNotificationMessage;
  body: string | null;
  bodyMessage: StoredCustomerNotificationMessage | null;
  linkPath: string | null;
}

function refuse(reason: string): never {
  throw new Error(`customerNotificationRecordPort: ${reason}.`);
}

function requiredText(field: string, value: unknown, max?: number): string {
  if (typeof value !== 'string' || value.length === 0) refuse(`${field} must be a non-empty string`);
  if (max !== undefined && value.length > max) refuse(`${field} must be at most ${max} characters`);
  return value;
}

function optionalText(field: 'subjectType', value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return requiredText(field, value, MAX[field]);
}

/**
 * Storefront-relative and nothing else (FR-047): one leading `/`, and neither a
 * second `/` nor a `\` after it — a browser treats `/\host` as `//host`. A
 * scheme cannot start with `/`, so the first rule already refuses `https:` and
 * `javascript:`.
 */
function normalizeLink(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX.linkPath) {
    refuse(`linkPath must be a storefront-relative path of at most ${MAX.linkPath} characters`);
  }
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
    refuse('linkPath must be storefront-relative — one leading "/", no scheme and no "//"');
  }
  return value;
}

/**
 * Params are strings and finite numbers only: they are interpolated as text,
 * and an object, an array or a boolean has no text of its own.
 */
function normalizeMessage(
  field: 'titleMessage' | 'bodyMessage',
  message: CustomerNotificationMessage | null | undefined,
): StoredCustomerNotificationMessage | null {
  if (message === null || message === undefined) return null;
  if (typeof message !== 'object' || Array.isArray(message)) {
    refuse(`${field} must be an object of scope, key and params`);
  }
  const { scope, key, params } = message;
  if (typeof scope !== 'string' || scope.length > MAX.scope || !MESSAGE_SCOPE_RE.test(scope)) {
    refuse(`${field} scope must be a bundle namespace — a module id`);
  }
  if (typeof key !== 'string' || key.length === 0 || key.length > MAX.key) {
    refuse(`${field} key must be a non-empty string of at most ${MAX.key} characters`);
  }
  const stored: Record<string, string | number> = {};
  if (params !== undefined && params !== null) {
    if (typeof params !== 'object' || Array.isArray(params)) {
      refuse(`${field} params must be an object of strings and numbers`);
    }
    for (const [name, value] of Object.entries(params as Record<string, unknown>)) {
      const plain = typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));
      if (!plain) refuse(`${field} param "${name}" must be a string or a finite number`);
      stored[name] = value as string | number;
    }
  }
  return { scope, key, params: stored };
}

function normalizeInput(input: RecordCustomerNotificationInput): NormalizedInput {
  const titleMessage = normalizeMessage('titleMessage', input.titleMessage);
  if (!titleMessage) refuse('titleMessage is required');
  const bodyMessage = normalizeMessage('bodyMessage', input.bodyMessage);
  const body = input.body === null || input.body === undefined || input.body === '' ? null : input.body;
  if (bodyMessage && body === null) {
    refuse('bodyMessage requires a body — the finished sentence shown when the message cannot be resolved');
  }
  if (body !== null && typeof body !== 'string') refuse('body must be a string');
  return {
    organizationId: requiredText('organizationId', input.organizationId),
    customerAccountId: requiredText('customerAccountId', input.customerAccountId),
    salesChannelId:
      input.salesChannelId === null || input.salesChannelId === undefined
        ? null
        : requiredText('salesChannelId', input.salesChannelId),
    sourceModule: requiredText('sourceModule', input.sourceModule, MAX.sourceModule),
    sourceKey: requiredText('sourceKey', input.sourceKey, MAX.sourceKey),
    kind: requiredText('kind', input.kind, MAX.kind),
    subjectType: optionalText('subjectType', input.subjectType),
    subjectId: input.subjectId === null || input.subjectId === undefined ? null : requiredText('subjectId', input.subjectId),
    title: requiredText('title', input.title, MAX.title),
    titleMessage,
    body,
    bodyMessage,
    linkPath: normalizeLink(input.linkPath),
  };
}
