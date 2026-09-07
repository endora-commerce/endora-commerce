import {
  Activity,
  Archive,
  Bell,
  BookOpen,
  Box,
  Boxes,
  Building2,
  CircleDollarSign,
  ClipboardCheck,
  ClipboardList,
  CloudUpload,
  CreditCard,
  Download,
  Edit,
  Eraser,
  FilePlus,
  FileDown,
  FileText,
  FileUp,
  FolderPlus,
  Image as ImageIcon,
  Inbox,
  KeyRound,
  Languages,
  Layers,
  LayoutDashboard,
  LineChart,
  ListChecks,
  Menu,
  Newspaper,
  Package,
  PackageOpen,
  PanelLeft,
  PercentDiamond,
  PlugZap,
  Plus,
  PlusCircle,
  PlusSquare,
  Receipt,
  Rss,
  Scale,
  Search,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Smartphone,
  Sparkles,
  Store,
  Tag,
  TrendingDown,
  Truck,
  Upload,
  UserPlus,
  Users,
  Video,
  Warehouse,
  Webhook,
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
  PlugZap,
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
  // Feature 091 (Phase 4, batch two) — `analytics` declares its sidebar icon by
  // name now, and this is the map that turns the name back into the same glyph
  // `AppShell.tsx` used to import directly.
  LineChart,
  // Feature 091 (Phase 4, batch four) — the same, for `admin_roles`' sidebar
  // entry and palette action.
  ShieldCheck,
  // Feature 091 (Phase 4, batch six) — the same, for `pwa`' sidebar entry.
  Smartphone,
  // Feature 091 (Phase 4, the plan's batch 6) — the same, for `webhooks`' and
  // `comparisons`' sidebar entries and palette actions. `api_keys` needed no
  // entry: `KeyRound` is already above.
  Webhook,
  Scale,
  // Feature 091 (Phase 4, the plan's batch 7) — the same, for `promotions`' two
  // sidebar entries and two palette rows. The other three members of that batch
  // needed no entry: `CreditCard`, `Users` and `Rss` are already above.
  PercentDiamond,
  // Feature 091 (Phase 4, batch 8) — the same, for `megamenu`'s sidebar entry.
  // The batch's other five needed no entry: `Search`, `Receipt`, `Truck`,
  // `CreditCard` and `Package` are already above.
  Newspaper,
  // Feature 091 (Phase 4, batch 10) — the same, for `dictionaries`' two sidebar
  // entries and two palette actions and for `settings`' cache row. The batch's
  // other rows needed no entry: `ListChecks`, `Settings` and `KeyRound` are
  // already above.
  Languages,
  Eraser,
  // Feature 091 (Phase 4, batch 13) — the same, for four of `inventory`'s five
  // sidebar entries. The batch's other rows needed no entry: `Box`,
  // `CircleDollarSign` and `PlugZap` are already above.
  Warehouse,
  TrendingDown,
  Bell,
  PackageOpen,
  // Feature 091 (Phase 4, batch 14) — the same, for `organizations`' and
  // `sales_channels`' sidebar entries and the two palette actions that replace
  // their hand-written *Navigate* rows. `customers`' two rows needed no entry:
  // `Users` is already above.
  Building2,
  Store,
  // Feature 091 (Phase 4, batch 15) — the same, for `orders`' three sidebar
  // entries. The batch's other seven rows needed no entry: `Package`, `Boxes`,
  // `Tag`, `FileText` and `ListChecks` are already above.
  ClipboardCheck,
};

export function resolveIcon(name: string): LucideIcon {
  const known = ICON_MAP[name as KnownIconName];
  if (known) return known;
  if (import.meta.env.DEV) {
    console.warn(`[admin-actions] unknown icon "${name}" — rendering fallback Sparkles.`);
  }
  return Sparkles;
}
