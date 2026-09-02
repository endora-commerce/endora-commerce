import type { Data } from '@measured/puck';
import type { CmsTemplateDetail, CmsTemplateSummary } from '@endora-commerce/contracts';
import { cmsClient } from '../api/cms-client.js';
import { emptyPageBuilderData, isEmptyPageBuilderData } from '@endora-commerce/page-builder-admin';

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
