/**
 * `forms`' admin surface (`specs/170-forms-module/contracts/admin-surfaces.md` §3): the forms list
 * (the landing screen), the create screen and the builder — User Story 1 — and the entries list and
 * one entry — User Story 4 — with a sidebar row each. `/forms/entries` and `/forms/entries/:id` are
 * declared before `/forms/:id`, so the static path wins.
 *
 * The palette actions are the manifest's (`src/manifest.ts`, §2).
 *
 * **This entry exports data and nothing else**; every component is a dynamic-import factory, so none
 * of the screens is in the admin's entry chunk.
 */
import type { AdminContributions } from '@endora-commerce/admin-kit/contributions';

/** The code that opens the list, the builder and the preview: `GET /forms`, `/forms/:id` enforce it. */
const READ_PERMISSION = 'forms:read';

/** The code that opens the create screen: `POST /forms` is the one write it exists to make. */
const WRITE_PERMISSION = 'forms:write';

/** The code that opens the entries list and one entry: `GET /forms/entries*` enforce it. */
const ENTRIES_READ_PERMISSION = 'forms:entries_read';

const FORMS_PATH = '/forms';
const ENTRIES_PATH = '/forms/entries';

export const contributions: AdminContributions = {
  routes: [
    {
      path: FORMS_PATH,
      component: () => import('./pages/FormsListPage.js'),
      requiredPermission: READ_PERMISSION,
      index: true,
    },
    {
      path: `${FORMS_PATH}/new`,
      component: () => import('./pages/FormCreatePage.js'),
      requiredPermission: WRITE_PERMISSION,
    },
    {
      path: ENTRIES_PATH,
      component: () => import('./pages/EntriesListPage.js'),
      requiredPermission: ENTRIES_READ_PERMISSION,
    },
    {
      path: `${ENTRIES_PATH}/:id`,
      component: () => import('./pages/EntryDetailPage.js'),
      requiredPermission: ENTRIES_READ_PERMISSION,
    },
    {
      path: `${FORMS_PATH}/:id`,
      component: () => import('./pages/FormBuilderPage.js'),
      requiredPermission: READ_PERMISSION,
    },
  ],
  nav: [
    {
      to: FORMS_PATH,
      labelKey: 'nav.forms.label',
      icon: 'ClipboardList',
      // The host's content section, after the CMS and the blog (A-17: the designer's to move).
      section: 'content',
      weight: 260,
      requiredPermission: READ_PERMISSION,
    },
    {
      to: ENTRIES_PATH,
      labelKey: 'nav.entries.label',
      icon: 'Inbox',
      section: 'content',
      weight: 261,
      requiredPermission: ENTRIES_READ_PERMISSION,
    },
  ],
};
