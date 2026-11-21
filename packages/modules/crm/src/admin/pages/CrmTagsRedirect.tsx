import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { CRM_TAGS_PATH } from '../lib/configuration-paths.js';

/**
 * `/crm/tags` — the tag list's address before issue #1557, when it was a
 * sidebar row of its own. It is the configuration's *Tags* tab now; a bookmark
 * or a link sent before lands there, the query and the fragment kept.
 */
export function CrmTagsRedirect(): ReactNode {
  const { search, hash } = useLocation();
  return <Navigate replace to={`${CRM_TAGS_PATH}${search}${hash}`} />;
}

export default CrmTagsRedirect;
