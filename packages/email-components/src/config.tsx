// Email-safe Puck editor configuration (feature 047).
//
// These ComponentConfigs power the admin email editor canvas. They render an
// approximate on-canvas preview; the authoritative, email-client-safe HTML is
// produced server-side by `render/render-email-html.ts`. The component name set
// is the single source of truth shared with the backend via
// `schema/component-types.ts` (EMAIL_SAFE_COMPONENT_NAMES).

import type { ComponentConfig, Config } from '@measured/puck';
import type {
  EmailButtonProps,
  EmailColumnsProps,
  EmailHeadingProps,
  EmailImageProps,
  EmailInsertBlockProps,
  EmailInsertTemplateProps,
  EmailSpacerProps,
  EmailTextProps,
} from './schema/component-types.js';

const ALIGN_OPTIONS = [
  { label: 'Left', value: 'left' },
  { label: 'Center', value: 'center' },
  { label: 'Right', value: 'right' },
];

export const EmailHeading: ComponentConfig<EmailHeadingProps> = {
  label: 'Heading',
  fields: {
    level: {
      type: 'select',
      label: 'Level',
      options: [
        { label: 'H1', value: 'h1' },
        { label: 'H2', value: 'h2' },
        { label: 'H3', value: 'h3' },
      ],
    },
    text: { type: 'textarea', label: 'Text' },
    align: { type: 'select', label: 'Align', options: ALIGN_OPTIONS },
  },
  defaultProps: { level: 'h2', text: 'Heading', align: 'left' },
  render: ({ level, text, align }) => {
    const Tag = level;
    return <Tag style={{ margin: '8px 0', textAlign: align, color: '#15202b' }}>{text}</Tag>;
  },
};

export const EmailText: ComponentConfig<EmailTextProps> = {
  label: 'Text',
  fields: {
    text: { type: 'textarea', label: 'Text' },
    align: { type: 'select', label: 'Align', options: ALIGN_OPTIONS },
  },
  defaultProps: { text: 'Email text. Use {{var your.variable}} for dynamic values.', align: 'left' },
  render: ({ text, align }) => (
    <p style={{ margin: '6px 0', textAlign: align, color: '#1f2937', whiteSpace: 'pre-wrap' }}>{text}</p>
  ),
};

export const EmailButton: ComponentConfig<EmailButtonProps> = {
  label: 'Button',
  fields: {
    label: { type: 'text', label: 'Label' },
    href: { type: 'text', label: 'Link' },
    align: { type: 'select', label: 'Align', options: ALIGN_OPTIONS },
    backgroundColor: { type: 'text', label: 'Background color' },
    textColor: { type: 'text', label: 'Text color' },
  },
  defaultProps: { label: 'Call to action', href: '#', align: 'left', backgroundColor: '#1f2937', textColor: '#ffffff' },
  render: ({ label, href, align, backgroundColor, textColor }) => (
    <div style={{ textAlign: align, margin: '8px 0' }}>
      <a
        href={href || '#'}
        style={{
          display: 'inline-block',
          padding: '12px 22px',
          backgroundColor: backgroundColor || '#1f2937',
          color: textColor || '#ffffff',
          borderRadius: 6,
          textDecoration: 'none',
          fontWeight: 'bold',
        }}
      >
        {label}
      </a>
    </div>
  ),
};

export const EmailImage: ComponentConfig<EmailImageProps> = {
  label: 'Image',
  fields: {
    src: { type: 'text', label: 'Image URL' },
    alt: { type: 'text', label: 'Alt text' },
    href: { type: 'text', label: 'Link (optional)' },
    width: { type: 'number', label: 'Width (px)' },
    align: { type: 'select', label: 'Align', options: ALIGN_OPTIONS },
  },
  defaultProps: { src: '', alt: '', href: '', width: 200, align: 'center' },
  render: ({ src, alt, width, align }) => (
    <div style={{ textAlign: align }}>
      {src ? (
        <img src={src} alt={alt} width={width} style={{ maxWidth: '100%' }} />
      ) : (
        <span style={{ color: '#9ca3af' }}>[image]</span>
      )}
    </div>
  ),
};

export const EmailDivider: ComponentConfig<Record<string, never>> = {
  label: 'Divider',
  fields: {},
  defaultProps: {},
  render: () => <hr style={{ border: 0, borderTop: '1px solid #e5e7eb', margin: '8px 0' }} />,
};

export const EmailSpacer: ComponentConfig<EmailSpacerProps> = {
  label: 'Spacer',
  fields: { height: { type: 'number', label: 'Height (px)' } },
  defaultProps: { height: 16 },
  render: ({ height }) => <div style={{ height }} />,
};

export const EmailColumns: ComponentConfig<EmailColumnsProps> = {
  label: 'Columns',
  fields: {
    columns: {
      type: 'array',
      label: 'Columns',
      arrayFields: { text: { type: 'textarea', label: 'Text' } },
    },
  },
  defaultProps: { columns: [{ text: 'Column 1' }, { text: 'Column 2' }] },
  render: ({ columns }) => (
    <table style={{ width: '100%' }}>
      <tbody>
        <tr>
          {(columns ?? []).map((c, i) => (
            <td key={i} style={{ verticalAlign: 'top', padding: '0 8px' }}>
              {c?.text ?? ''}
            </td>
          ))}
        </tr>
      </tbody>
    </table>
  ),
};

export const EmailInsertBlock: ComponentConfig<EmailInsertBlockProps> = {
  label: 'Insert block',
  fields: { code: { type: 'text', label: 'Block code' } },
  defaultProps: { code: '' },
  render: ({ code }) => (
    <div style={{ padding: 8, border: '1px dashed #cbd5e1', color: '#64748b' }}>
      {code ? `Block "${code}"` : 'Choose a block'}
    </div>
  ),
};

export const EmailInsertTemplate: ComponentConfig<EmailInsertTemplateProps> = {
  label: 'Insert template',
  fields: { code: { type: 'text', label: 'Template code' } },
  defaultProps: { code: '' },
  render: ({ code }) => (
    <div style={{ padding: 8, border: '1px dashed #cbd5e1', color: '#64748b' }}>
      {code ? `Template "${code}"` : 'Choose a template'}
    </div>
  ),
};

export const defaultEmailBuilderConfig: Config = {
  categories: {
    content: {
      title: 'Content',
      components: ['EmailHeading', 'EmailText', 'EmailButton', 'EmailImage'],
      defaultExpanded: true,
    },
    layout: {
      title: 'Layout',
      components: ['EmailColumns', 'EmailDivider', 'EmailSpacer'],
    },
    embeds: {
      title: 'Embeds',
      components: ['EmailInsertBlock', 'EmailInsertTemplate'],
    },
  },
  components: {
    EmailHeading,
    EmailText,
    EmailButton,
    EmailImage,
    EmailDivider,
    EmailSpacer,
    EmailColumns,
    EmailInsertBlock,
    EmailInsertTemplate,
  },
};
