'use client';

import Link from 'next/link';
import type { ComponentType } from 'react';
import { cn } from '@/shared/lib/utils';

export interface NavItemProps {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  isActive: boolean;
}

/**
 * Single sidebar entry — link + icon + label + active-state classes.
 * Keeps `app-sidebar` short. `isActive` is computed by the parent from the
 * current pathname so the rule lives in one place.
 */
export function NavItem({ href, label, icon: Icon, isActive }: NavItemProps) {
  return (
    <Link
      href={href}
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'flex h-8 items-center gap-2 rounded-md px-2.5 text-sm font-medium transition-colors',
        isActive
          ? 'bg-sidebar-accent text-sidebar-accent-foreground'
          : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
      )}
    >
      <Icon className="size-4" />
      <span>{label}</span>
    </Link>
  );
}
