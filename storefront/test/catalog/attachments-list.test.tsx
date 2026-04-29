import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { AttachmentsList } from '../../components/AttachmentsList';

/**
 * T092 — SSR contract for AttachmentsList (feature 002 US3).
 * Pure react-dom/server.renderToString — no JSDOM. Foundation pattern.
 *
 * Pins the spec.md US3 attachment requirements:
 *   - Each attachment renders type → name → optional description
 *   - The download anchor points at the Asset's url
 *   - Multiple attachments of the same type are grouped under one heading
 *   - Empty list → component renders nothing (caller decides on absence UX)
 */

type Attachment = {
  id: string;
  position: number;
  name: string;
  description: string | null;
  type: { id: string; code: string; name: Record<string, string> };
  asset: {
    id: string;
    kind: string;
    url: string;
    filename: string;
    sizeBytes: number;
    mimeType: string;
  };
};

const a = (
  id: string,
  typeCode: string,
  typeName: string,
  name: string,
  description: string | null,
  url: string,
): Attachment => ({
  id,
  position: Number(id),
  name,
  description,
  type: { id: `t-${typeCode}`, code: typeCode, name: { 'en-US': typeName } },
  asset: {
    id: `as-${id}`,
    kind: 'pdf',
    url,
    filename: `${name}.pdf`,
    sizeBytes: 1024,
    mimeType: 'application/pdf',
  },
});

describe('AttachmentsList — SSR contract', () => {
  it('renders nothing when list is empty', () => {
    const html = renderToString(<AttachmentsList attachments={[]} locale="en-US" />);
    expect(html).toBe('');
  });

  it('renders type heading + name + download link per attachment', () => {
    const html = renderToString(
      <AttachmentsList
        attachments={[a('1', 'certificate', 'Certificate', 'CE Marking', null, '/files/ce.pdf')]}
        locale="en-US"
      />,
    );
    expect(html).toContain('Certificate');
    expect(html).toContain('CE Marking');
    expect(html).toContain('href="/files/ce.pdf"');
  });

  it('renders optional description when present', () => {
    const html = renderToString(
      <AttachmentsList
        attachments={[
          a('1', 'tech_spec', 'Spec', 'Datasheet', 'Voltage range etc.', '/files/sheet.pdf'),
        ]}
        locale="en-US"
      />,
    );
    expect(html).toContain('Voltage range etc.');
  });

  it('omits description block when null', () => {
    const html = renderToString(
      <AttachmentsList
        attachments={[a('1', 'pdf', 'PDF', 'Manual', null, '/files/manual.pdf')]}
        locale="en-US"
      />,
    );
    // Manual still rendered, but no <p class="b2b-attachment__description">
    expect(html).toContain('Manual');
    expect(html).not.toContain('b2b-attachment__description');
  });

  it('groups multiple attachments of the same type under a single heading', () => {
    const html = renderToString(
      <AttachmentsList
        attachments={[
          a('1', 'certificate', 'Certificate', 'CE', null, '/files/ce.pdf'),
          a('2', 'certificate', 'Certificate', 'RoHS', null, '/files/rohs.pdf'),
          a('3', 'tech_spec', 'Spec', 'Datasheet', null, '/files/sheet.pdf'),
        ]}
        locale="en-US"
      />,
    );
    // 'Certificate' heading appears exactly once, 'Spec' once
    expect(html.match(/>Certificate</g)?.length ?? 0).toBe(1);
    expect(html.match(/>Spec</g)?.length ?? 0).toBe(1);
    // All three names rendered
    expect(html).toContain('CE');
    expect(html).toContain('RoHS');
    expect(html).toContain('Datasheet');
  });
});
