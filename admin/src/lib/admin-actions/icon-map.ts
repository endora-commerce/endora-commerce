import {
  BookOpen,
  Boxes,
  ClipboardList,
  CloudUpload,
  Download,
  FilePlus,
  FileDown,
  FileText,
  FileUp,
  FolderPlus,
  Image as ImageIcon,
  Inbox,
  Layers,
  LayoutDashboard,
  ListChecks,
  Menu,
  Package,
  PanelLeft,
  Plus,
  PlusCircle,
  PlusSquare,
  Receipt,
  Search,
  Settings,
  ShoppingCart,
  Sparkles,
  Tag,
  Upload,
  UserPlus,
  Users,
  Video,
  type LucideIcon,
} from 'lucide-react';
import type { KnownIconName } from '@b2b/contracts';

/**
 * Map from the closed allowlist of icon names declared in
 * `packages/contracts/src/admin-actions.ts` to their lucide-react
 * components. Adding a new entry here requires the matching name to be
 * added to `KnownIconNameSchema` in the same PR.
 *
 * If a string somehow reaches the admin that isn't in the allowlist
 * (e.g., backend and admin bundles drifted across deploys), we render
 * the `Sparkles` fallback rather than dropping the action — the action
 * remains usable, only the icon is generic.
 */
const ICON_MAP: Record<KnownIconName, LucideIcon> = {
  Plus,
  Sparkles,
  Settings,
  Search,
  Boxes,
  Layers,
  Menu,
  PlusCircle,
  PlusSquare,
  FilePlus,
  FolderPlus,
  Upload,
  FileUp,
  CloudUpload,
  Download,
  FileDown,
  FileText,
  BookOpen,
  Package,
  Tag,
  ShoppingCart,
  Receipt,
  Users,
  UserPlus,
  Inbox,
  ListChecks,
  ClipboardList,
  Image: ImageIcon,
  Video,
  LayoutDashboard,
  PanelLeft,
};

export function resolveIcon(name: string): LucideIcon {
  const known = ICON_MAP[name as KnownIconName];
  if (known) return known;
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.warn(`[admin-actions] unknown icon "${name}" — rendering fallback Sparkles.`);
  }
  return Sparkles;
}
