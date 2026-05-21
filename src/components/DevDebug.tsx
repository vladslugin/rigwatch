import React, { useState } from 'react';
import { Settings2 } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

const DevDebug: React.FC = () => {
  const { user, isAuthenticated, hasPermission } = useAuth();
  const [isOpen, setIsOpen] = useState(true);

  // Only show in development mode
  if (!import.meta.env.DEV) return null;

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="fixed bottom-3 right-3 w-10 h-10 rounded-full bg-card border border-border shadow-lg text-foreground hover:bg-muted flex items-center justify-center z-50"
        aria-label="Open dev debug"
      >
        <Settings2 className="w-4 h-4" />
      </button>
    );
  }

  const StatusDot: React.FC<{ ok: boolean }> = ({ ok }) => (
    <span
      className={`inline-block w-2 h-2 rounded-full mr-1 align-middle ${ok ? 'bg-success' : 'bg-destructive'}`}
    />
  );

  return (
    <div className="fixed bottom-3 right-3 w-80 max-w-[calc(100vw-1.5rem)] bg-card/95 backdrop-blur-md border border-border rounded-xl shadow-2xl text-foreground text-xs font-mono z-50 overflow-hidden">
      <div className="flex items-center justify-between px-3.5 py-2 border-b border-border bg-muted/50">
        <span className="font-semibold text-foreground">🔧 Dev Debug</span>
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground"
          onClick={() => setIsOpen(false)}
          aria-label="Close dev debug"
        >
          ✕
        </button>
      </div>

      <div className="px-3.5 py-3 space-y-1.5">
        <div>
          <span className="text-muted-foreground">Authenticated:</span>{' '}
          <StatusDot ok={isAuthenticated} />
          <span className="text-foreground">{isAuthenticated ? 'yes' : 'no'}</span>
        </div>
        <div>
          <span className="text-muted-foreground">User Role:</span>{' '}
          <span className="text-foreground">{user?.role || 'none'}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Display Name:</span>{' '}
          <span className="text-foreground">{user?.displayName || 'none'}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Email:</span>{' '}
          <span className="text-foreground">{user?.email || 'none'}</span>
        </div>

        <div className="border-t border-border pt-2 mt-2 space-y-1.5">
          <div className="text-muted-foreground">Permissions:</div>
          <div>
            • <span className="text-muted-foreground">manage_users:</span>{' '}
            <StatusDot ok={hasPermission('manage_users')} />
            <span className={hasPermission('manage_users') ? 'text-success' : 'text-destructive'}>
              {hasPermission('manage_users') ? '✓' : '✗'}
            </span>
          </div>
          <div>
            • <span className="text-muted-foreground">manage_devices:</span>{' '}
            <StatusDot ok={hasPermission('manage_devices')} />
            <span className={hasPermission('manage_devices') ? 'text-success' : 'text-destructive'}>
              {hasPermission('manage_devices') ? '✓' : '✗'}
            </span>
          </div>
          <div>
            • <span className="text-muted-foreground">manage_rigs:</span>{' '}
            <StatusDot ok={hasPermission('manage_rigs')} />
            <span className={hasPermission('manage_rigs') ? 'text-success' : 'text-destructive'}>
              {hasPermission('manage_rigs') ? '✓' : '✗'}
            </span>
          </div>
          <div>
            • <span className="text-muted-foreground">developer:</span>{' '}
            <StatusDot ok={hasPermission('developer')} />
            <span className={hasPermission('developer') ? 'text-success' : 'text-destructive'}>
              {hasPermission('developer') ? '✓' : '✗'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DevDebug;
