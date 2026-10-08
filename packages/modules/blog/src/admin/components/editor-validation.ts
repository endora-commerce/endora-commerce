/**
 * What stops a blog post or a blog category from being saved, as the key of the
 * sentence that says so — or `null` when nothing does.
 *
 * The two editors used to answer this with a disabled button, which says that
 * something is wrong and not what. With the fields in a panel that can be put
 * away, a disabled button would also be saying it about fields the operator
 * cannot see; so the button stays enabled, and a refused save names the first
 * thing missing and opens the panel it lives in.
 *
 * Checked in the order the panel shows them: name, slug, then the scope.
 */
export type BlogEditorProblem =
  | 'validation.nameRequired'
  | 'validation.slugInvalid'
  | 'validation.selectChannel'
  | 'validation.selectLanguage';

/** The slug shape the API enforces; `tag` is the blog's own reserved segment. */
const SLUG_RE = /^(?!tag$)[a-z0-9](?:[a-z0-9-]{0,158}[a-z0-9])?$/;

export function blogEditorProblem(input: {
  name: string;
  slug: string;
  salesChannelIds: readonly string[];
  languages: readonly string[];
}): BlogEditorProblem | null {
  if (input.name.trim().length === 0) return 'validation.nameRequired';
  if (!SLUG_RE.test(input.slug)) return 'validation.slugInvalid';
  if (input.salesChannelIds.length === 0) return 'validation.selectChannel';
  if (input.languages.length === 0) return 'validation.selectLanguage';
  return null;
}
