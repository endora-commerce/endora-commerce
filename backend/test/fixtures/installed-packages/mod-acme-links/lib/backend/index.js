// The package's `./backend` entry point, in the shape a compiler emits: every
// decorator is applied as an ordinary call.
import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';
import { GlobalEntity, TransitivelyScoped } from '@endora-commerce/platform/tenancy';

/** organizations is global and the tenant root: the side entity is global too. */
export class AcmeLinksOrganizationRef {}
PrimaryKey({ type: 'uuid' })(AcmeLinksOrganizationRef.prototype, 'organizationId');
Property({ type: 'text' })(AcmeLinksOrganizationRef.prototype, 'externalRef');
Entity({ tableName: 'acme_links_organization_refs' })(AcmeLinksOrganizationRef);
GlobalEntity()(AcmeLinksOrganizationRef);

/** orders is org-scoped: the side entity follows its host, never copying organization_id (OR-9). */
export class AcmeLinksOrderNote {}
PrimaryKey({ type: 'uuid' })(AcmeLinksOrderNote.prototype, 'orderId');
Property({ type: 'text' })(AcmeLinksOrderNote.prototype, 'note');
Entity({ tableName: 'acme_links_order_notes' })(AcmeLinksOrderNote);
TransitivelyScoped('Order', 'orderId')(AcmeLinksOrderNote);

export const entities = [AcmeLinksOrganizationRef, AcmeLinksOrderNote];

export function registerModule() {}
