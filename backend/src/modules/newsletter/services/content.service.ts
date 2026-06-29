import { renderEmailHtml } from '@b2b/email-components/render/render-email-html';
import { renderEmailText } from '@b2b/email-components/render/render-email-text';
import { renderDirectives } from '@b2b/email-components/directives/directive-engine';

/**
 * Newsletter content rendering (feature 048, research R2/R4). Reuses the shared
 * `@b2b/email-components` renderer + directive engine wholesale, so newsletter
 * mail is visually identical to transactional mail. This module owns only the
 * per-recipient variable context and the compose-with-blocks step.
 */
export type ContentTree = Record<string, unknown>;

export interface EmailEmbeds {
  blocks: Record<string, ContentTree>;
  templates: Record<string, ContentTree>;
}

export interface RenderContext {
  /** Flat variable map merged into the directive context (subscriber.*, customFields.*, channel.*). */
  variables: Record<string, unknown>;
  /** Mandatory unsubscribe link (FR-029). */
  unsubscribeUrl: string;
  /** Web-view link. */
  webviewUrl?: string;
}

export interface RenderInput {
  subject: string;
  content: ContentTree;
  embeds?: EmailEmbeds;
  accentColor?: string;
  context: RenderContext;
}

export interface RenderedNewsletterEmail {
  subject: string;
  html: string;
  text: string;
}

const EMPTY_EMBEDS: EmailEmbeds = { blocks: {}, templates: {} };

/**
 * Pure render: tree → email-safe HTML + plain-text, then resolve `{{var}}` /
 * `{{if}}` / `{{for}}` directives against the recipient context. HTML values
 * are escaped; text values are raw. Missing variables resolve to empty strings
 * (the engine never throws), so no literal `{{...}}` ever ships (FR-028).
 */
export function renderNewsletterEmail(input: RenderInput): RenderedNewsletterEmail {
  const embeds = input.embeds ?? EMPTY_EMBEDS;
  const directiveCtx: Record<string, unknown> = {
    ...input.context.variables,
    unsubscribeUrl: input.context.unsubscribeUrl,
    ...(input.context.webviewUrl !== undefined ? { webviewUrl: input.context.webviewUrl } : {}),
  };

  const htmlOpts = input.accentColor !== undefined
    ? { embeds, accentColor: input.accentColor }
    : { embeds };
  const rawHtml = renderEmailHtml(input.content, htmlOpts);
  const rawText = renderEmailText(input.content, { embeds });

  return {
    subject: renderDirectives(input.subject, directiveCtx),
    html: renderDirectives(rawHtml, directiveCtx, { escape: true }),
    text: renderDirectives(rawText, directiveCtx),
  };
}

export class NewsletterContentService {
  /** Render a campaign/automation email for one recipient. */
  render(input: RenderInput): RenderedNewsletterEmail {
    return renderNewsletterEmail(input);
  }
}
