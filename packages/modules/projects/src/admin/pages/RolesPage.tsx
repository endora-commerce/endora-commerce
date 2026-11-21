import type { ReactNode } from 'react';
import { DictionaryScreen } from '../components/DictionaryScreen.js';

/**
 * The Project Roles (`specs/163-projects-and-tasks/`, User Story 4;
 * `contracts/admin-surfaces.md` §2, `/projects/settings/roles` since #1557): *Sales Rep* and
 * *Project Manager* from installation, any the operator adds. A Role is a
 * label a Member holds on a Project — it grants no permission (FR-009), and
 * the screen says so. The route is `projects:configure`.
 */
export function RolesPage(): ReactNode {
  return <DictionaryScreen kind="roles" />;
}

/** The default export the route declaration's dynamic-import factory resolves. */
export default RolesPage;
