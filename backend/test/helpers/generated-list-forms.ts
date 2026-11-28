import { FormRegistry, formDeclarationsFrom, type composeModules } from '@endora-commerce/platform/composition';
import { DISCOVERED_MANIFESTS } from '../../src/manifest-index.generated.js';

/**
 * The form registry and its sealing data for a test root that composes modules of the generated
 * list — what `composeApp` builds for the two real roots (`specs/193-admin-form-extensions/`
 * WP-B). A module of that list registers the writers of its field set (`organizations`, WP-E1),
 * and `ctx.fieldSets` refuses a root that mounts no registry; `test/contract/kernel/harness-parity.test.ts`
 * names every root that forgets it.
 *
 * `composed` names the modules the root composes, and the declarations are theirs alone: a field
 * set declared by a module the root leaves out has no writer registered, and the seal would refuse
 * it (`accepts-unenforceable`) for a reason that is not the root's subject. Absent, every module of
 * the generated list.
 *
 * Pass both fields by name (`formRegistry: forms.registry, forms: forms.data`): the parity test
 * reads the option names a root writes, and a spread hides them.
 */
export function generatedListForms(composed?: readonly string[]): {
  readonly registry: FormRegistry;
  readonly data: NonNullable<Parameters<typeof composeModules>[1]['forms']>;
} {
  const ids = composed === undefined ? null : new Set(composed);
  const manifests = DISCOVERED_MANIFESTS.map((entry) => entry.manifest).filter((manifest) => ids === null || ids.has(manifest.id));
  return { registry: new FormRegistry(), data: formDeclarationsFrom(manifests) };
}
