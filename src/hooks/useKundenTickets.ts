import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  addDoc,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { firestoreDB } from '../lib/firebase';
import { useAuth } from './useAuth';
import { useNotificationHelpers } from '../store/useRigStore';
import type {
  CreateKundenTicketInput,
  KundenTicket,
  KundenTicketNote,
  KundenTicketStatus,
} from '../types/kundenTickets';

const COLLECTION_NAME = 'kunden_tickets';

const canReadKundenTicketsByRole = (role?: string | null) => {
  const normalized = String(role || '').toLowerCase();
  return normalized === 'admin' || normalized === 'developer' || normalized === 'super_admin';
};

export const useKundenTickets = () => {
  const { user } = useAuth();
  const { showError, showSuccess } = useNotificationHelpers();
  const [tickets, setTickets] = useState<KundenTicket[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const canRead = useMemo(() => canReadKundenTicketsByRole(user?.role), [user?.role]);

  useEffect(() => {
    if (!canRead || !firestoreDB) {
      setTickets([]);
      return;
    }

    const ticketsRef = collection(firestoreDB, COLLECTION_NAME);
    const ticketsQuery = query(ticketsRef, orderBy('createdAt', 'desc'));

    const unsubscribe = onSnapshot(ticketsQuery, (snapshot) => {
      const items: KundenTicket[] = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...(docSnap.data() as Omit<KundenTicket, 'id'>),
      }));
      setTickets(items);
    });

    return () => unsubscribe();
  }, [canRead]);

  const createKundenTicket = useCallback(
    async (payload: CreateKundenTicketInput): Promise<boolean> => {
      if (!firestoreDB) {
        showError('Firestore ist nicht initialisiert.');
        return false;
      }

      try {
        setIsLoading(true);
        await addDoc(collection(firestoreDB, COLLECTION_NAME), {
          ...payload,
          status: 'new' as KundenTicketStatus,
          source: 'dealer_mode',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        showSuccess('Bericht wurde an HASE gesendet.');
        return true;
      } catch (error) {
        console.error('[KundenTickets] Failed to create ticket:', error);
        showError('Bericht konnte nicht gesendet werden.');
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    [showError, showSuccess]
  );

  const updateKundenTicketStatus = useCallback(
    async (ticketId: string, status: KundenTicketStatus): Promise<boolean> => {
      if (!canRead) {
        showError('Keine Berechtigung fuer Kunden-Tickets.');
        return false;
      }
      if (!firestoreDB) {
        showError('Firestore ist nicht initialisiert.');
        return false;
      }

      try {
        await updateDoc(doc(firestoreDB, COLLECTION_NAME, ticketId), {
          status,
          updatedAt: serverTimestamp(),
        });
        showSuccess('Ticket-Status aktualisiert.');
        return true;
      } catch (error) {
        console.error('[KundenTickets] Failed to update ticket status:', error);
        showError('Status konnte nicht aktualisiert werden.');
        return false;
      }
    },
    [canRead, showError, showSuccess]
  );

  /**
   * Append a private staff note to the ticket. Notes use a client-side
   * `Date.now()` because Firestore rejects serverTimestamp() inside array
   * elements; the small clock skew is acceptable for a free-text thread.
   */
  const addKundenTicketNote = useCallback(
    async (ticketId: string, text: string): Promise<boolean> => {
      const trimmed = text.trim();
      if (!trimmed) return false;
      if (!canRead) {
        showError('Keine Berechtigung fuer Kunden-Tickets.');
        return false;
      }
      if (!firestoreDB) {
        showError('Firestore ist nicht initialisiert.');
        return false;
      }
      try {
        const note: KundenTicketNote = {
          id: typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? (crypto as any).randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          text: trimmed,
          authorUid: user?.uid ?? null,
          authorName: user?.displayName ?? user?.email ?? null,
          authorRole: user?.role ?? null,
          createdAt: Date.now(),
        };
        await updateDoc(doc(firestoreDB, COLLECTION_NAME, ticketId), {
          notes: arrayUnion(note),
          updatedAt: serverTimestamp(),
        });
        return true;
      } catch (error) {
        console.error('[KundenTickets] Failed to add note:', error);
        showError('Notiz konnte nicht gespeichert werden.');
        return false;
      }
    },
    [canRead, showError, user?.displayName, user?.email, user?.role, user?.uid]
  );

  /**
   * Hard-delete a ticket. The Firestore rule must restrict this to
   * admin/developer/super_admin — see firestore.rules.example.
   */
  const deleteKundenTicket = useCallback(
    async (ticketId: string): Promise<boolean> => {
      if (!canRead) {
        showError('Keine Berechtigung fuer Kunden-Tickets.');
        return false;
      }
      if (!firestoreDB) {
        showError('Firestore ist nicht initialisiert.');
        return false;
      }
      try {
        await deleteDoc(doc(firestoreDB, COLLECTION_NAME, ticketId));
        showSuccess('Ticket gelöscht.');
        return true;
      } catch (error) {
        console.error('[KundenTickets] Failed to delete ticket:', error);
        showError('Ticket konnte nicht gelöscht werden.');
        return false;
      }
    },
    [canRead, showError, showSuccess]
  );

  return {
    tickets,
    isLoading,
    canRead,
    createKundenTicket,
    updateKundenTicketStatus,
    addKundenTicketNote,
    deleteKundenTicket,
  };
};
