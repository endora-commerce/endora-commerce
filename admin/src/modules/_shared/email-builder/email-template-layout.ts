import type { Data } from '@measured/puck';
import type { EmailTemplateDetail, EmailTemplateSummary } from '@endora-commerce/contracts';
import { emptyPageBuilderData, isEmptyPageBuilderData } from '@/modules/cms/components/page-builder-data';
import { codeFromTemplateName } from '@/modules/cms/components/cms-template-layout';
import { transactionalEmailsClient } from '@/modules/transactional_emails/api/transactional-emails-client';

export { codeFromTemplateName };

export async function saveCanvasAsEmailTemplate(input: {
  name: string;
  code: string;
  data: Data;
  salesChannelIds?: string[];
  languages: string[];
  activeLanguage: string | null;
}): Promise<EmailTemplateDetail> {
  if (isEmptyPageBuilderData(input.data)) {
    throw new Error('EMPTY_CANVAS');
  }
  if (input.languages.length === 0) {
    throw new Error('MISSING_SCOPE');
  }
  const language = input.activeLanguage ?? input.languages[0];
  if (!language) {
    throw new Error('MISSING_SCOPE');
  }

  const created = await transactionalEmailsClient.createTemplate({
    name: input.name.trim(),
    code: input.code.trim(),
    languages: input.languages,
    ...(input.salesChannelIds && input.salesChannelIds.length > 0
      ? { salesChannelIds: input.salesChannelIds }
      : {}),
  });
  return transactionalEmailsClient.putTemplateContent(created.id, language, {
    content: input.data as never,
    expectedVersion: created.version,
  });
}

export async function listEmailTemplatesForApply(
  salesChannelId?: string | null,
): Promise<Array<{ id: string; label: string }>> {
  const res = await transactionalEmailsClient.listTemplates(salesChannelId ?? undefined);
  return res.items.map((tpl: EmailTemplateSummary) => ({
    id: tpl.id,
    label: tpl.name ? `${tpl.name} (${tpl.code})` : tpl.code,
  }));
}

export async function loadEmailTemplateCanvas(
  templateId: string,
  preferredLanguage: string | null,
): Promise<Data> {
  const detail = await transactionalEmailsClient.getTemplate(templateId);
  const language =
    (preferredLanguage && detail.languages.includes(preferredLanguage)
      ? preferredLanguage
      : null) ??
    detail.languages[0] ??
    Object.keys(detail.content)[0] ??
    null;
  if (!language) {
    return emptyPageBuilderData();
  }
  const tree = detail.content[language];
  if (tree && typeof tree === 'object') {
    return structuredClone(tree as Data);
  }
  const fallback = Object.values(detail.content)[0];
  if (fallback && typeof fallback === 'object') {
    return structuredClone(fallback as Data);
  }
  return emptyPageBuilderData();
}
