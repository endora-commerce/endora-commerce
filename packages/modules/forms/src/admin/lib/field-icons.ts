import {
  AlignLeft,
  CalendarClock,
  CircleDot,
  EyeOff,
  FileText,
  Globe,
  Hash,
  ListChecks,
  Mail,
  MapPin,
  Megaphone,
  Phone,
  ScrollText,
  SeparatorHorizontal,
  ShieldCheck,
  SquareCheck,
  SquareChevronDown,
  Type,
  type LucideIcon,
} from 'lucide-react';
import type { FormFieldType } from '@endora-commerce/contracts';

/**
 * The icon of each field type — in the palette, on the canvas rows and in the inspector's header,
 * always beside the type's name, never instead of it (Picture Superiority, WCAG 1.1.1).
 */
export const FIELD_TYPE_ICONS: Readonly<Record<FormFieldType, LucideIcon>> = {
  text: Type,
  email: Mail,
  phone: Phone,
  number: Hash,
  textarea: AlignLeft,
  select: SquareChevronDown,
  radio: CircleDot,
  checkboxes: ListChecks,
  checkbox: SquareCheck,
  datetime: CalendarClock,
  country: Globe,
  address: MapPin,
  hidden: EyeOff,
  content: FileText,
  section_break: SeparatorHorizontal,
  privacy_consent: ShieldCheck,
  marketing_consent: Megaphone,
  terms: ScrollText,
};
