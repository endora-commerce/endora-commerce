import { describe, expect, it } from 'vitest';
import { sniffAttachmentType } from './attachment-sniff.js';

/**
 * `specs/180-off-platform-complaints/` T063 (FR-B20, research R-12): an attachment's
 * type is decided by its first bytes, never by what the browser declared.
 */
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const PNG = Buffer.from('89504E470D0A1A0A0000000D49484452', 'hex');
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x24, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);
const PDF = Buffer.from('%PDF-1.7\n%âãÏÓ\n');
const HTML = Buffer.from('<!doctype html><script>alert(1)</script>');

describe('sniffAttachmentType', () => {
  it.each([
    ['JPEG', JPEG, 'image/jpeg'],
    ['PNG', PNG, 'image/png'],
    ['WebP', WEBP, 'image/webp'],
    ['PDF', PDF, 'application/pdf'],
  ])('accepts %s by its magic bytes', (_name, bytes, mime) => {
    expect(sniffAttachmentType(bytes)).toBe(mime);
  });

  it('stores a PDF declared as an image as a PDF', () => {
    expect(sniffAttachmentType(PDF)).toBe('application/pdf');
  });

  it('refuses an HTML file whatever it was declared as', () => {
    expect(sniffAttachmentType(HTML)).toBeNull();
    expect(sniffAttachmentType(Buffer.alloc(0))).toBeNull();
    expect(sniffAttachmentType(Buffer.from('RIFF\0\0\0\0WAVE'))).toBeNull();
  });
});
