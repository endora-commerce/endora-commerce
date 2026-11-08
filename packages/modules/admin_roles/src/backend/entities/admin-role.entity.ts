import { Entity, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * AdminRole — a named permission bundle assigned to AdminUsers. Permissions
 * are screaming-snake `module:action` strings (e.g. `catalog:write`,
 * `orders:read`, `customers:impersonate`). Stored as JSONB array.
 *
 * The two-factor flag is read by `mfa` at sign-in (`MfaPolicyResolver`, issue
 * #349): a holder must complete or enrol TOTP. It has no effect while `mfa` is
 * absent (D-96), and `mfa` cannot be switched off while any role sets it.
 */
@GlobalEntity()
@Entity({ tableName: 'admin_roles' })
export class AdminRole {
  [OptionalProps]?:
    | 'id'
    | 'createdAt'
    | 'updatedAt'
    | 'requiresTwoFactor'
    | 'permissions';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'string', length: 64 })
  @Unique()
  code!: string;

  @Property({ type: 'string', length: 160 })
  name!: string;

  @Property({ type: 'json' })
  permissions: string[] = [];

  @Property({ type: 'boolean' })
  requiresTwoFactor: boolean = false;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
