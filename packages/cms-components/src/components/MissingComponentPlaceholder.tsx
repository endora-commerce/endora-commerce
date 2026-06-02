import { type ComponentConfig } from '@measured/puck';

/**
 * Placeholder rendered in place of a Page Builder component whose React
 * renderer is missing from the bundled `defaultPageBuilderConfig`. Two
 * scenarios produce one:
 *
 *   1. Admin: a backend module contributes a component descriptor through
 *      the SPI but the admin app hasn't been re-built with its renderer
 *      yet — the merged config registers this placeholder so authors can
 *      keep editing without losing the node.
 *   2. Storefront: the same situation seen at render time. The admin author
 *      still sees the placeholder; end customers see nothing unless the
 *      `?cms_admin=1` URL parameter is present (preview mode).
 */

interface MissingComponentPlaceholderProps {
  componentName: string;
  ownerModule?: string;
  /**
   * When set on the storefront render context (e.g., via a query string),
   * the placeholder is fully visible. Otherwise it renders an empty span
   * so end customers don't see internal admin chrome.
   */
  isAdminPreview?: boolean;
}

export const MissingComponentPlaceholder: ComponentConfig<MissingComponentPlaceholderProps> = {
  label: 'Missing component',
  fields: {
    componentName: { type: 'text', label: 'Component name' },
    ownerModule: { type: 'text', label: 'Owner module' },
  },
  defaultProps: {
    componentName: 'Unknown',
  },
  render: ({ componentName, ownerModule, isAdminPreview }) => {
    if (!isAdminPreview) {
      const win = globalThis as { location?: { search?: string } };
      const search = win.location?.search ?? '';
      isAdminPreview = /(?:^|[?&])cms_admin=1(?:&|$)/.test(search);
    }
    if (!isAdminPreview) {
      return <span aria-hidden="true" className="cmsc:hidden" />;
    }
    return (
      <div
        role="note"
        className="cmsc:font-sans cmsc:border cmsc:border-dashed cmsc:border-[#ef4444] cmsc:bg-[#fef2f2] cmsc:text-[#7f1d1d] cmsc:p-[12px] cmsc:rounded-[6px] cmsc:text-[13px]"
      >
        <strong>Missing CMS component:</strong> <code>{componentName}</code>
        {ownerModule ? <span> (owner: {ownerModule})</span> : null}
        <div className="cmsc:mt-[4px] cmsc:text-[#991b1b]">
          The renderer is not bundled in this storefront build. Re-deploy with the contributing
          module's renderer to make this component appear.
        </div>
      </div>
    );
  },
};
