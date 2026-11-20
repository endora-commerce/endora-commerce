import type { ReactNode } from 'react';
import { Download } from 'lucide-react';
import { Button, type ButtonProps } from '@endora-commerce/admin-kit/ui';

/**
 * A file download drawn as a kit outline button — issue #1492 (UX audit
 * CAT-17).
 *
 * An anchor, not a fetch, so the filename comes from the server's
 * `Content-Disposition` and nothing is held in memory. Present but disabled
 * when the operator may not have the file, so they learn it exists (`title`
 * says why). Disabled is a real disabled button: the anchor it replaces was
 * made unclickable with `pointer-events: none`, which left it focusable and
 * followable from the keyboard (WCAG 2.1.1).
 */
export function DownloadAction(props: {
  href: string;
  label: string;
  enabled: boolean;
  title?: string | undefined;
  size?: ButtonProps['size'];
}): ReactNode {
  const { href, label, enabled, title, size } = props;
  if (!enabled) {
    return (
      <Button type="button" variant="outline" size={size} disabled title={title}>
        <Download aria-hidden="true" />
        {label}
      </Button>
    );
  }
  return (
    <Button asChild variant="outline" size={size}>
      <a href={href} title={title}>
        <Download aria-hidden="true" />
        {label}
      </a>
    </Button>
  );
}
