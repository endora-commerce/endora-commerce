import { useEffect, useState, type ReactNode } from 'react';
import type { EmailEmbeds, EmailRenderEmbeds, PuckDataTree } from '@b2b/email-components';
import {
  EmailEditorPane as SharedEmailEditorPane,
  previewNode,
  type EmailEditorPaneProps,
  type EmailEmbedCodeOption,
} from '@/modules/_shared/email-builder';
import { transactionalEmailsClient } from '../api/transactional-emails-client';

function pickLanguageTree(content: Record<string, PuckDataTree>): PuckDataTree | null {
  return content['pl-PL'] ?? content['en-US'] ?? Object.values(content)[0] ?? null;
}

/**
 * Transactional-emails editor pane — loads TE blocks for embeds,
 * then delegates to the shared EmailEditorPane.
 */
export function EmailEditorPane(
  props: Omit<EmailEditorPaneProps, 'blockOptions' | 'embeds' | 'embedTrees' | 'builderContext'>,
): React.ReactElement {
  const [blockOptions, setBlockOptions] = useState<EmailEmbedCodeOption[]>([]);
  const [embeds, setEmbeds] = useState<EmailEmbeds>({ blocks: {}, templates: {} });
  const [embedTrees, setEmbedTrees] = useState<EmailRenderEmbeds>({ blocks: {}, templates: {} });

  useEffect(() => {
    let live = true;
    void (async (): Promise<void> => {
      const blockRes = await transactionalEmailsClient.listBlocks().catch(() => ({ items: [] }));
      if (!live) return;
      setBlockOptions(blockRes.items.map((b) => ({ label: `${b.name} (${b.code})`, value: b.code })));

      const blockPreviews: Record<string, ReactNode> = {};
      const blockTrees: Record<string, PuckDataTree> = {};
      await Promise.all(
        blockRes.items.map(async (b) => {
          try {
            const detail = await transactionalEmailsClient.getBlock(b.id);
            const tree = pickLanguageTree(detail.content);
            if (tree) blockTrees[b.code] = tree;
            blockPreviews[b.code] = previewNode(detail.content);
          } catch {
            /* leave the code-only fallback */
          }
        }),
      );
      if (live) {
        setEmbeds({ blocks: blockPreviews, templates: {} });
        setEmbedTrees({ blocks: blockTrees, templates: {} });
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  return (
    <SharedEmailEditorPane
      {...props}
      builderContext="email"
      blockOptions={blockOptions}
      embeds={embeds}
      embedTrees={embedTrees}
    />
  );
}
