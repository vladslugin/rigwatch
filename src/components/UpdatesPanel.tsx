import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../hooks/useAuth';
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
  serverTimestamp,
  getDocs,
  doc,
  updateDoc,
  deleteDoc,
  startAfter,
  DocumentSnapshot
} from 'firebase/firestore';

interface UpdateNews {
  id: string;
  title: string;
  content: string;
  userId: string;
  userEmail: string;
  userDisplayName: string;
  timestamp: any;
  version?: string;
  isEdited?: boolean;
  editedAt?: any;
}

interface UpdatesPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const UpdatesPanel: React.FC<UpdatesPanelProps> = ({ isOpen, onClose }) => {
  const { user, isAuthenticated, hasPermission } = useAuth();
  const isMobile = useIsMobile();
  const { t, i18n } = useTranslation();

  const [updates, setUpdates] = useState<UpdateNews[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [lastDoc, setLastDoc] = useState<DocumentSnapshot | null>(null);

  // Edit states
  const [editingUpdateId, setEditingUpdateId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editVersion, setEditVersion] = useState('');

  // New update states
  const [showAddForm, setShowAddForm] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newVersion, setNewVersion] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Handle Escape key to close modal
  useEscapeKey(onClose, { enabled: isOpen });

  // Check if user can manage updates (developer or super admin)
  const canManageUpdates = useCallback((): boolean => {
    return hasPermission('updates.manage') || hasPermission('manage_updates');
  }, [hasPermission]);

