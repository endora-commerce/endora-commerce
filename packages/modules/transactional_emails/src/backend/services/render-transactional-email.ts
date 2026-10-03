import { renderDirectives } from '@endora-commerce/email-components/directives/directive-engine';
import {
  emailBlockRendering,
  type EmailBlockFailureReporter,
  type EmailBlockRenderers,
} from '@endora-commerce/email-components/render/block-renderers';
import { renderEmailHtml } from '@endora-commerce/email-components/render/render-email-html';
import { renderEmailText } from '@endora-commerce/email-components/render/render-email-text';
import type { PuckDataTree } from '@endora-commerce/email-components/schema/envelope';

export interface RenderedTransactionalEmail {
  subject: string;
  html: string;
  text: string;
}

export interface RenderTransactionalEmailInput {
  readonly subject: string;
  readonly content: PuckDataTree | null | undefined;
  readonly embeds: { blocks: Record<string, PuckDataTree>; templates: Record<string, PuckDataTree> };
  readonly branding: { readonly logoUrl: string; readonly accentColor: string };
  readonly variables: Record<string, unknown>;
  readonly language: string;
  /**
   * The e-mail block renderers the composed modules contributed
   * (`specs/141-module-block-renderers/`), **read per render**: the table
   * leaves out a module an operator switched off, so a function is what makes
   * a flip take effect on the next message with no restart.
   */
  readonly blockRenderers?: () => EmailBlockRenderers;
  /** Told about a contributed block that threw; the message still renders. */
  readonly onBlockFailure?: EmailBlockFailureReporter;
}

/**
 * Tree → e-mail-safe HTML and plain text, then the directives.
 *
 * The pure half of `TransactionalEmailService.renderWith`, on its own so the
 * send path and the admin preview — both go through it — are one statement of
 * what a message is, and so it is testable without a database.
 */
export function renderTransactionalEmail(
  input: RenderTransactionalEmailInput,
): RenderedTransactionalEmail {
  const ctx: Record<string, unknown> = {
    ...input.variables,
    branding: { logoUrl: input.branding.logoUrl, accentColor: input.branding.accentColor },
  };
  const contributed = emailBlockRendering(input.blockRenderers?.(), input.onBlockFailure);
  const html = renderDirectives(
    renderEmailHtml(input.content, {
      embeds: input.embeds,
      accentColor: input.branding.accentColor,
      language: input.language,
      ...contributed,
    }),
    ctx,
    { escape: true },
  );
  const text = renderDirectives(
    renderEmailText(input.content, {
      embeds: input.embeds,
      accentColor: input.branding.accentColor,
      language: input.language,
      ...contributed,
    }),
    ctx,
  );
  const subject = renderDirectives(input.subject, ctx);
  return { subject, html, text };
}
