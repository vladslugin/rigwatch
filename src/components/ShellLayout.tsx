import type { ReactNode } from 'react';

import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { ShellSidebar } from '@/components/ShellSidebar';

interface ShellLayoutProps {
  children: ReactNode;
  onOpenDocs?: () => void;
  onOpenSettings?: () => void;
}

export function ShellLayout({
  children,
  onOpenDocs,
  onOpenSettings,
}: ShellLayoutProps) {
  return (
    <SidebarProvider defaultOpen={true}>
      <ShellSidebar
        onOpenDocs={onOpenDocs}
        onOpenSettings={onOpenSettings}
      />
      <SidebarInset className="bg-background">
        <header className="sticky top-0 z-10 flex h-12 items-center gap-2 border-b border-border/60 bg-background/80 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <SidebarTrigger />
          <span className="text-xs font-medium text-muted-foreground">
            Standard-Modus
          </span>
        </header>
        <div className="flex-1 min-h-0">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}

export default ShellLayout;