  // Scroll to bottom when new updates arrive
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // Load initial updates (first 3)
  const loadInitialUpdates = useCallback(async () => {
    if (!firestoreDB) return;

    setIsLoading(true);
    try {
      const updatesQuery = query(
        collection(firestoreDB, 'updates_news'),
        orderBy('timestamp', 'desc'),
        limit(3)
      );

      const querySnapshot = await getDocs(updatesQuery);
      const updatesList: UpdateNews[] = [];

      querySnapshot.forEach((doc) => {
        updatesList.push({
          id: doc.id,
          ...doc.data()
        } as UpdateNews);
      });

      setUpdates(updatesList);
      setHasMore(querySnapshot.docs.length === 3);
      setLastDoc(querySnapshot.docs[querySnapshot.docs.length - 1] || null);
    } catch (error) {
      console.error('[Updates] Error loading initial updates:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Load more updates
  const loadMoreUpdates = useCallback(async () => {
    if (!firestoreDB || !lastDoc || isLoading) return;

    setIsLoading(true);
    try {
      const updatesQuery = query(
        collection(firestoreDB, 'updates_news'),
        orderBy('timestamp', 'desc'),
        startAfter(lastDoc),
        limit(5)
      );

      const querySnapshot = await getDocs(updatesQuery);
      const moreUpdates: UpdateNews[] = [];

      querySnapshot.forEach((doc) => {
        moreUpdates.push({
          id: doc.id,
          ...doc.data()
        } as UpdateNews);
      });

      setUpdates(prev => [...prev, ...moreUpdates]);
      setHasMore(querySnapshot.docs.length === 5);
      setLastDoc(querySnapshot.docs[querySnapshot.docs.length - 1] || null);
    } catch (error) {
      console.error('[Updates] Error loading more updates:', error);
    } finally {
      setIsLoading(false);
    }
  }, [lastDoc, isLoading]);

  // Add new update
  const handleAddUpdate = useCallback(async () => {
    if (!newTitle.trim() || !newContent.trim() || !isAuthenticated || !user || !canManageUpdates()) {
      return;
    }

    setIsLoading(true);
    try {
      await addDoc(collection(firestoreDB!, 'updates_news'), {
        title: newTitle.trim(),
        content: newContent.trim(),
        version: newVersion.trim() || null,
        userId: user.uid,
        userEmail: user.email,
        userDisplayName: user.displayName || user.email,
        timestamp: serverTimestamp()
      });

      // Reset form
      setNewTitle('');
      setNewContent('');
      setNewVersion('');
      setShowAddForm(false);

      // Reload updates
      await loadInitialUpdates();
    } catch (error) {
      console.error('[Updates] Error adding update:', error);
    } finally {
      setIsLoading(false);
    }
  }, [newTitle, newContent, newVersion, isAuthenticated, user, canManageUpdates, loadInitialUpdates]);

  // Start editing update
  const startEditUpdate = useCallback((update: UpdateNews) => {
    setEditingUpdateId(update.id);
    setEditTitle(update.title);
    setEditContent(update.content);
    setEditVersion(update.version || '');
  }, []);

  // Cancel editing
  const cancelEdit = useCallback(() => {
    setEditingUpdateId(null);
    setEditTitle('');
    setEditContent('');
    setEditVersion('');
  }, []);

  // Save edited update
  const saveEditUpdate = useCallback(async () => {
    if (!editTitle.trim() || !editContent.trim() || !editingUpdateId || !user) return;

    setIsLoading(true);
    try {
      const updateRef = doc(firestoreDB!, 'updates_news', editingUpdateId);
      await updateDoc(updateRef, {
        title: editTitle.trim(),
        content: editContent.trim(),
        version: editVersion.trim() || null,
        isEdited: true,
        editedAt: serverTimestamp()
      });

      cancelEdit();
      await loadInitialUpdates();
    } catch (error) {
      console.error('[Updates] Error editing update:', error);
    } finally {
      setIsLoading(false);
    }
  }, [editTitle, editContent, editVersion, editingUpdateId, user, cancelEdit, loadInitialUpdates]);

  // Delete update
  const deleteUpdate = useCallback(async (updateId: string) => {
    if (!user || !canManageUpdates()) return;

    if (!confirm('Are you sure you want to delete this update?')) return;

    setIsLoading(true);
    try {
      const updateRef = doc(firestoreDB!, 'updates_news', updateId);
      await deleteDoc(updateRef);
      await loadInitialUpdates();
    } catch (error) {
      console.error('[Updates] Error deleting update:', error);
    } finally {
      setIsLoading(false);
    }
  }, [user, canManageUpdates, loadInitialUpdates]);

  // Load updates when panel opens
  useEffect(() => {
    if (isOpen) {
      loadInitialUpdates();
    }
  }, [isOpen, loadInitialUpdates]);

  // Scroll to bottom when updates change
  useEffect(() => {
    scrollToBottom();
  }, [updates, scrollToBottom]);

  if (!isOpen) {
    return null;
  }

  // Define container classes based on mobile state
  const panelContainerClasses = isMobile
    ? "fixed inset-0 z-50 bg-card text-foreground flex flex-col"
    : "fixed bottom-4 right-4 w-[36rem] max-w-[calc(100%-2rem)] max-h-[calc(100%-2rem)] z-50 bg-card text-foreground rounded-lg border border-border shadow-theme-lg flex flex-col";

  const panelDialogClasses = isMobile
    ? "w-full h-full flex flex-col"
    : "w-full h-[600px] flex flex-col";

  return (
    <div className={panelContainerClasses}>
      <div className={panelDialogClasses}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border bg-section-header text-section-header-foreground">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-info/15 rounded-full flex items-center justify-center border border-border">
              <svg className="w-4 h-4 text-info" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
              </svg>
            </div>
            <div>
              <h2 className="text-xl font-semibold text-section-header-foreground">
                {t('updates.title')}
              </h2>
              <p className="text-sm text-section-header-foreground/80">
                {canManageUpdates() ? t('updates.subtitleManage') : t('updates.subtitleView')}
              </p>
            </div>
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

        {/* Add Update Form - Only for super admins */}
        {canManageUpdates() && (
          <div className="p-4 border-b border-border bg-card">
            {!showAddForm ? (
              <button
                onClick={() => setShowAddForm(true)}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md border border-border hover:brightness-95 transition-colors text-sm font-medium"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                {t('updates.addNew')}
              </button>
            ) : (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    placeholder={t('updates.titlePlaceholder')}
                    className="flex-1 px-3 py-2 border border-border rounded-md focus:ring-2 focus:ring-primary focus:border-primary bg-card text-foreground text-sm"
                  />
                  <input
                    type="text"
                    value={newVersion}
                    onChange={(e) => setNewVersion(e.target.value)}
                    placeholder={t('updates.versionPlaceholder')}
                    className="w-20 px-3 py-2 border border-border rounded-md focus:ring-2 focus:ring-primary focus:border-primary bg-card text-foreground text-sm"
                  />
                </div>
                <textarea
                  value={newContent}
                  onChange={(e) => setNewContent(e.target.value)}
                  placeholder={t('updates.contentPlaceholder')}
                  rows={3}
                  className="w-full px-3 py-2 border border-border rounded-md focus:ring-2 focus:ring-primary focus:border-primary bg-card text-foreground text-sm resize-none"
                />

                {/* Symbol Helper */}
                <div className="bg-info/10 border border-info/30 rounded-md p-3">
                  <div className="text-xs text-info font-medium mb-2">Change Symbols:</div>
                  <div className="grid grid-cols-2 gap-1 text-xs text-info">
                    <div>[+] — Added</div>
                    <div>[-] — Removed</div>
                    <div>[*] — Changed / Refactored</div>
                    <div>[!] — Fixed</div>
                    <div>[~] — Improved, UI/UX</div>
                    <div>[⚠] — Important / Breaking</div>
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={handleAddUpdate}
                    disabled={!newTitle.trim() || !newContent.trim() || isLoading}
                    className="flex-1 px-4 py-2 bg-success text-success-foreground rounded-md hover:brightness-95 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
                  >
                    {isLoading ? t('updates.publishing') : t('updates.publish')}
                  </button>
                  <button
                    onClick={() => {
                      setShowAddForm(false);
                      setNewTitle('');
                      setNewContent('');
                      setNewVersion('');
                    }}
                    className="px-4 py-2 bg-muted text-muted-foreground rounded-md hover:brightness-95 transition-colors text-sm font-medium"
                  >
                    {t('updates.cancel')}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Updates List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {updates.length === 0 && !isLoading ? (
            <div className="text-center text-muted-foreground py-8">
              <div className="w-12 h-12 bg-muted rounded-full mx-auto mb-3 flex items-center justify-center">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
                </svg>
              </div>
              <p className="text-sm">{t('updates.noUpdates')}</p>
              <p className="text-xs mt-1">{t('updates.checkBack')}</p>
            </div>
          ) : (
            updates.map((update) => (
              <div
                key={update.id}
                className="bg-background rounded-lg p-4 border border-border group"
              >
                {editingUpdateId === update.id ? (
                  /* Edit Form */
                  <div className="space-y-3">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        className="flex-1 px-3 py-2 border border-border rounded-md focus:ring-2 focus:ring-primary focus:border-primary bg-card text-foreground text-sm"
                      />
                      <input
                        type="text"
                        value={editVersion}
                        onChange={(e) => setEditVersion(e.target.value)}
                        placeholder={t('updates.versionPlaceholder')}
                        className="w-20 px-3 py-2 border border-border rounded-md focus:ring-2 focus:ring-primary focus:border-primary bg-card text-foreground text-sm"
                      />
                    </div>
                    <textarea
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      rows={3}
                      className="w-full px-3 py-2 border border-border rounded-md focus:ring-2 focus:ring-primary focus:border-primary bg-card text-foreground text-sm resize-none"
                    />

                    {/* Symbol Helper for Edit */}
                    <div className="bg-info/10 border border-info/30 rounded-md p-3">
                      <div className="text-xs text-info font-medium mb-2">Change Symbols:</div>
                      <div className="grid grid-cols-2 gap-1 text-xs text-info">
                        <div>[+] — Added</div>
                        <div>[-] — Removed</div>
                        <div>[*] — Changed / Refactored</div>
                        <div>[!] — Fixed</div>
                        <div>[~] — Improved, UI/UX</div>
                        <div>[⚠] — Important / Breaking</div>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <button
                        onClick={saveEditUpdate}
                        disabled={!editTitle.trim() || !editContent.trim() || isLoading}
                        className="px-3 py-1 text-xs bg-success text-success-foreground rounded hover:brightness-95 disabled:opacity-50"
                      >
                        {t('actions.save')}
                      </button>
                      <button
                        onClick={cancelEdit}
                        className="px-3 py-1 text-xs bg-muted text-muted-foreground rounded hover:brightness-95"
                      >
                        {t('actions.cancel')}
                      </button>
                    </div>
                  </div>
                ) : (
                  /* Display Update */
                  <>
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-foreground text-base">
                          {update.title}
                        </h3>
                        {update.version && (
                          <span className="px-2 py-1 bg-info/15 text-info rounded-full text-xs font-medium">
                            {update.version}
                          </span>
                        )}
                      </div>

                      {/* Admin actions */}
                      {canManageUpdates() && (
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => startEditUpdate(update)}
                            className="p-1 text-xs bg-muted hover:brightness-95 text-muted-foreground rounded"
                            title={t('actions.edit') || 'Edit'}
                          >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => deleteUpdate(update.id)}
                            className="p-1 text-xs bg-destructive hover:brightness-95 text-destructive-foreground rounded"
                            title={t('actions.delete') || 'Delete'}
                          >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      )}
                    </div>

                    <p className="text-foreground text-sm mb-3 whitespace-pre-line font-mono">
                      {update.content}
                    </p>

                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>
                        {t('updates.by')} {update.userDisplayName}
                      </span>
                      <span>
                        {(() => {
                          const date = update.timestamp?.toDate?.();
                          if (!date) return null;
                          return new Intl.DateTimeFormat(i18n.language || 'en', {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          }).format(date);
                        })()}
                        {update.isEdited && (
                          <span className="ml-1 italic">{t('updates.edited')}</span>
                        )}
                      </span>
                    </div>
                  </>
                )}
              </div>
            ))
          )}

          {/* Load More Button */}
          {hasMore && !isLoading && updates.length > 0 && (
            <div className="text-center pt-4">
              <button
                onClick={loadMoreUpdates}
                className="px-6 py-2 bg-muted text-muted-foreground rounded-lg hover:brightness-95 transition-colors text-sm font-medium"
              >
                {t('updates.loadMore')}
              </button>
            </div>
          )}

          {/* Loading indicator */}
          {isLoading && (
            <div className="text-center py-4">
              <div className="inline-flex items-center gap-2 text-muted-foreground text-sm">
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                {t('updates.loading')}
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>
    </div>
  );
};

export default UpdatesPanel;
