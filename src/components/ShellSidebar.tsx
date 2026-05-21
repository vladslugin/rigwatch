import {
  BarChart3,
  BookOpen,
  Cpu,
  Flame,
  Layers,
  Settings,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar';

type NavItem = {
  section: string;
  label: string;
  icon: LucideIcon;
};

const NAV_ITEMS: NavItem[] = [
  { section: 'stove-management', label: 'Geräteübersicht', icon: Cpu },
  { section: 'secondary-categories', label: 'Parameter', icon: Layers },
  { section: 'main-and-airflow', label: 'Brennraum', icon: Flame },
  { section: 'charts', label: 'Diagramme', icon: BarChart3 },
];

function scrollToSection(section: string) {
  const target = document.querySelector(`[data-section="${section}"]`);
  target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

interface ShellSidebarProps {
  onOpenDocs?: () => void;
  onOpenSettings?: () => void;
}

export function ShellSidebar({ onOpenDocs, onOpenSettings }: ShellSidebarProps) {
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div
          className={cn(
            'flex items-center gap-2 px-2 py-1.5',
            collapsed && 'justify-center px-0',
          )}
        >
          <img
            src="/logo.svg"
            alt="RigWatch"
            className="h-7 w-7 shrink-0"
          />
          <span
            className={cn(
              'truncate text-sm font-semibold tracking-tight',
              collapsed && 'hidden',
            )}
          >
            RigWatch
          </span>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                return (
                  <SidebarMenuItem key={item.section}>
                    <SidebarMenuButton
                      tooltip={item.label}
                      onClick={() => scrollToSection(item.section)}
                    >
                      <Icon />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Werkzeuge</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  tooltip="Dokumentation"
                  onClick={() => {
                    onOpenDocs?.();
                    // Fallback: dispatch a window event so Web3ConnectionPanel
                    // (which owns the DocsModal state) can open the modal
                    // even when ShellLayout wasn't given an explicit callback.
                    window.dispatchEvent(new CustomEvent('shell-open-docs'));
                  }}
                >
                  <BookOpen />
                  <span>Dokumentation</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  tooltip="Einstellungen"
                  onClick={() => {
                    onOpenSettings?.();
                    window.dispatchEvent(new CustomEvent('shell-open-settings'));
                  }}
                >
                  <Settings />
                  <span>Einstellungen</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <div
          className={cn(
            'flex items-center justify-between px-2 py-1 text-[10px] text-sidebar-foreground/60',
            collapsed && 'hidden',
          )}
        >
          <span>Standard-Modus</span>
          <span className="tabular-nums">v2</span>
        </div>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}

export default ShellSidebar;
