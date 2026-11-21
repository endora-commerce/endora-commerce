import { DEFAULT_HEADER_BLOCK_CODE, defaultHeaderTree } from '@endora-commerce/email-components/defaults/default-header';
import { simpleEmailBodyTree } from '@endora-commerce/email-components/defaults/simple-email-body';
import { describe, expect, it } from 'vitest';

import { renderTransactionalEmail } from './render-transactional-email.js';

const base = {
  subject: 'Hello {{var name}}',
  content: simpleEmailBodyTree({ text: 'Welcome {{var name}}' }),
  embeds: {
    blocks: { [DEFAULT_HEADER_BLOCK_CODE]: defaultHeaderTree() },
    templates: {},
  },
  variables: { name: 'Ada' },
  language: 'en-US',
};

describe('the default header in a transactional e-mail (#1587)', () => {
  it('omits the logo row when no branding logo URL is configured', () => {
    const out = renderTransactionalEmail({
      ...base,
      branding: { logoUrl: '', accentColor: '#123456' },
    });

    expect(out.subject).toBe('Hello Ada');
    expect(out.html).toContain('Welcome Ada');
    expect(out.html).toContain('<hr');
    expect(out.html).not.toContain('<img');
    expect(out.html).not.toContain('<td align="center" style="padding:0 24px;');
    expect(out.html).not.toContain('src=""');
    expect(out.html).not.toContain('{{');
  });

  it('renders the configured logo URL in the header', () => {
    const out = renderTransactionalEmail({
      ...base,
      branding: { logoUrl: 'https://shop.example/logo.png?size=2&theme=dark', accentColor: '#123456' },
    });

    expect(out.subject).toBe('Hello Ada');
    expect(out.html).toContain('Welcome Ada');
    expect(out.html).toContain('<td align="center" style="padding:0 24px;');
    expect(out.html).toContain('src="https://shop.example/logo.png?size=2&amp;theme=dark"');
    expect(out.html).toContain('alt="Logo" width="160"');
    expect(out.html).not.toContain('{{');
  });
});
