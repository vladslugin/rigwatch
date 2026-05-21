import { useState, useEffect, useCallback, useRef } from 'react';
import { collection, query, orderBy, onSnapshot, limit, type Unsubscribe } from 'firebase/firestore';
import { firestoreDB } from '../lib/firebase';
import { useAuth } from './useAuth';
import { useStoveStore } from '../store/useStoveStore';

interface ChatMessage {
  id: string;
  text: string;
  processedText?: string;
  userId: string;
  userEmail: string;
  userDisplayName: string;
  chatId: string;
  participants?: string[] | null;
  timestamp: any;
  isRead?: boolean;
  isEdited?: boolean;
  editedAt?: any;
}

interface UnreadCount {
  general: number;
  personal: number;
  total: number;
}

// Sound generation functions
const generateBeep = (frequency: number, duration: number, volume: number = 0.3) => {
  if (typeof window === 'undefined') return Promise.resolve();
  
  return new Promise<void>((resolve) => {
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      
      // Resume context if suspended (required for some browsers)
      if (audioContext.state === 'suspended') {
        audioContext.resume().then(() => {
          playBeep();
        });
      } else {
        playBeep();
      }
      
      function playBeep() {
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        oscillator.frequency.value = frequency;
        oscillator.type = 'sine';

        gainNode.gain.setValueAtTime(0, audioContext.currentTime);
        gainNode.gain.linearRampToValueAtTime(volume, audioContext.currentTime + 0.01);
        gainNode.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + duration);

        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + duration);
        
        oscillator.onended = () => resolve();
      }
    } catch (error) {
      console.warn('[Chat] Audio generation error:', error);
      resolve();
    }
  });
};

export const useChatNotifications = (isChatOpen: boolean = false) => {
  const { user, isAuthenticated } = useAuth();
  const addNotification = useStoveStore(state => state.addNotification);
  
  const [unreadCount, setUnreadCount] = useState<UnreadCount>({
    general: 0,
    personal: 0,
    total: 0
  });
  
  const [lastReadTimestamp, setLastReadTimestamp] = useState<number>(Date.now());
  const unsubscribeRef = useRef<Unsubscribe | null>(null);
  const processedMessagesRef = useRef<Set<string>>(new Set()); // Deduplication

  // Play sound
  const playSound = useCallback(async (soundType: 'send' | 'receive' | 'notification') => {
    try {
      switch (soundType) {
        case 'send':
          await generateBeep(800, 0.1, 0.2); // Higher pitch, short beep
          break;
        case 'receive':
          await generateBeep(600, 0.2, 0.3); // Lower pitch, longer beep
          break;
        case 'notification':
          await generateBeep(700, 0.15, 0.25); // Medium pitch
          break;
      }
    } catch (error) {
      console.warn('[Chat] Audio error:', error);
    }
  }, []);

  // Setup single message listener for all chats
  useEffect(() => {
    if (!isAuthenticated || !user || !firestoreDB) return;

    // Clear existing listener
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }

    console.log('[Chat] Setting up unified message listener for user:', user.uid);

    // Listen to ALL chat messages and filter on client side
    const allMessagesQuery = query(
      collection(firestoreDB!, 'chat_messages'),
      orderBy('timestamp', 'desc'),
      limit(100) // Limit to recent messages for performance
    );

    const unsubscribe = onSnapshot(allMessagesQuery, (snapshot) => {
      if (snapshot.empty) {
        console.log('[Chat] No messages found');
        return;
      }

      let generalUnread = 0;
      let personalUnread = 0;
      const currentTime = Date.now();
      const newProcessedMessages = new Set<string>();

      snapshot.docs.forEach(doc => {
        const message = { id: doc.id, ...doc.data() } as ChatMessage;
        const messageTime = message.timestamp?.toMillis() || 0;
        
        // Skip old messages and own messages
        if (messageTime <= lastReadTimestamp || message.userId === user.uid) {
          return;
        }

        // Determine message type and count
        const isGeneralChat = message.chatId === 'general' || !message.chatId;
        const isPersonalChat = message.participants?.includes(user.uid) && !isGeneralChat;

                 if (isGeneralChat) {
           generalUnread++;
           
           // Send notification for very recent messages (avoid spam) - but not when chat is open
           if (!isChatOpen && currentTime - messageTime < 3000 && !processedMessagesRef.current.has(message.id)) {
             console.log('[Chat] New general message from:', message.userDisplayName);
             addNotification({
               message: `💬 ${message.userDisplayName}: ${message.text.slice(0, 50)}${message.text.length > 50 ? '...' : ''}`,
               type: 'info'
             });
             playSound('receive');
             newProcessedMessages.add(message.id);
           }
         } else if (isPersonalChat) {
           personalUnread++;
           
           // Send notification for very recent personal messages - but not when chat is open
           if (!isChatOpen && currentTime - messageTime < 3000 && !processedMessagesRef.current.has(message.id)) {
             console.log('[Chat] New personal message from:', message.userDisplayName);
             addNotification({
               message: `💬 ${message.userDisplayName} (private): ${message.text.slice(0, 40)}${message.text.length > 40 ? '...' : ''}`,
               type: 'info'
             });
             playSound('receive');
             newProcessedMessages.add(message.id);
           }
         }
      });

      // Update processed messages (keep last 50 to avoid memory leaks)
      processedMessagesRef.current = new Set([
        ...Array.from(processedMessagesRef.current).slice(-50),
        ...newProcessedMessages
      ]);

      // Update unread counts
      setUnreadCount({
        general: generalUnread,
        personal: personalUnread,
        total: generalUnread + personalUnread
      });

      console.log('[Chat] Unread counts:', { general: generalUnread, personal: personalUnread });
    }, (error) => {
      console.error('[Chat] Snapshot error:', error);
      // Reset counts on error
      setUnreadCount({ general: 0, personal: 0, total: 0 });
    });

    unsubscribeRef.current = unsubscribe;

    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
    };
      }, [isAuthenticated, user, lastReadTimestamp, addNotification, playSound, isChatOpen]);

  // Mark messages as read
  const markAsRead = useCallback(() => {
    console.log('[Chat] Marking messages as read');
    setLastReadTimestamp(Date.now());
    setUnreadCount({
      general: 0,
      personal: 0,
      total: 0
    });
    // Clear processed messages when user reads
    processedMessagesRef.current.clear();
  }, []);

  // Play send sound
  const onMessageSent = useCallback(() => {
    playSound('send');
  }, [playSound]);

  return {
    unreadCount,
    markAsRead,
    onMessageSent,
    playSound
  };
}; 