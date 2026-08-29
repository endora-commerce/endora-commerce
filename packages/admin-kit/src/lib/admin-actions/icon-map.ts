import {
  Activity,
  Archive,
  BookOpen,
  Box,
  Boxes,
  CircleDollarSign,
  ClipboardList,
  CloudUpload,
  CreditCard,
  Download,
  Edit,
  FilePlus,
  FileDown,
  FileText,
  FileUp,
  FolderPlus,
  Image as ImageIcon,
  Inbox,
  KeyRound,
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
  Rss,
  Search,
  Settings,
  ShoppingCart,
  Sparkles,
  Tag,
  Truck,
  Upload,
  UserPlus,
  Users,
  Video,
  type LucideIcon,
} from 'lucide-react';
import type { KnownIconName } from '@endora-commerce/contracts';

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
  Rss,
  Package,
  Tag,
  ShoppingCart,
  Receipt,
  CreditCard,
  Users,
  UserPlus,
  Inbox,
  ListChecks,
  ClipboardList,
  Image: ImageIcon,
  Video,
  LayoutDashboard,
  PanelLeft,
  KeyRound,
  // Feature 080 (D-163.1) — the dashboard recent-activity renderings. They
  // were lucide imports inside `modules/home/activity-render.ts`, the fourth
  // hand-maintained action table that ruling retired; a module declares its
  // icon by name now, so the name has to be in the platform's allowlist and
  // resolve through this one map.
  Edit,
  Archive,
  Box,
  Truck,
  CircleDollarSign,
  Activity,
};

export function resolveIcon(name: string): LucideIcon {
  const known = ICON_MAP[name as KnownIconName];
  if (known) return known;
  if (import.meta.env.DEV) {
    console.warn(`[admin-actions] unknown icon "${name}" — rendering fallback Sparkles.`);
  }
  return Sparkles;
}
