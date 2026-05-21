import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useFirebaseConnection } from '../hooks/useFirebase';
import { useChatNotifications } from '../hooks/useChatNotifications';
import { useIsMobile } from '../hooks/useIsMobile';
import { useTranslation } from 'react-i18next';
import { useEscapeKey } from '../hooks/useEscapeKey';

import { firestoreDB } from '../lib/firebase';
import {
  collection,
  addDoc,
  query,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  where,
  getDocs,
  doc,
  updateDoc,
  deleteDoc
} from 'firebase/firestore';

interface ChatMessage {
  id: string;
  text: string;
  userId: string;
  userEmail: string;
  userDisplayName: string;
  timestamp: any;
  processedText?: string; // Text with device ID processing
  chatId?: string; // 'general' for team chat, 'personal_uid1_uid2' for personal
  participants?: string[]; // Array of user IDs for personal chats
  isEdited?: boolean;
  editedAt?: any;
}

interface DeviceInfo {
  deviceId: string;
  modelName?: string;
  modelData?: any;
}

interface ChatSystemProps {
  isOpen: boolean;
  onClose: () => void;
  targetUser?: any; // null for general chat, user object for personal chat
}

const ChatSystem: React.FC<ChatSystemProps> = ({ isOpen, onClose, targetUser }) => {
  const { user, isAuthenticated, hasPermission } = useAuth();
  const { connect } = useFirebaseConnection();
  const { onMessageSent } = useChatNotifications(true); // Chat is open when this component is rendered
  const isMobile = useIsMobile();
  const { t } = useTranslation();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [deviceInfoCache, setDeviceInfoCache] = useState<Record<string, DeviceInfo>>({});

  // Edit message states
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageInputRef = useRef<HTMLInputElement>(null);

  // Handle Escape key to close modal
  useEscapeKey(onClose, { enabled: isOpen });

  // Scroll to bottom when new messages arrive
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // Check if string is a valid 22-character device ID
  const isValidDeviceId = useCallback((text: string): boolean => {
    return /^\d{22}$/.test(text);
  }, []);

  // Extract device IDs from message text
  const extractDeviceIds = useCallback((text: string): string[] => {
    const words = text.split(/\s+/);
    return words.filter(word => isValidDeviceId(word));
  }, [isValidDeviceId]);

  // Get device info (name) for device ID
  const getDeviceInfo = useCallback(async (deviceId: string): Promise<DeviceInfo> => {
    if (deviceInfoCache[deviceId]) {
      return deviceInfoCache[deviceId];
    }

    try {
      // Try to get model name using the rig model hook logic
      // We need to temporarily set device metadata to get the model name
      const articleNumber = deviceId.substring(0, 7); // First 7 digits might be article number

      // Query Firestore for rig model based on various possible article numbers
      const { collection: firestoreCollection, query: firestoreQuery, where: firestoreWhere, getDocs: firestoreGetDocs } = await import('firebase/firestore');

      let modelName = `Device ${deviceId.substring(0, 7)}...${deviceId.substring(18)}`;
      let modelData = null;

      try {
        const rigModelsRef = firestoreCollection(firestoreDB!, 'rig_models');
        const q = firestoreQuery(rigModelsRef, firestoreWhere('article_number', '==', articleNumber));
        const querySnapshot = await firestoreGetDocs(q);

        if (!querySnapshot.empty) {
          const doc = querySnapshot.docs[0];
          modelData = doc.data();
          modelName = modelData.name || modelName;
        }
      } catch (error) {
        console.warn('[Chat] Could not fetch model data for device:', deviceId);
      }

      const deviceInfo: DeviceInfo = {
        deviceId,
        modelName,
        modelData
      };

      // Cache the result
      setDeviceInfoCache(prev => ({
        ...prev,
        [deviceId]: deviceInfo
      }));

      return deviceInfo;
    } catch (error) {
      console.error('[Chat] Error getting device info:', error);
      return {
        deviceId,
        modelName: `Device ${deviceId.substring(0, 7)}...${deviceId.substring(18)}`
      };
    }
  }, [deviceInfoCache]);

  // Process message text to replace device IDs with rich components
  const processMessageText = useCallback(async (text: string): Promise<string> => {
    const deviceIds = extractDeviceIds(text);

    if (deviceIds.length === 0) {
      return text;
    }

    let processedText = text;

    for (const deviceId of deviceIds) {
      const deviceInfo = await getDeviceInfo(deviceId);
      const deviceName = deviceInfo.modelName || `Device ${deviceId.substring(0, 7)}...${deviceId.substring(18)}`;

      // Replace device ID with a special marker that we'll process in rendering
      processedText = processedText.replace(
        deviceId,
        `[DEVICE:${deviceId}:${deviceName}]`
      );
    }

    return processedText;
  }, [extractDeviceIds, getDeviceInfo]);

  // Render processed message text with clickable device IDs
  const renderMessageText = useCallback((text: string, processedText?: string) => {
    const textToRender = processedText || text;
    const devicePattern = /\[DEVICE:(\d{22}):([^\]]+)\]/g;

    if (!devicePattern.test(textToRender)) {
      return <span>{text}</span>;
    }

    const parts = textToRender.split(devicePattern);
    const result = [];

    for (let i = 0; i < parts.length; i++) {
      if (i % 3 === 0) {
        // Regular text
        if (parts[i]) {
          result.push(<span key={i}>{parts[i]}</span>);
        }
      } else if (i % 3 === 1) {
        // Device ID
        const deviceId = parts[i];
        const deviceName = parts[i + 1];

        result.push(
          <button
            key={i}
            onClick={() => handleDeviceClick(deviceId)}
            className="inline-flex items-center gap-1 px-2 py-1 bg-info/15 hover:bg-info/25 text-info rounded-md text-sm font-medium transition-colors border border-info/30 mx-1"
            title={t('chat.connectToDevice', { id: deviceId }) as string}
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            {deviceName}
            <span className="text-xs opacity-70">({deviceId.substring(18)})</span>
          </button>
        );
        i++; // Skip device name part
      }
    }

    return <span>{result}</span>;
  }, [t]);

  // Handle device ID click - connect to device
  const handleDeviceClick = useCallback(async (deviceId: string) => {
    try {
      await connect(deviceId);
      // Close chat after successful connection
      setTimeout(() => {
        onClose();
      }, 1000);
    } catch (error) {
      console.error('[Chat] Error connecting to device:', error);
    }
  }, [connect, onClose]);

  // Check if user can edit/delete message
  const canModifyMessage = useCallback((message: ChatMessage): boolean => {
    if (!user) return false;

    // Users can edit their own messages
    if (message.userId === user.uid) return true;

    // Super admins can delete any message
    if (hasPermission('manage_users')) return true;

    return false;
  }, [user, hasPermission]);

  // Start editing message
  const startEditMessage = useCallback((message: ChatMessage) => {
    setEditingMessageId(message.id);
    setEditText(message.text);
  }, []);

  // Cancel editing
  const cancelEdit = useCallback(() => {
    setEditingMessageId(null);
    setEditText('');
  }, []);

  // Save edited message
  const saveEditMessage = useCallback(async () => {
    if (!editText.trim() || !editingMessageId || !user) return;

    setIsLoading(true);
    try {
      const processedText = await processMessageText(editText.trim());

      const messageRef = doc(firestoreDB!, 'chat_messages', editingMessageId);
      await updateDoc(messageRef, {
        text: editText.trim(),
        processedText,
        isEdited: true,
        editedAt: serverTimestamp()
      });

      cancelEdit();
    } catch (error) {
      console.error('[Chat] Error editing message:', error);
    } finally {
      setIsLoading(false);
    }
  }, [editText, editingMessageId, user, processMessageText, cancelEdit]);

  // Delete message
  const deleteMessage = useCallback(async (messageId: string) => {
    if (!user) return;

    if (!confirm('Are you sure you want to delete this message?')) return;

    setIsLoading(true);
    try {
      const messageRef = doc(firestoreDB!, 'chat_messages', messageId);
      await deleteDoc(messageRef);
    } catch (error) {
      console.error('[Chat] Error deleting message:', error);
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  // Send message
  const handleSendMessage = useCallback(async () => {
    if (!newMessage.trim() || !isAuthenticated || !user) {
      return;
    }

    setIsLoading(true);
    try {
      const processedText = await processMessageText(newMessage.trim());

      let chatId = 'general';
      if (targetUser) {
        const participants = [user.uid, targetUser.uid].sort();
        chatId = `personal_${participants[0]}_${participants[1]}`;
      }

      await addDoc(collection(firestoreDB!, 'chat_messages'), {
        text: newMessage.trim(),
        processedText,
        userId: user.uid,
        userEmail: user.email,
        userDisplayName: user.displayName || user.email,
        chatId,
        participants: targetUser ? [user.uid, targetUser.uid] : null,
        timestamp: serverTimestamp()
      });

      setNewMessage('');
      // Play send sound
      onMessageSent();
    } catch (error) {
      console.error('[Chat] Error sending message:', error);
    } finally {
      setIsLoading(false);
    }
  }, [newMessage, isAuthenticated, user, processMessageText, targetUser, onMessageSent]);

  // Load messages
  useEffect(() => {
    if (!isOpen || !firestoreDB || !user) return;

    let q;
    try {
      if (targetUser) {
        // Personal chat - messages between current user and target user
        const participants = [user.uid, targetUser.uid].sort();
        const chatId = `personal_${participants[0]}_${participants[1]}`;

        q = query(
          collection(firestoreDB!, 'chat_messages'),
          where('chatId', '==', chatId),
          orderBy('timestamp', 'desc'),
          limit(50)
        );
      } else {
        // General chat - messages with chatId === 'general'
        q = query(
          collection(firestoreDB!, 'chat_messages'),
          where('chatId', '==', 'general'),
          orderBy('timestamp', 'desc'),
          limit(50)
        );
      }
    } catch (error) {
      console.warn('[Chat] Index not ready, using simple query:', error);
      // Fallback: simple query without where+orderBy combination
      q = query(
        collection(firestoreDB!, 'chat_messages'),
        orderBy('timestamp', 'desc'),
        limit(50)
      );
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const newMessages: ChatMessage[] = [];
      snapshot.forEach((doc) => {
        const messageData = doc.data() as ChatMessage;

        // Filter messages on client side if index not ready
        if (targetUser) {
          const participants = [user.uid, targetUser.uid].sort();
          const expectedChatId = `personal_${participants[0]}_${participants[1]}`;
          if (messageData.chatId === expectedChatId) {
            newMessages.push({
              ...messageData,
              id: doc.id
            });
          }
        } else {
          // General chat
          if (messageData.chatId === 'general' || !messageData.chatId) {
            newMessages.push({
              ...messageData,
              id: doc.id
            });
          }
        }
      });

      // Reverse to show newest at bottom
      setMessages(newMessages.reverse());
    }, (error) => {
      console.warn('[Chat] Snapshot error, probably index not ready:', error);
      // Show empty messages for now
      setMessages([]);
    });

    return () => unsubscribe();
  }, [isOpen, targetUser, user]);

  // Scroll to bottom when messages change
  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Focus input when chat opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        messageInputRef.current?.focus();
      }, 100);
    }
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  // Define container classes based on mobile state
  const chatContainerClasses = isMobile
    ? "fixed inset-0 z-50 bg-card flex flex-col"
    : "fixed bottom-4 right-4 w-96 max-w-[calc(100%-2rem)] max-h-[calc(100%-2rem)] z-50 bg-card rounded-lg shadow-xl flex flex-col";

  const chatDialogClasses = isMobile
    ? "w-full h-full flex flex-col"
    : "w-full h-[600px] flex flex-col"; // Original desktop height

  return (
    // Apply conditional classes to the outermost div
    <div className={chatContainerClasses}>
      {/* Main chat dialog area, adjusted for mobile */}
      <div className={chatDialogClasses}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border bg-section-header text-section-header-foreground">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-info/15 rounded-full flex items-center justify-center">
              <svg className="w-4 h-4 text-info" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a2 2 0 01-2-2v-6a2 2 0 012-2h8z" />
              </svg>
            </div>
            <div>
              <h2 className="text-xl font-semibold text-section-header-foreground">
                {targetUser ? t('chat.chatWith', { name: targetUser.displayName || targetUser.email }) : t('chat.teamChat')}
              </h2>
              <p className="text-sm text-section-header-foreground/70">
                {targetUser ? t('chat.privateConversation') : t('chat.teamCommunication')}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-section-header-foreground/70 hover:text-section-header-foreground transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-background">
          {messages.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">
              <div className="w-12 h-12 bg-muted rounded-full mx-auto mb-3 flex items-center justify-center">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <p className="text-sm">{t('chat.empty')}</p>
              <p className="text-xs mt-1">{t('chat.start')}</p>
            </div>
          ) : (
            messages.map((message) => (
              <div
                key={message.id}
                className={`flex ${
                  message.userId === user?.uid ? 'justify-end' : 'justify-start'
                } group`}
              >
                <div
                  className={`max-w-xs lg:max-w-md relative ${
                    message.userId === user?.uid ? 'flex flex-col items-end' : 'flex flex-col items-start'
                  }`}
                >
                  {/* Message Bubble */}
                  <div
                    className={`px-3 py-2 rounded-lg relative ${
                      message.userId === user?.uid
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-foreground'
                    }`}
                  >
                    {message.userId !== user?.uid && (
                      <p className="text-xs font-medium mb-1 opacity-70">
                        {message.userDisplayName}
                      </p>
                    )}

                    {/* Message Content or Edit Input */}
                    {editingMessageId === message.id ? (
                      <div className="space-y-2">
                        <input
                          type="text"
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          onKeyPress={(e) => {
                            if (e.key === 'Enter') saveEditMessage();
                            if (e.key === 'Escape') cancelEdit();
                          }}
                          className="w-full px-2 py-1 text-sm bg-card text-foreground border border-border rounded"
                          autoFocus
                        />
                        <div className="flex gap-1">
                          <button
                            onClick={saveEditMessage}
                            disabled={!editText.trim() || isLoading}
                            className="px-2 py-1 text-xs bg-success text-success-foreground rounded hover:bg-success/90 disabled:opacity-50"
                          >
                            {t('actions.save')}
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="px-2 py-1 text-xs bg-muted text-foreground rounded hover:bg-muted/80"
                          >
                            {t('actions.cancel')}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="text-sm">
                          {renderMessageText(message.text, message.processedText)}
                        </div>

                        <div className="flex items-center justify-between mt-1">
                          <p className="text-xs opacity-70">
                            {message.timestamp?.toDate?.()?.toLocaleTimeString() || t('chat.sending')}
                            {message.isEdited && (
                              <span className="ml-1 italic">{t('chat.edited')}</span>
                            )}
                          </p>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Action buttons - show on hover */}
                  {canModifyMessage(message) && editingMessageId !== message.id && (
                    <div className={`flex gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity ${
                      message.userId === user?.uid ? 'justify-end' : 'justify-start'
                    }`}>
                      {/* Edit button - only for own messages */}
                      {message.userId === user?.uid && (
                        <button
                          onClick={() => startEditMessage(message)}
                          className="p-1 text-xs bg-muted text-foreground hover:bg-muted/80 rounded"
                          title={t('chat.edit') as string}
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                      )}

                      {/* Delete button - own messages or super admin */}
                      <button
                        onClick={() => deleteMessage(message.id)}
                        className="p-1 text-xs bg-destructive text-destructive-foreground hover:bg-destructive/90 rounded"
                        title={t('chat.delete') as string}
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="p-4 border-t border-border bg-card">
          {isAuthenticated ? (
            <div className="flex gap-2">
              <input
                ref={messageInputRef}
                type="text"
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && !isLoading && handleSendMessage()}
                placeholder={t('chat.inputPlaceholder') as string}
                disabled={isLoading}
                className="flex-1 px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-primary focus:border-primary disabled:bg-muted disabled:cursor-not-allowed bg-background text-foreground text-sm"
              />
              <button
                onClick={handleSendMessage}
                disabled={!newMessage.trim() || isLoading}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium flex items-center gap-1"
              >
                {isLoading ? (
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                )}
                {t('chat.send')}
              </button>
            </div>
          ) : (
            <div className="text-center text-muted-foreground py-4">
              <p className="text-sm">{t('chat.loginPrompt')}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ChatSystem;
