import { notFound } from 'next/navigation';
import { getServerContext } from './server-context';

/**
 * Constitution XVII item 5 — a route a module owns answers not-found while that
 * module is off, exactly as it would had the module never been installed
 * (issue #666). Called from the module's segment `layout.tsx`, so every page
 * below it — the list, the detail, the form — is gated at one seam rather than
 * page by page, and a page added later inherits the gate.
 *
 * Presence is the request's effective enabled-set (`getServerContext().modules`),
 * which degrades open when the projection cannot be read: an unreachable
 * backend renders the page and lets its own fetch decide.
 */
export async function requireModulePresent(moduleId: string): Promise<void> {
  const { modules } = await getServerContext();
  if (!modules.isPresent(moduleId)) notFound();
}
