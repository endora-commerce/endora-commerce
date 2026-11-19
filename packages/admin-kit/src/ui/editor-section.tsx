import { createContext, useContext, useId, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '../lib/utils.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './card.js';

/**
 * How a section is drawn: `section` — a heading, an optional line and a rule
 * between it and the section before it, inside whatever card the page already
 * has — or `card`, its own `Card`, for a section that stands alone on a page.
 */
export type EditorSectionChrome = 'section' | 'card';

/** The heading an `EditorSection` renders. `h2` by default; never `h1`, which is `PageHeader`'s. */
export type EditorSectionHeading = 'h2' | 'h3' | 'h4' | 'h5' | 'h6';

/**
 * The chrome a section takes when its caller names none. `section` everywhere,
 * except under a mount that stands alone on a page — `<AdminZone chrome="card">`
 * — which sets it for the sections directly inside it.
 */
const ChromeContext = createContext<EditorSectionChrome>('section');

export interface EditorSectionChromeProviderProps {
  chrome: EditorSectionChrome;
  children: ReactNode;
}

/**
 * Sets the default chrome of the outermost `EditorSection`s below it — how a
 * mount (a zone at page level) says that what renders into it stands alone. A
 * section resets it for its own children, so a section inside a carded one is
 * never a card in a card.
 */
export function EditorSectionChromeProvider({ chrome, children }: EditorSectionChromeProviderProps): ReactNode {
  return <ChromeContext.Provider value={chrome}>{children}</ChromeContext.Provider>;
}

/** The default chrome a section would take here — for a composite that is not built on `EditorSection`. */
export function useEditorSectionChrome(): EditorSectionChrome {
  return useContext(ChromeContext);
}

export interface EditorSectionProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title: ReactNode;
  /** `h2` by default — a section of the page under its `h1`. `h3` inside a titled card or section. */
  as?: EditorSectionHeading;
  /** One line, muted, under the heading. Anything longer belongs in a `HelpTip` or the docs. */
  description?: ReactNode;
  /** A control beside the heading — an *Add*, a count. Not the editor's Save. */
  action?: ReactNode;
  /**
   * A rule above the section when it follows another section that divides.
   * `true` by default; `false` where the parent already separates its children
   * (a `divide-y` list) so the two rules do not stack.
   */
  divider?: boolean;
  /** `section` unless the mount says otherwise; `card` for a section that stands alone on a page. */
  chrome?: EditorSectionChrome;
  /** Classes for the wrapper of the children (`CardContent` under `chrome="card"`). */
  contentClassName?: string;
  children?: ReactNode;
}

/**
 * One section of an editor (issue #1437, UX audit 2026-11-17 DS-03): a heading,
 * an optional one-line description, a divider, and the caller's children — on
 * the density tokens `Card` reads (`--fs-section-title`, `--fs-hint`,
 * `--section-gap`).
 *
 * **One card per editor tab, sections inside it.** A frame inside a card is a
 * defect unless it is a field (Common Region): a bordered region reads as a
 * separate object, so a card of sections inside a card reads as two screens. The
 * section therefore draws no border, and separates itself from the section
 * before it with one rule. `chrome="card"` is for the section that has no card
 * around it — a panel standing alone on a page.
 *
 * The region is a `<section>` labelled by its heading and described by its
 * description, so a screen reader's landmark list names it (WCAG 2.2 SC 1.3.1).
 */
export function EditorSection({
  title,
  as = 'h2',
  description,
  action,
  divider = true,
  chrome,
  className,
  contentClassName,
  children,
  id,
  ...rest
}: EditorSectionProps): ReactNode {
  const inherited = useContext(ChromeContext);
  const resolved = chrome ?? inherited;
  const generated = useId();
  const headingId = `${id ?? generated}-title`;
  const descriptionId = description ? `${id ?? generated}-description` : undefined;
  const Heading = as;

  // Children are not under the mount any more: a section inside this one is a section.
  const body = <ChromeContext.Provider value="section">{children}</ChromeContext.Provider>;

  if (resolved === 'card') {
    return (
      <Card
        {...rest}
        id={id}
        role="region"
        aria-labelledby={headingId}
        aria-describedby={descriptionId}
        className={className}
      >
        <CardHeader>
          <div className="flex items-start justify-between gap-2">
            <CardTitle as={as} id={headingId}>
              {title}
            </CardTitle>
            {action ?? null}
          </div>
          {description ? <CardDescription id={descriptionId}>{description}</CardDescription> : null}
        </CardHeader>
        <CardContent className={cn('space-y-3', contentClassName)}>{body}</CardContent>
      </Card>
    );
  }

  return (
    <section
      // The heading labels the region unless the caller names it otherwise (`Section` passes
      // `aria-labelledby={undefined}`, so a host's own labelled wrapper is not a second region).
      aria-labelledby={headingId}
      aria-describedby={descriptionId}
      {...rest}
      id={id}
      data-slot="editor-section"
      data-divider={divider ? '' : undefined}
      className={cn(
        'space-y-3',
        divider && [
          '[[data-slot=editor-section][data-divider]+&]:border-t',
          '[[data-slot=editor-section][data-divider]+&]:pt-(--section-gap)',
        ],
        className,
      )}
    >
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <Heading
            id={headingId}
            className="text-(length:--fs-section-title) font-semibold leading-tight tracking-tight"
          >
            {title}
          </Heading>
          {action ?? null}
        </div>
        {description ? (
          <p id={descriptionId} className="text-(length:--fs-hint) text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {contentClassName ? <div className={contentClassName}>{body}</div> : body}
    </section>
  );
}
