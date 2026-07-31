/** Compact SVG data-URI icons for email Social links (no external CDN). */

import type { EmailSocialNetwork } from '../schema/component-types.js';

export const EMAIL_SOCIAL_BRAND_COLORS: Record<EmailSocialNetwork, string> = {
  facebook: '#1877F2',
  instagram: '#E4405F',
  linkedin: '#0A66C2',
  x: '#0f172a',
  youtube: '#FF0000',
  tiktok: '#000000',
  other: '#475569',
};

export const EMAIL_SOCIAL_LABELS: Record<EmailSocialNetwork, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  linkedin: 'LinkedIn',
  x: 'X',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  other: 'Link',
};

/** Simple letter-mark icons — reliable in Outlook / Gmail without external assets. */
function letterSvg(letter: string, fill: string): string {
  const safe = letter.slice(0, 2).toUpperCase();
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">` +
    `<circle cx="24" cy="24" r="24" fill="${fill}"/>` +
    `<text x="24" y="30" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" ` +
    `font-size="20" font-weight="700" fill="#ffffff">${safe}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const LETTER: Record<EmailSocialNetwork, string> = {
  facebook: 'f',
  instagram: 'ig',
  linkedin: 'in',
  x: 'X',
  youtube: 'yt',
  tiktok: 'tt',
  other: '·',
};

export function socialIconDataUri(network: EmailSocialNetwork, color: string): string {
  return letterSvg(LETTER[network] || '·', color);
}
