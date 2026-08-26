/**
 * The port interfaces `custom_fields` publishes, and **nothing that exists at
 * runtime** (feature 080, T053(b); D-169, D-171).
 *
 * `tsc` compiles this file to `export {};`. That is the property D-171 makes
 * the boundary decision on — *a subpath is contract surface iff the module it
 * resolves to exports no runtime binding* — and it is why this declaration has
 * its own file rather than sitting on top of `custom-field-definition.service.ts`,
 * which exports the service class and an error class beside it. A consumer
 * naming that file names the owner's implementation, whatever `import type`
 * erases; a consumer naming this one names a declaration and can name nothing
 * else.
 *
 * **This is not yet a supported specifier and the ledger still counts it.**
 * `custom_fields` is not a workspace package, so there is no `exports` map for
 * this to be a subpath of, and `check:module-boundary` reads `catalog`'s
 * relative import exactly as it read the old one — D-171 says so in as many
 * words: `resolveModulePackage` returns `null` for any specifier starting with
 * `.`, so an unconverted reach has no subpath for the exemption to apply to,
 * and reaching the exempt state takes three separable edits (package the owner,
 * publish the interface, rewrite the specifier). This file is the second of
 * those three, taken early because it is the one that does not need the module
 * to move: when `custom_fields` is packaged, this directory becomes the
 * package's `./ports` and the consumer's edit is one specifier.
 *
 * No entity class leaves by this door, type-only included (D-168).
 */
import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  CreateCustomFieldDefinitionRequest,
  CustomFieldDefinitionRecord,
  CustomFieldOptionDto,
  CustomFieldOptionRecord,
  SupportedEntityType,
  UpdateCustomFieldDefinitionRequest,
} from '@endora-commerce/contracts';

/**
 * Container name: `customFieldDefinitionService`. Owner: `custom_fields`.
 *
 * Transactional apply seam for host modules (feature 061,
 * contracts/custom-fields-product-host.md §3). Every `apply*` call runs inside
 * the CALLER's transactional EM (a host Command's `run({ em })`), performs the
 * same invariants as the public CRUD, and does NO command dispatch, NO audit
 * (the host command audits the composite operation), and NO cache publish.
 * The caller MUST invoke {@link CustomFieldDefinitionApplyApi.publishInvalidate}
 * after its transaction commits.
 *
 * **Which transaction it runs in, said on this side too** (D-77). The caller's:
 * a host Command's `run({ em })`, the same `EntityManager` the host writes its
 * own row on. That is not a convenience — `fk_product_attributes_custom_field_definition`
 * is `on delete restrict` with a `unique` on the same column, so the child
 * insert must see its parent inside one transaction, and a second transaction
 * cannot satisfy a foreign key against a row it cannot see. The seam is
 * therefore permanent, declared, and named on both sides; what would retire it
 * is F4's package entry points, or dropping the constraint.
 *
 * **The `EntityManager` is a required parameter on every `apply*` method and
 * never an optional one** (D-169). Open Mercato's `transactionalEm?` is
 * optional on the context *and* in the handler, so a caller may hand a
 * transaction to a handler that ignores it and receive a silently non-atomic
 * write. Do not relax this to match it.
 *
 * **This shape may not live in `@endora-commerce/contracts`**, which is the whole
 * reason it is declared here: `admin` and `storefront` both compile that
 * package, so it holds zero `@mikro-orm` imports and FR-034 keeps it that way.
 * The qualifying test D-171 states is not *"is this a real published port"* but
 * *"does this signature stop the interface living in `packages/contracts`"*,
 * and six of these seven methods do.
 *
 * **The returns are published records, not live entities** (D-77's first
 * narrowing). A host reads `id`, `sortOrder`, `labelDefault` and the rest off
 * what comes back; handing it a managed entity also handed it the ability to
 * mutate a definition outside the seam, and the ability to persist that change
 * on the transaction it happens to be holding.
 *
 * **The definition *read* is not here** and is not a seventh `apply*`. It is
 * `CustomFieldDefinitionReadPort.getById` in `@endora-commerce/contracts`, under the
 * container name `customFieldDefinitionReadPort`: a read handed an
 * `EntityManager` is a write seam re-opened to serve a read (D-169), and until
 * T053(b) this interface was where `catalog` got it, typed as a record and
 * answered with the owner's two managed entities.
 *
 * **Owner off:** the seam fails closed — resolving this port throws
 * `ModuleDisabledError` and the call answers 503 `MODULE_DISABLED`, so nothing
 * half-executes. Whether `custom_fields` has an off state at all is its
 * manifest's `activation` to say, not this line's: a module declaring
 * `nonDeactivatable` never enters one.
 */
export interface CustomFieldDefinitionApplyApi {
  applyCreate(
    em: EntityManager,
    input: CreateCustomFieldDefinitionRequest,
  ): Promise<CustomFieldDefinitionRecord>;
  applyUpdate(
    em: EntityManager,
    id: string,
    patch: UpdateCustomFieldDefinitionRequest,
  ): Promise<CustomFieldDefinitionRecord>;
  applyDelete(em: EntityManager, id: string): Promise<void>;
  applyCreateOption(
    em: EntityManager,
    definitionId: string,
    input: CustomFieldOptionDto,
  ): Promise<CustomFieldOptionRecord>;
  applyUpdateOption(
    em: EntityManager,
    definitionId: string,
    optionId: string,
    patch: Partial<Pick<CustomFieldOptionDto, 'label' | 'labelDefault' | 'isDefault' | 'sortOrder'>>,
  ): Promise<CustomFieldOptionRecord>;
  applyDeleteOption(em: EntityManager, definitionId: string, optionId: string): Promise<void>;
  /**
   * Post-commit responsibility of the caller, and the one method here that
   * takes no `EntityManager` — by construction, since it must run **after** the
   * caller's transaction commits.
   *
   * It stays on the apply seam rather than moving to the read port with
   * `getById`, because it is a step of this seam's protocol and not a question
   * anybody else has: D-97.1 refused to publish the cache mechanism to
   * consumers at all, and answers the reader's real question with
   * `CustomFieldDefinitionReadPort.listForEntityFresh` instead. Only a caller
   * that has just written through `apply*` owes this call.
   */
  publishInvalidate(entityType: SupportedEntityType): Promise<void>;
}
