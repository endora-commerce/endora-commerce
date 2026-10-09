import {
  emailBlockRendering,
  type EmailBlockFailureReporter,
  type EmailBlockRenderers,
} from '@endora-commerce/email-components/render/block-renderers';
import { renderEmailHtml } from '@endora-commerce/email-components/render/render-email-html';
import { renderEmailText } from '@endora-commerce/email-components/render/render-email-text';
import { renderDirectives } from '@endora-commerce/email-components/directives/directive-engine';

/**
 * Newsletter content rendering (feature 048, research R2/R4). Reuses the shared
 * `@endora-commerce/email-components` renderer + directive engine wholesale, so newsletter
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

/**
 * What every render of one composition shares
 * (`specs/141-module-block-renderers/`).
 */
export interface NewsletterBlockRendering {
  /**
   * The e-mail block renderers the composed modules contributed, **read per
   * render**: the table leaves out a module an operator switched off, so a
   * function is what makes a flip take effect on the next message.
   */
  readonly blockRenderers?: () => EmailBlockRenderers;
  /** Told about a contributed block that threw; the message still renders. */
  readonly onBlockFailure?: EmailBlockFailureReporter;
}

export interface RenderedNewsletterEmail {
  subject: string;
  html: string;
  text: string;
}

const EMPTY_EMBEDS: EmailEmbeds = { blocks: {}, templates: {} };

export type EmailBrandingResolver = (
  salesChannelId: string | null,
) => Promise<{ logoUrl: string; accentColor: string }>;

/**
 * Names the platform's default Sales Channel — the accessor a composition
 * binds to `salesChannelResolutionPort.getSystemDefault()` (Principle XII).
 */
export type DefaultChannelIdResolver = () => Promise<string | null>;

/**
 * Merge channel branding into the directive variable map (logo + accent).
 *
 * A campaign or automation with no Sales Channel is branded as the **default**
 * channel (issue #121). "No channel" arrives here as `null` from a freshly
 * created entity and as `undefined` from one read back from its row — the ORM
 * is configured with `forceUndefined`, so a NULL column hydrates as `undefined`
 * whatever the property's declared type says. Passed on unchanged, `undefined`
 * is refused by the settings seam a branding source reads through, which is
 * what answered 500 to a preview and failed the send of the same campaign.
 *
 * With no default-channel accessor, or one that names nothing, the read is the
 * platform-wide one (`null`) — never `undefined`.
 */
export async function withEmailBranding(
  variables: Record<string, unknown>,
  salesChannelId: string | null | undefined,
  resolve?: EmailBrandingResolver,
  resolveDefaultChannelId?: DefaultChannelIdResolver,
): Promise<{ variables: Record<string, unknown>; accentColor?: string }> {
  if (!resolve) return { variables };
  const brandingChannelId = salesChannelId ?? (await resolveDefaultChannelId?.()) ?? null;
  const branding = await resolve(brandingChannelId);
  return {
    variables: {
      ...variables,
      branding: { logoUrl: branding.logoUrl, accentColor: branding.accentColor },
    },
    accentColor: branding.accentColor,
  };
}

/**
 * Pure render: tree → email-safe HTML + plain-text, then resolve `{{var}}` /
 * `{{if}}` / `{{for}}` directives against the recipient context. HTML values
 * are escaped; text values are raw. Missing variables resolve to empty strings
 * (the engine never throws), so no literal `{{...}}` ever ships (FR-028).
 */
export function renderNewsletterEmail(
  input: RenderInput,
  rendering: NewsletterBlockRendering = {},
): RenderedNewsletterEmail {
  const embeds = input.embeds ?? EMPTY_EMBEDS;
  const directiveCtx: Record<string, unknown> = {
    ...input.context.variables,
    unsubscribeUrl: input.context.unsubscribeUrl,
    ...(input.context.webviewUrl !== undefined ? { webviewUrl: input.context.webviewUrl } : {}),
  };

  const contributed = emailBlockRendering(rendering.blockRenderers?.(), rendering.onBlockFailure);
  const accent = input.accentColor !== undefined ? { accentColor: input.accentColor } : {};
  const rawHtml = renderEmailHtml(input.content, { embeds, ...accent, ...contributed });
  const rawText = renderEmailText(input.content, { embeds, ...accent, ...contributed });

  return {
    subject: renderDirectives(input.subject, directiveCtx),
    html: renderDirectives(rawHtml, directiveCtx, { escape: true }),
    text: renderDirectives(rawText, directiveCtx),
  };
}

export class NewsletterContentService {
  constructor(private readonly rendering: NewsletterBlockRendering = {}) {}

  /** Render a campaign/automation email for one recipient. */
  render(input: RenderInput): RenderedNewsletterEmail {
    return renderNewsletterEmail(input, this.rendering);
  }
}
