/**
 * Which components one `endora install` stands up — `--only`, as data
 * (`specs/138-separate-components/spec.md` FR-001…FR-003, FR-011, FR-019;
 * contract `instance-tree.md` §7).
 *
 * ## A third axis, and it restates neither of the other two
 *
 * `--without <member>` is a statement about the **tree** and `--topology` one
 * about the **example deployment files**. `--only` is about the **run**: which
 * of the API, the Admin UI and the storefront this machine is being given. It
 * is normalised here onto the two mechanisms that already exist — a selection
 * without the admin is `--without admin`, one without the storefront is
 * `--no-storefront` — so nothing downstream learns a second way to leave a
 * part out.
 *
 * ## Absent is not "all three, as a subset of itself"
 *
 * A run that names no `--only` is the run this command always was: `--without`
 * and `--no-storefront` pass through unread and {@link Selection.subset} is
 * `false`, so none of what a strict subset adds — the origins of the other
 * machines, the heading in the closing block — is asked, written or printed.
 *
 * Everything here is pure, so the table in `plan.md` is asserted row by row
 * with no disk and no process.
 */

/** The three things a run can stand up, in the order they are listed. */
export const COMPONENT_VOCABULARY = ['api', 'admin', 'storefront'] as const;

export type Component = (typeof COMPONENT_VOCABULARY)[number];

/** What a run stands up, and what that means for the two writers. */
export interface Selection {
  /** The components this run stands up, in the vocabulary's order. */
  readonly components: readonly Component[];
  /** The members `endora new instance` is told not to write. */
  readonly without: readonly string[];
  /** Whether the storefront repository is written. */
  readonly storefront: boolean;
  /**
   * Whether an instance tree is written at `<dir>`. `false` for the storefront
   * alone, where `<dir>` is the storefront's own directory (FR-007).
   */
  readonly writesTree: boolean;
  /** Whether `--only` named a strict subset of the three. */
  readonly subset: boolean;
}

/** Every component selected: the run with no `--only`. */
export const EVERYTHING: Selection = {
  components: COMPONENT_VOCABULARY,
  without: [],
  storefront: true,
  writesTree: true,
  subset: false,
};

function isComponent(name: string): name is Component {
  return (COMPONENT_VOCABULARY as readonly string[]).includes(name);
}

/**
 * The selection, or every reason there is none.
 *
 * `only` is what `--only` was given, split on commas and not yet trimmed;
 * `undefined` or an empty list is a flag nobody typed. `without` and
 * `storefront` are `--without` and `--no-storefront` as the command line
 * carried them (`storefront: false` is the flag, `undefined` its absence).
 */
export function resolveSelection(
  only: readonly string[] | undefined,
  without: readonly string[],
  storefront: boolean | undefined,
): Selection | { readonly refusals: readonly string[] } {
  const declined = without.map((name) => name.trim()).filter((name) => name.length > 0);
  if (only === undefined || only.length === 0) {
    const components = COMPONENT_VOCABULARY.filter((component) =>
      component === 'admin'
        ? !declined.includes('admin')
        : component === 'storefront'
          ? storefront !== false
          : true,
    );
    return {
      components,
      without: declined,
      storefront: storefront !== false,
      writesTree: true,
      subset: false,
    };
  }

  const names = only.map((name) => name.trim()).filter((name) => name.length > 0);
  const vocabulary = COMPONENT_VOCABULARY.join(', ');
  if (names.length === 0) {
    return {
      refusals: [
        `\`--only\` was given and names nothing. It takes at least one of ${vocabulary}; ` +
          'leave the flag out to stand up all three.',
      ],
    };
  }
  const refusals: string[] = [];
  const unknown = [...new Set(names.filter((name) => !isComponent(name)))];
  if (unknown.length > 0) {
    refusals.push(
      `\`--only\` names ${unknown.join(', ')}, which ${unknown.length === 1 ? 'is' : 'are'} not ` +
        `a component. The components are ${vocabulary}` +
        (unknown.includes('docs')
          ? ' — `docs` is a member of the tree, left out with `--without docs`.'
          : unknown.includes('backend')
            ? ' — the backend member is what `api` runs.'
            : '.'),
    );
  }
  const components = COMPONENT_VOCABULARY.filter((component) => names.includes(component));
  if (components.includes('admin') && declined.includes('admin')) {
    refusals.push(
      '`--only admin` and `--without admin` were both given, and they say opposite things: ' +
        'one stands the admin up here and the other leaves it out of the tree. Pass one.',
    );
  }
  if (components.includes('storefront') && storefront === false) {
    refusals.push(
      '`--only storefront` and `--no-storefront` were both given, and they say opposite ' +
        'things: one writes the storefront and the other writes none. Pass one.',
    );
  }
  if (refusals.length > 0) return { refusals };

  const writesTree = components.includes('api') || components.includes('admin');
  return {
    components,
    without:
      writesTree && !components.includes('admin') && !declined.includes('admin')
        ? [...declined, 'admin']
        : declined,
    storefront: components.includes('storefront'),
    writesTree,
    subset: components.length < COMPONENT_VOCABULARY.length,
  };
}

/**
 * A public origin — `http(s)://host[:port]` and nothing after it — or `null`.
 *
 * The answer is `new URL(value).origin`, so a default port and the host's case
 * are normalised the way a browser normalises the `Origin` header the API's
 * allow-list is compared against. A path, a trailing slash, a query, a
 * fragment and credentials are each refused rather than trimmed: a value that
 * carries one was meant as something other than an origin, and a
 * `CORS_ALLOWED_ORIGINS` entry with a trailing slash matches no browser.
 */
export function parseOrigin(value: string): string | null {
  const text = value.trim();
  if (!/^https?:\/\/[^/?#\s]+$/i.test(text)) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username !== '' || url.password !== '' || url.hostname === '') return null;
  return url.origin;
}

/** The sentence a value that is not an origin is refused with. */
export const NOT_AN_ORIGIN = 'that is not an origin: scheme and host, an optional port, no path.';

/** The id of one question `endora install` can ask. */
export type QuestionId =
  | 'directory'
  | 'parts'
  | 'api-url'
  | 'admin-url'
  | 'storefront-url'
  | 'sales-channel'
  | 'revalidate-secret'
  | 'services'
  | 'demo'
  | 'admin-email'
  | 'admin-password'
  | 'admin-name';

/**
 * The questions a selection has, in the order they are asked (FR-017…FR-019).
 *
 * The seven of the run that selects nothing; for a strict subset, the origins
 * of the machines this one is not, directly after the parts question — and
 * without the API, none of the questions about a database, demo rows or an
 * administrator, because the run has none of the three.
 */
export function questionIdsFor(selection: Selection): readonly QuestionId[] {
  const has = (component: Component): boolean => selection.components.includes(component);
  const ids: QuestionId[] = ['directory', 'parts'];
  if (!has('api')) {
    ids.push('api-url');
    if (has('storefront')) ids.push('storefront-url', 'sales-channel', 'revalidate-secret');
    return ids;
  }
  if (selection.subset) {
    ids.push('api-url');
    if (!has('admin')) ids.push('admin-url');
    if (!has('storefront')) ids.push('storefront-url');
  }
  ids.push('services', 'demo', 'admin-email', 'admin-password', 'admin-name');
  return ids;
}
