'use client';

import { AppHeader } from './AppHeader';
import { AppSidebar } from './AppSidebar';

/**
 * Persistent layout chrome shared by every page: header on top, sidebar on
 * the left, route content on the right. Routes render their own inner
 * containers (max-w-*, padding) — this shell only provides the surrounding
 * box.
 *
 * `'use client'` because the sidebar reads `usePathname()` for active state
 * and the header's avatar menu owns dropdown open/close state.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <AppHeader />
      <div className="flex flex-1">
        <AppSidebar />
        <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-6">
          {children}
        </main>
      </div>
    </div>
  );
}
