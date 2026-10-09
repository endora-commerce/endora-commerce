import { Badge } from './ui/badge.js';
import { useTranslation } from '../i18n/useTranslation.js';

/**
 * The release number under the wordmark.
 *
 * The kit's `Badge`, so its shape is the one every other badge in the admin
 * has; the colours are the sidebar's own (`.b2b-sidebar__brand-version` in the
 * kit's `theme.css`) because the sidebar is dark in both themes and the
 * `outline` variant's `text-foreground` is near-black in the light one.
 *
 * Two texts, one meaning: sighted operators read the short form and assistive
 * technology is given the sentence instead of a bare number. There is no
 * `title` here — the badge takes no pointer events, so that the header stays
 * one click target, and the brand link's own tooltip carries the sentence.
 *
 * **The short form is not a translated string**, on purpose. `v0.104.0` is a
 * datum, the same in every language, and routing it through a bundle key would
 * give the badge a way to render `core.appShell.brand.version` — the bundles
 * are served by the API, so an instance whose stored bundles are older than
 * this shell would show a raw key where a number belongs. The sentence *is*
 * translated, and is held to the same rule: if what came back does not carry
 * the number, the key did not resolve, and the bare number stands in for it.
 *
 * Not interactive and not a live region: it is a fact about the instance that
 * does not change while the page is open.
 */
export function VersionBadge({ version }: { version: string }) {
  const t = useTranslation('core');
  const short = `v${version}`;
  const sentence = t('appShell.brand.versionLabel', { version });
  const label = sentence.includes(version) ? sentence : short;
  return (
    <Badge variant="outline" className="b2b-sidebar__brand-version">
      <span aria-hidden="true">{short}</span>
      <span className="sr-only">{label}</span>
    </Badge>
  );
}
