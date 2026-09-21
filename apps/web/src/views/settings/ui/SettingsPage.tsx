'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';

/**
 * Settings route (placeholder). The route exists so the avatar-menu's
 * Settings link and a future sidebar entry don't 404; surface real settings
 * here as they land (e.g. chart S/R toggle, runner cadence). Today it just
 * explains the page is intentional.
 */
export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          App-wide preferences. Content will be added here as settings move
          out of inline controls.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Coming soon</CardTitle>
          <CardDescription>
            No settings yet. Future entries will appear here.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          The Settings page is reachable from the avatar menu in the header.
          Once there is something to configure it will surface in cards like
          this one.
        </CardContent>
      </Card>
    </div>
  );
}
