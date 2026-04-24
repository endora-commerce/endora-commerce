import { Session } from '../modules/auth/entities/session.entity.js';
import { AuditLogEntry } from '../modules/audit_logs/entities/audit-log-entry.entity.js';
import { Asset } from '../modules/assets/entities/asset.entity.js';
import { Product } from '../modules/catalog/entities/product.entity.js';
import { ProductVariant } from '../modules/catalog/entities/product-variant.entity.js';
import { Category } from '../modules/catalog/entities/category.entity.js';
import { ProductAttribute } from '../modules/catalog/entities/product-attribute.entity.js';
import { SalesChannel } from '../modules/catalog/entities/sales-channel.entity.js';
import { AvailabilityNotification } from '../modules/inventory/entities/availability-notification.entity.js';
import { QuoteRequest } from '../modules/quote_requests/entities/quote-request.entity.js';
import { QuoteRequestItem } from '../modules/quote_requests/entities/quote-request-item.entity.js';

/**
 * Explicit entity registry consumed by `mikro-orm.config.ts`.
 *
 * We avoid the glob-based discovery (`entities: ['./dist/.../*.js']`) for the
 * same reason every modern ORM example does: glob discovery needs dynamic
 * `import()` at runtime, which Node's ESM loader can't transform TypeScript
 * through. Under Vitest's test loader that dynamic import fails with
 * `SyntaxError: Invalid or unexpected token` because the .ts file reaches the
 * Node loader without esbuild transformation. Listing the classes explicitly
 * side-steps the whole problem.
 *
 * Every new module entity MUST be added here. Ownership still belongs to the
 * module folder — this file is just the composition root's import list.
 */

export const ALL_ENTITIES = [
  // auth
  Session,
  // audit_logs
  AuditLogEntry,
  // assets
  Asset,
  // catalog
  Product,
  ProductVariant,
  Category,
  ProductAttribute,
  SalesChannel,
  // inventory
  AvailabilityNotification,
  // quote_requests
  QuoteRequest,
  QuoteRequestItem,
] as const;
