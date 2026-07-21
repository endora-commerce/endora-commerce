'use client';

import type { IconType } from 'react-icons';
import {
  FaEnvelope,
  FaFacebook,
  FaGlobe,
  FaInstagram,
  FaLinkedin,
  FaTiktok,
  FaXTwitter,
  FaYoutube,
} from 'react-icons/fa6';
import type { SocialNetwork } from '../schema/component-types.js';

export const SOCIAL_NETWORK_LABELS: Record<SocialNetwork, string> = {
  facebook: 'Facebook',
  x: 'X',
  instagram: 'Instagram',
  linkedin: 'LinkedIn',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  website: 'Website',
  email: 'Email',
};

export const SOCIAL_NETWORK_ICONS: Record<SocialNetwork, IconType> = {
  facebook: FaFacebook,
  x: FaXTwitter,
  instagram: FaInstagram,
  linkedin: FaLinkedin,
  youtube: FaYoutube,
  tiktok: FaTiktok,
  website: FaGlobe,
  email: FaEnvelope,
};

export const SOCIAL_BRAND_COLORS: Record<SocialNetwork, string> = {
  facebook: '#1877F2',
  x: '#0f172a',
  instagram: '#E4405F',
  linkedin: '#0A66C2',
  youtube: '#FF0000',
  tiktok: '#000000',
  website: '#334155',
  email: '#475569',
};

export function socialItemSummary(
  item: { network?: SocialNetwork; label?: string },
  index?: number,
): string {
  const network = item.network && item.network in SOCIAL_NETWORK_LABELS ? item.network : 'website';
  const networkLabel = SOCIAL_NETWORK_LABELS[network];
  const custom = item.label?.trim();
  if (custom) return `${networkLabel} — ${custom}`;
  if (typeof index === 'number') return `${networkLabel} (#${index + 1})`;
  return networkLabel;
}
