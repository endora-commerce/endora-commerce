/**
 * Every entity metadata a storage holds, once each.
 *
 * MikroORM 7 (#1866) answers `getAll()` with a `Map` keyed by entity class,
 * where MikroORM 6 answered a plain object keyed by class name — and
 * `Object.values(new Map())` is `[]`, so an iteration written for 6 silently
 * finds nothing on 7 (the characterisation of #1860). The hand-built storages
 * the unit tests use still answer an object, so both shapes are read here;
 * values are de-duplicated because one metadata may sit under more than one key.
 */
export function allMetadata<T>(storage: { getAll(): Map<unknown, T> | Record<string, T> }): T[] {
  const all = storage.getAll();
  return all instanceof Map ? [...new Set(all.values())] : Object.values(all);
}
