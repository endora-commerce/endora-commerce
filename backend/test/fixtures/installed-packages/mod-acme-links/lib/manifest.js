// The manifest of a package that keeps two side tables
// (`specs/187-side-table-extensions/` T016): one on organizations, one on orders.
export const manifest = {
  id: 'acme_links',
  name: 'Acme links',
  version: '1.0.0',
  dependencies: ['organizations', 'orders'],
  extends: [
    { entity: 'organizations.Organization', table: 'acme_links_organization_refs' },
    { entity: 'orders.Order', table: 'acme_links_order_notes' },
  ],
};

export default manifest;
