/* eslint-disable no-restricted-globals */

// Store current version info
let currentVersion = null;

self.addEventListener('install', (event) => {
  // @ts-ignore
  self.skipWaiting?.();
});

self.addEventListener('activate', (event) => {
  // @ts-ignore
  self.clients?.claim?.();

  // Check for updates after activation
  event.waitUntil(checkForUpdates());
});

self.addEventListener('push', (event) => {
  try {
    const data = event.data ? event.data.json() : {};
    const title = data.title || 'Hasenradar';
    const options: NotificationOptions = {
      body: data.body || '',
      icon: '/vite.svg',
      badge: '/vite.svg',
      data: data.data || {},
      tag: data.tag || undefined,
      renotify: !!data.renotify,
    } as any;
    event.waitUntil(self.registration.showNotification(title, options));
  } catch (e) {
    // ignore
  }
});

self.addEventListener('notificationclick', (event: any) => {
  event.notification.close();

  // Handle update notification actions
  if (event.notification?.data?.type === 'app_update') {
    if (event.action === 'update') {
      // Force reload all open windows
      event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList: any[]) => {
          for (const client of clientList) {
            if ('navigate' in client) {
              client.navigate(client.url);
            }
          }
          return undefined;
        })
      );
    }
    // If dismissed, do nothing
    return;
  }

  const url = event.notification?.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList: any[]) => {
      for (const client of clientList) {
        if (client.url === url && 'focus' in client) return client.focus();
      }
      if ((self.clients as any).openWindow) return (self.clients as any).openWindow(url);
      return undefined;
    })
  );
});

// Function to check for application updates
async function checkForUpdates() {
  try {
    const response = await fetch('/version.json', {
      cache: 'no-cache',
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    });

    if (!response.ok) {
      console.warn('[SW] Failed to fetch version info');
      return;
    }

    const versionData = await response.json();
    const newVersion = versionData.buildTime;

    // If this is the first check, store current version
    if (currentVersion === null) {
      currentVersion = newVersion;
      return;
    }

    // If version changed, show update notification
    if (newVersion > currentVersion) {
      console.log('[SW] New version detected, showing update notification');

      // Wait a bit before showing notification to avoid showing it immediately on page load
      setTimeout(() => {
        showUpdateNotification(versionData);
      }, 3000);

      currentVersion = newVersion;
    }
  } catch (error) {
    console.error('[SW] Update check failed:', error);
  }
}

// Function to show update notification
function showUpdateNotification(versionData) {
  const title = 'Neues Update verfügbar';
  const options = {
    body: 'Eine neue Version der App ist verfügbar. Aktualisieren Sie die Seite für die neuesten Features.',
    icon: '/vite.svg',
    badge: '/vite.svg',
    tag: 'app_update',
    requireInteraction: true,
    data: {
      type: 'app_update',
      version: versionData.version,
      buildTime: versionData.buildTime
    },
    actions: [
      {
        action: 'update',
        title: 'Aktualisieren'
      },
      {
        action: 'dismiss',
        title: 'Später'
      }
    ]
  };

  // @ts-ignore
  self.registration.showNotification(title, options);
}

// Periodic update check (every 5 minutes)
setInterval(checkForUpdates, 5 * 60 * 1000);


