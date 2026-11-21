import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';

/**
 * `/security`, kept for bookmarks and stale links (issue #1519): the screen is
 * the Profile's *Security* tab now, so the old address forwards there and
 * replaces itself in the history, so Back does not land on the redirect.
 */
export default function SecurityRedirect(): ReactNode {
  return <Navigate to="/profile/security" replace />;
}
