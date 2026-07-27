// Fixture: a core service WITHOUT a sibling interface — not overridable until
// its contract is formalized (R4). An overlay targeting it must fail closed.
export class CatalogQueryService {
  find(): string {
    return 'core:catalog-query';
  }
}
