/**
 * The Project configuration screens — one place with three views since issue
 * #1557 (UX audit WORK-06): the sidebar's *Project configuration* row opens
 * {@link PROJECT_CONFIGURATION_PATH}, the first tab, Templates;
 * `ProjectConfigurationTabs` switches between the three.
 *
 * The first tab is the row's own address, as `/settings` and `/invoices` are,
 * so the row and the palette's *Project templates* open the same route. The
 * other screens, the Template editor included, sit under it, so the sidebar
 * row lights up and the breadcrumb names it on each: both match a row by
 * prefix. The addresses before #1557 (`/projects/templates…`,
 * `/projects/roles`, `/projects/loss-reasons`) redirect here.
 */
export const PROJECT_CONFIGURATION_PATH = '/projects/settings';
export const PROJECT_TEMPLATES_PATH = PROJECT_CONFIGURATION_PATH;
export const PROJECT_TEMPLATE_NEW_PATH = `${PROJECT_CONFIGURATION_PATH}/templates/new`;
export const PROJECT_ROLES_PATH = `${PROJECT_CONFIGURATION_PATH}/roles`;
export const PROJECT_LOSS_REASONS_PATH = `${PROJECT_CONFIGURATION_PATH}/loss-reasons`;

/** One Template's editor; `new` is the create form's. */
export function projectTemplatePath(id: string): string {
  return `${PROJECT_CONFIGURATION_PATH}/templates/${id}`;
}

/** The configuration's addresses before issue #1557, redirects now. */
export const LEGACY_PROJECT_CONFIGURATION_PATHS = [
  '/projects/templates',
  '/projects/templates/new',
  '/projects/templates/:id',
  '/projects/roles',
  '/projects/loss-reasons',
] as const;

/**
 * Where an address from before issue #1557 lands: the Templates list on the
 * configuration's own address, every other screen under it with the rest of
 * its address — a Template's id — kept.
 */
export function projectConfigurationTarget(pathname: string): string {
  const path = pathname.replace(/\/+$/, '');
  if (path === '/projects/templates') return PROJECT_TEMPLATES_PATH;
  return path.replace(/^\/projects\//, `${PROJECT_CONFIGURATION_PATH}/`);
}
