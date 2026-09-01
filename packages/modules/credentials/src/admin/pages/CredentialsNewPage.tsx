import type { ReactNode } from 'react';
import { CredentialsPage } from './CredentialsPage.js';

/**
 * `/credentials/new` — the same screen, landing on the empty form (feature 058
 * US1; feature 091, Phase 4, batch 10).
 *
 * A file rather than a prop on the declaration, because
 * `AdminRouteContribution.component` is a factory returning a module and reads
 * its `default`: there is nowhere in the declaration to put an argument, and
 * adding one would be a props channel the registry has to interpret for every
 * module. `App.tsx` wrote `element={<CredentialsPage initialMode="new" />}`
 * here, which is the same two lines with the host holding them.
 *
 * It is the destination of this module's `new-credential` palette action, so
 * the deep link an operator follows from ⌘K lands on the form rather than on
 * the list with a button to press.
 */
export function CredentialsNewPage(): ReactNode {
  return <CredentialsPage initialMode="new" />;
}

export default CredentialsNewPage;
