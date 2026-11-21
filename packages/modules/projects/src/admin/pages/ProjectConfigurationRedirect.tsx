import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { projectConfigurationTarget } from '../lib/configuration-paths.js';

/**
 * The Project configuration's addresses before issue #1557 —
 * `/projects/templates…`, `/projects/roles`, `/projects/loss-reasons`, when
 * each was a sidebar row of its own. They are tabs under `/projects/settings`
 * now; a bookmark or a link sent before lands on its tab, the query and the
 * fragment kept.
 */
export function ProjectConfigurationRedirect(): ReactNode {
  const { pathname, search, hash } = useLocation();
  return <Navigate replace to={`${projectConfigurationTarget(pathname)}${search}${hash}`} />;
}

/** The default export the route declaration's dynamic-import factory resolves. */
export default ProjectConfigurationRedirect;
