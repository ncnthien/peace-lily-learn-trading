'use client';

import { usePathname } from 'next/navigation';
import {
  ChartCandlestick,
  ChartLine,
  ScrollText,
  Bot,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { NavItem } from '@/widgets/nav-item';

interface NavEntry {
  href: string;
  label: string;
  icon: LucideIcon;
}

const NAV_ITEMS: ReadonlyArray<NavEntry> = [
  { href: '/',           label: 'Overview',   icon: ChartCandlestick },
  { href: '/dashboard',  label: 'Dashboard',  icon: ChartLine },
  { href: '/trades',     label: 'Trades',     icon: ScrollText },
  { href: '/automation', label: 'Automation', icon: Bot },
  { href: '/accounts',   label: 'Accounts',   icon: Wallet },
];

function isItemActive(pathname: string | null, href: string): boolean {
  if (pathname === null) return false;
  // Overview only matches the root exactly — `/dashboard` etc. must not
  // accidentally highlight "Overview".
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Primary left-rail navigation. Active state is derived from the current
 * pathname (single source of truth — no per-page link buttons anymore).
 */
export function AppSidebar() {
  const pathname = usePathname();
  return (
    <aside
      aria-label="Primary navigation"
      className="hidden w-56 shrink-0 border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex md:flex-col"
    >
      <nav className="flex-1 space-y-1 px-3 py-4">
        {NAV_ITEMS.map((item) => (
          <NavItem
            key={item.href}
            href={item.href}
            label={item.label}
            icon={item.icon}
            isActive={isItemActive(pathname, item.href)}
          />
        ))}
      </nav>
    </aside>
  );
}
