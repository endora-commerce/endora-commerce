import type { Data } from '@measured/puck';
import { slugify, type CmsTemplateDetail, type CmsTemplateSummary } from '@b2b/contracts';
import { cmsClient } from '../api/cms-client';
import { emptyPageBuilderData, isEmptyPageBuilderData } from './page-builder-data';

/**
 * A CMS (and, through `email-template-layout.ts`, an e-mail) template code,
 * prefilled from the template's name.
 *
 * `slugify` from `@b2b/contracts`, **imported, never re-implemented** (issue
 * #245). The chain this carried had **no fold step at all**: it lowercased and
 * went straight to `[^a-z0-9]+`, deleting every non-ASCII letter instead of
 * folding it — `Łatwy szablon` produced `atwy-szablon`, `Żółw` produced `w`,
 * `Świeże Ćwikła` produced `wie-e-wik-a`. That is issue #240's defect, and
 * `check:diacritic-folds` was structurally blind to it: it counts folds written
 * outside the shared helper, and a site that folds nothing writes none.
 *
 * The 180-character cut is this caller's own (the `cmsCodeRe` limit) and is
 * passed explicitly; the trailing separator a cut used to leave behind is now
 * stripped after it rather than before.
 */
export function codeFromTemplateName(input: string): string {
  return slugify(input, { maxLength: 180 });
}

export async function saveCanvasAsCmsTemplate(input: {
  name: string;
  code: string;
  data: Data;
  salesChannelIds: string[];
  languages: string[];
  activeLanguage: string | null;
}): Promise<CmsTemplateDetail> {
  if (isEmptyPageBuilderData(input.data)) {
    throw new Error('EMPTY_CANVAS');
  }
  if (input.salesChannelIds.length === 0 || input.languages.length === 0) {
    throw new Error('MISSING_SCOPE');
  }
  const language = input.activeLanguage ?? input.languages[0];
  if (!language) {
    throw new Error('MISSING_SCOPE');
  }

  const created = await cmsClient.createTemplate({
    name: input.name.trim(),
    code: input.code.trim(),
    salesChannelIds: input.salesChannelIds,
    languages: input.languages,
  });
  return cmsClient.putTemplateContent(created.id, language, {
    data: input.data,
    version: created.version,
  });
}

export async function listCmsTemplatesForApply(): Promise<
  Array<{ id: string; label: string }>
> {
  const res = await cmsClient.listTemplates();
  return res.data.map((tpl: CmsTemplateSummary) => ({
    id: tpl.id,
    label: tpl.name ? `${tpl.name} (${tpl.code})` : tpl.code,
  }));
}

export async function loadCmsTemplateCanvas(
  templateId: string,
  preferredLanguage: string | null,
): Promise<Data> {
  const detail = await cmsClient.getTemplate(templateId);
  const language =
    (preferredLanguage && detail.languages.includes(preferredLanguage)
      ? preferredLanguage
      : null) ??
    detail.languages[0] ??
    Object.keys(detail.content.languages)[0] ??
    null;
  if (!language) {
    return emptyPageBuilderData();
  }
  const tree = detail.content.languages[language];
  if (tree && typeof tree === 'object') {
    return structuredClone(tree as Data);
  }
  const fallback = Object.values(detail.content.languages)[0];
  if (fallback && typeof fallback === 'object') {
    return structuredClone(fallback as Data);
  }
  return emptyPageBuilderData();
}
