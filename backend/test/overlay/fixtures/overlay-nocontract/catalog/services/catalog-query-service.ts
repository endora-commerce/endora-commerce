// Fixture: an overlay overriding a core service that has no declared interface
// — MUST fail closed (R4 / FR-003) until the contract is formalized.
export class CatalogQueryService {
  find(): string {
    return 'overlay:catalog-query';
  }
}
