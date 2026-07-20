import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { OrgScoped } from '../../../tenancy/org-scoped.decorator.js';
import { randomUUID } from 'crypto';

/**
 * ShoppingList — a per-customer named bucket of products. The (customer,
 * organization) pair scopes ownership; sharing inside an organization is
 * intentionally out of scope for the MVP.
 */
@OrgScoped()
@Entity({ tableName: 'shopping_lists' })
export class ShoppingList {
  [OptionalProps]?: 'id' | 'createdAt' | 'updatedAt' | 'isDefault';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  @Index()
  organizationId!: string;

  @Property({ type: 'uuid' })
  @Index()
  customerAccountId!: string;

  @Property({ type: 'string', length: 160 })
  name!: string;

  /**
   * The customer's default shopping list. At most one list per
   * (organization, customer) carries this flag; the storefront "add to
   * shopping list" affordances target it.
   */
  @Property({ type: 'boolean' })
  isDefault: boolean = false;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
