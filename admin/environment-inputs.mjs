/**
 * What the admin needs from its environment (feature 117, FR-001;
 * `specs/117-instance-bring-up/contracts/environment-inputs.md` §R2.3).
 *
 * ## One input, and it is the whole worked example for member scoping
 *
 * The admin reads exactly one environment value, and it is the one that
 * `specs/118-instance-member-selection/`'s scoping is measured on. An instance
 * may deliberately be written **without** an admin member — today every one of
 * them is, while `@endora-commerce/admin-shell` does not exist
 * (`specs/110-instance-repository/contracts/instance-tree.md` §2.4) — and such
 * a run must neither ask for this value nor silently drop it. It is out of the
 * population, because its declared consumer is not among the members written.
 *
 * Two inputs elsewhere in the estate *name* the admin and are **not** scoped
 * out with it, which is why the rule is keyed on `consumers` and never on the
 * spelling: `ADMIN_BASE_URL` is read by the backend when it composes the links
 * it mails, and `CORS_ALLOWED_ORIGINS` has to name the admin's origin for the
 * admin to be able to call the backend at all. Both matter *more* when the
 * admin is hosted somewhere else, which is exactly when a name-based rule
 * would drop them.
 *
 * ## Why `.mjs`, and why it is not read by the admin itself
 *
 * A declaration is read by a tool — a scaffolding command, `endora doctor` —
 * before the tree it describes is installed or built, so it has to be loadable
 * by a plain Node process with no compiler. The admin's own code reads
 * `import.meta.env.VITE_API_BASE_URL`, which Vite replaces at build time; that
 * read and this declaration are reconciled by `check:env-inputs`, in both
 * directions.
 *
 * @typedef {import('@endora-commerce/contracts').EnvironmentInput} EnvironmentInput
 */

/** @type {readonly EnvironmentInput[]} */
export const ADMIN_ENVIRONMENT_INPUTS = [
  {
    name: 'VITE_API_BASE_URL',
    describes: {
      en: "The address the admin calls the backend at. Vite writes it into the bundle when the admin is built, so it cannot be changed afterwards without building again — and the backend has to name this admin's own origin in CORS_ALLOWED_ORIGINS for the calls to be allowed.",
      pl: 'Adres, pod którym panel administracyjny wywołuje backend. Vite zapisuje go w paczce podczas budowania panelu, więc później nie da się go zmienić bez ponownego budowania — a backend musi wskazać adres tego panelu w CORS_ALLOWED_ORIGINS, aby wywołania były dozwolone.',
    },
    requirement: { kind: 'required' },
    secret: false,
    generable: false,
    owner: { kind: 'application', application: 'admin' },
    consumers: ['admin'],
  },
  {
    name: 'VITE_BUILD_ID',
    describes: {
      en: 'A label for this build of the admin, so an operator whose browser is holding an older cached copy is given the new one.',
      pl: 'Etykieta tego wydania panelu, dzięki której operator z zapisaną starszą kopią w przeglądarce dostaje nową.',
    },
    requirement: {
      kind: 'optional',
      without: {
        en: "the cached copy is refreshed on the browser's own schedule, so an operator can go on using yesterday's admin for a while after a deployment.",
        pl: 'kopia w przeglądarce odświeża się według harmonogramu przeglądarki, więc operator może przez chwilę po wdrożeniu pracować na wczorajszym panelu.',
      },
    },
    secret: false,
    generable: false,
    owner: { kind: 'application', application: 'admin' },
    consumers: ['admin'],
  },
];
