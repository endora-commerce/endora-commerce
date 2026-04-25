import type { ReactNode } from 'react';

/**
 * Reference-theme footer. A real theme will likely link to CMS pages here
 * — fetch them in the layout and pass the list down.
 */
export function Footer(props: { cmsLinks?: Array<{ path: string; title: string }> }): ReactNode {
  return (
    <footer className="b2b-footer">
      <div className="b2b-footer__inner">
        {props.cmsLinks && props.cmsLinks.length > 0 ? (
          <nav aria-label="Footer">
            {props.cmsLinks.map((l) => (
              <a key={l.path} href={`/${l.path}`}>
                {l.title}
              </a>
            ))}
          </nav>
        ) : null}
        <small>&copy; B2B Platform</small>
      </div>
    </footer>
  );
}
