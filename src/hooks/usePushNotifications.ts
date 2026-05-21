import { firestoreDB } from '../lib/firebase';
import { collection, addDoc, doc, setDoc, getDocs, query, where, deleteDoc } from 'firebase/firestore';

// Web Push helpers (client-side subscription management stored in Firestore)

export const isBrowserPushSupported = async (): Promise<boolean> => {
  return ('Notification' in window) && ('serviceWorker' in navigator) && ('PushManager' in window);
};

export const getPermissionStatus = (): NotificationPermission => {
  return typeof Notification !== 'undefined' ? Notification.permission : 'default';
};

export const requestPermission = async (): Promise<NotificationPermission> => {
  if (!('Notification' in window)) return 'denied';
  try {
    const result = await Notification.requestPermission();
    return result;
  } catch {
    return 'denied';
  }
};

/**
 * Register service worker (idempotent).
 */
export const registerMessagingServiceWorker = async (): Promise<ServiceWorkerRegistration | null> => {
  try {
    if (!('serviceWorker' in navigator)) return null;
    const existing = await navigator.serviceWorker.getRegistration('/sw.js');
    if (existing) return existing;
    return await navigator.serviceWorker.register('/sw.js');
  } catch (error) {
    console.error('[Push] Failed to register service worker', error);
    return null;
  }
};

/**
 * Subscribe current browser to push (FCM) and store token in Firestore
 */
export const subscribeUserToPush = async (
  userId: string,
  language: string
): Promise<string | null> => {
  try {
    const supported = await isBrowserPushSupported();
    if (!supported) {
      console.warn('[Push] Browser push is not supported');
      return null;
    }

    const perm = getPermissionStatus();
    if (perm !== 'granted') {
      const res = await requestPermission();
      if (res !== 'granted') {
        console.warn('[Push] Permission not granted');
        return null;
      }
    }

    const reg = await registerMessagingServiceWorker();
    if (!reg) return null;

    const existing = await reg.pushManager.getSubscription();
    if (existing) {
      try {
        await sendSubscribeToServer(userId, language, existing);
        return existing.endpoint;
      } catch (e) {
        console.warn('[Push] Existing subscription failed to save, will re-subscribe');
      }
    }

    const publicKey = (import.meta.env.VITE_VAPID_PUBLIC_KEY || '').toString();
    if (!publicKey) {
      console.warn('[Push] Missing VITE_VAPID_PUBLIC_KEY');
      return null;
    }

    const urlBase64ToUint8Array = (base64String: string) => {
      const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
      const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
      const rawData = window.atob(base64);
      const outputArray = new Uint8Array(rawData.length);
      for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
      return outputArray;
    };

    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey)
    });

    await sendSubscribeToServer(userId, language, sub);
    console.log('[Push] Subscribed with endpoint:', sub.endpoint);
    return sub.endpoint;
  } catch (error) {
    console.error('[Push] Subscription failed:', error);
    return null;
  }
};

/**
 * Remove all tokens for current user (browser logout or disable)
 */
export const unsubscribeUserFromPush = async (userId: string): Promise<void> => {
  try {
    const reg = await navigator.serviceWorker.getRegistration('/sw.js');
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await sendUnsubscribeToServer(userId, sub.endpoint);
      await sub.unsubscribe();
    }
  } catch (error) {
    console.error('[Push] Unsubscribe failed:', error);
  }
};

async function sendSubscribeToServer(userId: string, language: string, subscription: PushSubscription) {
  if (!firestoreDB) throw new Error('firestore_not_initialized');
  const subsCol = collection(firestoreDB, 'users', userId, 'webpush_subscriptions');
  const json = (subscription as any).toJSON ? (subscription as any).toJSON() : JSON.parse(JSON.stringify(subscription));
  const endpoint: string = subscription.endpoint;
  await addDoc(subsCol, {
    created_at: Date.now(),
    language: language === 'de' ? 'de' : 'en',
    subscription: json,
    endpoint
  });
  await setDoc(doc(firestoreDB, 'users', userId), { notifications_enabled: true }, { merge: true });
}

async function sendUnsubscribeToServer(userId: string, endpoint: string) {
  if (!firestoreDB) throw new Error('firestore_not_initialized');
  const subsCol = collection(firestoreDB, 'users', userId, 'webpush_subscriptions');
  const q = query(subsCol, where('endpoint', '==', endpoint));
  const snap = await getDocs(q);
  const deletions: Promise<void>[] = [];
  snap.forEach(d => deletions.push(deleteDoc(d.ref)));
  await Promise.allSettled(deletions);
}
