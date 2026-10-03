import { EMAIL_SAFE_COMPONENT_NAMES } from '@endora-commerce/email-components/schema/component-types';
import { walkUnknownComponents } from '@endora-commerce/email-components/tree/walk-embeds';

/**
 * Which block names saved e-mail content may hold.
 *
 * Three sources, and the first used to be the only one:
 *
 *  1. the blocks `email-components` draws itself;
 *  2. every block a composed module's **manifest declares** for the `email`
 *     context (`specs/141-module-block-renderers/`). Declared, not present: a
 *     module an operator switched off still has its node in stored content, and
 *     saving that document must not be refused — off is non-destructive;
 *  3. every name a module registered an e-mail renderer for, which is how an
 *     overlay module's block is known here.
 *
 * A function, because the third source is filled by boot hooks that run after
 * this module's services are constructed.
 */
export type EmailSafeNames = () => ReadonlySet<string>;

interface ManifestLike {
  readonly blocks?: ReadonlyArray<{ readonly name: string; readonly contexts: readonly string[] }> | undefined;
}

export function emailSafeNamesFrom(
  manifests: readonly ManifestLike[],
  registered: () => readonly string[] = () => [],
): EmailSafeNames {
  const declared = new Set<string>(EMAIL_SAFE_COMPONENT_NAMES);
  for (const manifest of manifests) {
    for (const block of manifest.blocks ?? []) {
      if (block.contexts.includes('email')) declared.add(block.name);
    }
  }
  return () => {
    const names = registered();
    if (names.length === 0) return declared;
    return new Set([...declared, ...names]);
  };
}

/** The first-party set alone — what a service built without a composition validates against. */
export const FIRST_PARTY_EMAIL_NAMES: EmailSafeNames = emailSafeNamesFrom([]);

/** The block names in `content` that `names` does not admit. */
export function unknownEmailComponents(content: unknown, names: ReadonlySet<string>): string[] {
  return [...walkUnknownComponents(content, names)];
}
