import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDateWithUserTimezone } from '../utils/timezone';
import { useTimezoneRefresh } from '../hooks/useTimezoneRefresh';
import type { Notification } from '../types';
import { useGlobalAlarms } from '../hooks/useGlobalAlarms';
import { collection, getDocs, deleteDoc } from 'firebase/firestore';
import { firestoreDB } from '../lib/firebase';
import { useAuth } from '../hooks/useAuth';
import { useEscapeKey } from '../hooks/useEscapeKey';

interface NotificationHistoryProps {
  isOpen: boolean;
  onClose: () => void;
  onAlarmClick?: (deviceId: string, parameterName: string) => void;
}

interface HistoryNotification extends Notification {
  dismissed?: boolean;
}

const NotificationHistory: React.FC<NotificationHistoryProps> = ({ isOpen, onClose, onAlarmClick }) => {
  const { t, i18n } = useTranslation();
  const [history, setHistory] = useState<HistoryNotification[]>([]);
  const [filter, setFilter] = useState<'all' | 'alarms' | 'today' | 'global'>('all');
  const [deviceSearch, setDeviceSearch] = useState('');
  const [collapsedDevices, setCollapsedDevices] = useState<Record<string, boolean>>({});
  const { globalAlarms } = useGlobalAlarms();
  const { user } = useAuth();
  const [isPurging, setIsPurging] = useState(false);
  const timezoneRefreshKey = useTimezoneRefresh();

  // Handle Escape key to close modal
  useEscapeKey(onClose, { enabled: isOpen });

  // Load history from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem('hase-notification-history');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setHistory(parsed);
      } catch (error) {
        console.warn('[NotificationHistory] Failed to parse stored history:', error);
      }
    }
  }, []);

  // Save history to localStorage when it changes
  useEffect(() => {
    if (history.length > 0) {
      // Keep only last 100 notifications to prevent localStorage bloat
      const trimmed = history.slice(-100);
      localStorage.setItem('hase-notification-history', JSON.stringify(trimmed));
    }
  }, [history]);

  // Listen for new notifications and add them to history
  useEffect(() => {
    const handleNewNotification = (event: CustomEvent<Notification>) => {
      const notification = event.detail;
      setHistory(prev => [...prev, { ...notification, dismissed: false }]);
    };

    window.addEventListener('notification-added', handleNewNotification as EventListener);
    return () => {
      window.removeEventListener('notification-added', handleNewNotification as EventListener);
    };
  }, []);

  // Combine and filter notifications based on selected filter
  const filteredHistory = useMemo(() => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

    // Convert global alarms to notification format for unified display
    const globalNotifications: HistoryNotification[] = globalAlarms.map(alarm => ({
      id: alarm.id || `global-${Date.now()}`,
      message: alarm.message,
      type: alarm.resolved ? 'success' : 'warning',
      timestamp: alarm.timestamp.toMillis(),
      isAlarm: true,
      deviceId: alarm.deviceId,
      parameterName: alarm.parameterName,
      autoClose: true,
      dismissed: alarm.resolved
    }));

    // Combine local and global notifications
    const allNotifications = filter === 'global' ? globalNotifications : [...history, ...globalNotifications];

    // Apply filters
    let filtered = allNotifications.filter(notification => {
      // Device search filter
      if (deviceSearch.trim() !== '') {
        const searchLower = deviceSearch.toLowerCase();
        const deviceMatches = notification.deviceId?.toLowerCase().includes(searchLower);
        const paramMatches = notification.parameterName?.toLowerCase().includes(searchLower);
        if (!deviceMatches && !paramMatches) return false;
      }

      // Type filter
      switch (filter) {
        case 'alarms':
          return notification.isAlarm;
        case 'today':
          return notification.timestamp >= todayStart;
        case 'global':
          return true; // Already filtered above
        case 'all':
        default:
          return true;
      }
    });

    return filtered.sort((a, b) => b.timestamp - a.timestamp); // Most recent first
  }, [history, globalAlarms, filter, deviceSearch]);

  // Group notifications by device ID
  const groupedByDevice = useMemo(() => {
    const groups: Record<string, HistoryNotification[]> = {};

    filteredHistory.forEach(notification => {
      const deviceId = notification.deviceId || 'unknown';
      if (!groups[deviceId]) {
        groups[deviceId] = [];
      }
      groups[deviceId].push(notification);
    });

    return Object.entries(groups)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([deviceId, notifications]) => ({
        deviceId,
        notifications: notifications.sort((a, b) => b.timestamp - a.timestamp),
        count: notifications.length,
        alarmCount: notifications.filter(n => n.isAlarm && !n.dismissed).length
      }));
  }, [filteredHistory]);

  const clearHistory = () => {
    setHistory([]);
    localStorage.removeItem('hase-notification-history');
  };

  const clearTodayHistory = () => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const filtered = history.filter(n => n.timestamp < todayStart);
    setHistory(filtered);
  };

  const formatTimestamp = useCallback((timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();

    if (isToday) {
      return formatDateWithUserTimezone(date, i18n.language, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    } else {
      return formatDateWithUserTimezone(date, i18n.language, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    }
  }, [i18n.language, timezoneRefreshKey]);

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'success':
        return '✅';
      case 'error':
        return '❌';
      case 'warning':
        return '⚠️';
      case 'info':
      default:
        return 'ℹ️';
    }
  };

  // Get notification styling based on type and alarm status
  const getNotificationStyles = (notification: HistoryNotification) => {
    if (notification.isAlarm) {
      switch (notification.type) {
        case 'success':
          return 'border-success/30 bg-success/10';
        case 'warning':
        case 'error':
        default:
          return 'border-destructive/30 bg-destructive/10';
      }
    } else {
      switch (notification.type) {
        case 'success':
          return 'border-success/30 bg-success/10';
        case 'error':
          return 'border-destructive/30 bg-destructive/10';
        case 'warning':
          return 'border-warning/30 bg-warning/10';
        case 'info':
        default:
          return 'border-border bg-background';
      }
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'success':
        return 'text-success';
      case 'error':
        return 'text-destructive';
      case 'warning':
        return 'text-warning';
      case 'info':
      default:
        return 'text-info';
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/45 backdrop-blur-md p-4 flex items-center justify-center z-50">
      <div className="bg-card text-foreground rounded-lg shadow-theme-lg w-full max-w-4xl max-h-[90vh] flex flex-col transition-colors border border-border">
        {/* Header */}
        <div className="px-6 py-4 border-b border-border bg-section-header text-section-header-foreground flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-section-header-foreground">
              {t('notifications.history', 'Notification History')}
            </h2>
            <p className="text-sm text-section-header-foreground/80 mt-1">
              {filteredHistory.length} {t('notifications.items', 'items')}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-section-header-foreground/80 hover:text-destructive transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Search and Filter Controls */}
        <div className="px-6 py-4 border-b border-border">
          {/* Search Bar */}
          <div className="mb-4">
            <div className="relative">
              <input
                type="text"
                placeholder="Search devices or parameters..."
                value={deviceSearch}
                onChange={(e) => setDeviceSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary bg-card text-foreground placeholder-muted-foreground"
              />
              <svg
                className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              {deviceSearch && (
                <button
                  onClick={() => setDeviceSearch('')}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex space-x-2">
            <button
              onClick={() => setFilter('all')}
              className={`px-3 py-1 text-sm rounded transition-colors ${
                filter === 'all'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:brightness-95'
              }`}
            >
              {t('notifications.filterAll', 'All')} ({history.length})
            </button>
            <button
              onClick={() => setFilter('alarms')}
              className={`px-3 py-1 text-sm rounded transition-colors ${
                filter === 'alarms'
                  ? 'bg-destructive text-destructive-foreground'
                  : 'bg-muted text-muted-foreground hover:brightness-95'
              }`}
            >
              Alarms ({history.filter(n => n.isAlarm).length})
            </button>
            <button
              onClick={() => setFilter('today')}
              className={`px-3 py-1 text-sm rounded transition-colors ${
                filter === 'today'
                  ? 'bg-success text-success-foreground'
                  : 'bg-muted text-muted-foreground hover:brightness-95'
              }`}
            >
              Today
            </button>
            <button
              onClick={() => setFilter('global')}
              className={`px-3 py-1 text-sm rounded transition-colors ${
                filter === 'global'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:brightness-95'
              }`}
            >
              Global ({globalAlarms.length})
            </button>
          </div>

          <div className="flex space-x-2">
            <button
              onClick={clearTodayHistory}
              className="px-3 py-1 text-sm text-warning hover:brightness-90 transition-colors"
            >
              {t('notifications.clearToday', 'Clear Today')}
            </button>
            <button
              onClick={clearHistory}
              className="px-3 py-1 text-sm text-destructive hover:brightness-90 transition-colors"
            >
              {t('notifications.clearAll', 'Clear All')}
            </button>
            <button
              onClick={async () => {
                if (!window.confirm('Delete ALL global alarms from Firestore?')) return;
                try {
                  setIsPurging(true);
                  // Restrict purge to privileged roles
                  const isPrivileged = (user as any)?.role === 'developer' || (user as any)?.role === 'super_admin';
                  if (!isPrivileged) {
                    alert('Not authorized');
                    return;
                  }
                  if (!firestoreDB) throw new Error('firestore_not_initialized');
                  const snap = await getDocs(collection(firestoreDB, 'alarms'));
                  const deletions: Promise<any>[] = [];
                  snap.forEach(d => deletions.push(deleteDoc(d.ref)));
                  await Promise.allSettled(deletions);
                } catch (e) {
                  console.error('Failed to purge alarms', e);
                  alert('Failed to purge alarms');
                } finally {
                  setIsPurging(false);
                }
              }}
              disabled={isPurging}
              className="px-3 py-1 text-sm text-destructive hover:brightness-90 transition-colors border border-destructive/30 rounded"
            >
              {isPurging ? 'Purging…' : 'Purge Global'}
            </button>
          </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {groupedByDevice.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-16 h-16 mx-auto mb-4 bg-muted rounded-full flex items-center justify-center">
                <svg className="w-8 h-8 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <p className="text-muted-foreground">
                {deviceSearch ? 'No notifications match your search' : 'No notifications found'}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {groupedByDevice.map((group) => (
                <div key={group.deviceId} className="border border-border rounded-lg overflow-hidden">
                  {/* Device Header */}
                  <button
                    onClick={() => setCollapsedDevices(prev => ({
                      ...prev,
                      [group.deviceId]: !prev[group.deviceId]
                    }))}
                    className="w-full px-4 py-3 bg-background hover:bg-muted flex items-center justify-between text-left transition-colors"
                  >
                    <div className="flex items-center space-x-3">
                      <div className="flex items-center">
                        <svg
                          className={`w-4 h-4 transition-transform ${
                            collapsedDevices[group.deviceId] ? 'transform rotate-180' : ''
                          }`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                      <div>
                        <div className="font-medium text-foreground">
                          Device: {group.deviceId}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {group.count} notifications
                          {group.alarmCount > 0 && (
                            <span className="ml-2 px-2 py-0.5 bg-destructive/15 text-destructive text-xs rounded">
                              {group.alarmCount} active alarms
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>

                  {/* Device Notifications */}
                  {!collapsedDevices[group.deviceId] && (
                    <div className="divide-y divide-border">
                      {group.notifications.map((notification) => (
                <div
                  key={notification.id}
                  className={`
                    p-4 rounded-lg border transition-colors
                    ${getNotificationStyles(notification)}
                    hover:shadow-md
                    ${notification.isAlarm && notification.deviceId && notification.parameterName ? 'cursor-pointer hover:opacity-80' : ''}
                  `}
                  onClick={() => {
                    if (notification.isAlarm && notification.deviceId && notification.parameterName && onAlarmClick) {
                      onAlarmClick(notification.deviceId, notification.parameterName);
                    }
                  }}
                >
                  <div className="flex items-start space-x-3">
                    <div className={`flex-shrink-0 text-lg ${notification.isAlarm && notification.type === 'success' ? 'text-success' : ''}`}>
                      {notification.isAlarm ? (notification.type === 'success' ? '✅' : '🚨') : getTypeIcon(notification.type)}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className={`text-xs font-medium uppercase tracking-wide ${notification.isAlarm && notification.type === 'success' ? 'text-success' : getTypeColor(notification.type)}`}>
                          {notification.type}
                          {notification.isAlarm && ' • ALARM'}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {formatTimestamp(notification.timestamp)}
                        </span>
                      </div>

                      <p className="text-sm text-foreground mb-1">
                        {notification.message}
                      </p>

                      {notification.deviceId && notification.parameterName && (
                        <div className="text-xs text-muted-foreground">
                          Device: {notification.deviceId} • Parameter: {notification.parameterName}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border flex justify-between items-center">
          <p className="text-xs text-muted-foreground">
            {t('notifications.historyNote', 'History is stored locally and persists between sessions')}
          </p>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-muted hover:brightness-95 text-muted-foreground rounded-md transition-colors"
          >
            {t('notifications.close', 'Close')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default NotificationHistory;
