import type { ReactNode } from 'react';
import { DictionaryScreen } from '../components/DictionaryScreen.js';

/**
 * The loss reasons (`specs/163-projects-and-tasks/`, User Story 4 and FR-005;
 * `contracts/admin-surfaces.md` §2, `/projects/settings/loss-reasons` since #1557): the reasons a
 * Project can be closed as lost for. The route is `projects:configure`.
 */
export function LossReasonsPage(): ReactNode {
  return <DictionaryScreen kind="loss-reasons" />;
}

/** The default export the route declaration's dynamic-import factory resolves. */
export default LossReasonsPage;
