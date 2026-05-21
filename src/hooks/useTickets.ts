import { useState, useEffect, useCallback } from 'react';
import { 
  collection, 
  addDoc, 
  query, 
  orderBy, 
  onSnapshot, 
  doc, 
  updateDoc, 
  deleteDoc,
  serverTimestamp,
  Timestamp
} from 'firebase/firestore';
import { firestoreDB } from '../lib/firebase';
import { useAuth } from './useAuth';
import { useNotificationHelpers } from '../store/useRigStore';
import type { Ticket, TicketType, TicketTask } from '../types/tickets';

export const useTickets = () => {
  const { user, hasPermission } = useAuth();
  const { showSuccess, showError } = useNotificationHelpers();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Listen to tickets (exclude anonymous tickets for non-developers)
  useEffect(() => {
    // Check if localhost - if yes, skip Firebase entirely and use mock data
    const isLocalhost = typeof window !== 'undefined' && 
      (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
    
    if (isLocalhost) {
      console.log('[useTickets] 🏠 Localhost detected - using mock tickets only');
      const mockDate = Timestamp.now();
      const mockTickets: Ticket[] = [
        // Mock ticket 1: Bug (in progress)
        {
          id: 'mock_bug_1',
          title: 'Fix temperature sensor reading issue',
          type: 'bug',
          isAnonymous: false,
          authorId: 'local_dev',
          authorEmail: 'dev@localhost',
          authorDisplayName: 'Local Developer',
          tasks: [
            { id: 'task_1', text: 'Identify the sensor malfunction', completed: true },
            { id: 'task_2', text: 'Update sensor calibration logic', completed: true },
            { id: 'task_3', text: 'Test with multiple sensor types', completed: false }
          ],
          status: 'in_progress',
          createdAt: mockDate,
          updatedAt: mockDate
        },
        
        // Mock ticket 2: Feature (open)
        {
          id: 'mock_feature_1',
          title: 'Add export to PDF functionality',
          type: 'feature',
          isAnonymous: false,
          authorId: 'local_dev',
          authorEmail: 'dev@localhost',
          authorDisplayName: 'Local Developer',
          tasks: [
            { id: 'task_1', text: 'Research PDF generation libraries', completed: false },
            { id: 'task_2', text: 'Create PDF export service', completed: false },
            { id: 'task_3', text: 'Add export button to UI', completed: false },
            { id: 'task_4', text: 'Test export with different data formats', completed: false }
          ],
          status: 'open',
          createdAt: mockDate,
          updatedAt: mockDate
        },
        
        // Mock ticket 3: Improvement (completed)
        {
          id: 'mock_improvement_1',
          title: 'Optimize chart rendering performance',
          type: 'improvement',
          isAnonymous: false,
          authorId: 'local_dev',
          authorEmail: 'dev@localhost',
          authorDisplayName: 'Local Developer',
          tasks: [
            { id: 'task_1', text: 'Profile chart rendering bottlenecks', completed: true },
            { id: 'task_2', text: 'Implement data point sampling', completed: true },
            { id: 'task_3', text: 'Add virtualization for large datasets', completed: true }
          ],
          status: 'completed',
          completedAt: mockDate,
          createdAt: mockDate,
          updatedAt: mockDate
        },
        
        // Mock ticket 4: Question (rejected)
        {
          id: 'mock_question_1',
          title: 'How to configure custom alarm thresholds?',
          type: 'question',
          isAnonymous: false,
          authorId: 'local_dev',
          authorEmail: 'dev@localhost',
          authorDisplayName: 'Local Developer',
          tasks: [
            { id: 'task_1', text: 'Check documentation for alarm settings', completed: false },
            { id: 'task_2', text: 'Test custom threshold configuration', completed: false }
          ],
          status: 'rejected',
          rejectionReason: 'Already documented in user manual section 4.2',
          rejectedBy: 'local_dev',
          rejectedAt: mockDate,
          createdAt: mockDate,
          updatedAt: mockDate
        }
      ];
      
      console.log('[useTickets] ✅ Loaded 4 mock tickets for localhost');
      setTickets(mockTickets);
      return; // Skip Firebase entirely on localhost
    }

    // Production: use Firebase
    if (!firestoreDB) {
      console.log('[useTickets] No Firestore DB available');
      return;
    }

    console.log('[useTickets] Setting up Firestore listener...');

    const ticketsRef = collection(firestoreDB, 'tickets');
    const ticketsQuery = query(ticketsRef, orderBy('createdAt', 'desc'));

    // FIXED: Capture current permission state to avoid dependency on hasPermission function
    const isDeveloper = hasPermission('developer');

    const unsubscribe = onSnapshot(ticketsQuery, (snapshot) => {
      const ticketsList: Ticket[] = [];
      
      snapshot.forEach((doc) => {
        const data = doc.data() as Omit<Ticket, 'id'>;
        const ticket: Ticket = { id: doc.id, ...data };
        
        // Show anonymous tickets only to developers
        if (ticket.isAnonymous && !isDeveloper) {
          return;
        }
        
        ticketsList.push(ticket);
      });
      
      setTickets(ticketsList);
    });

    return () => unsubscribe();
  }, [user?.role]); // FIXED: Depend on user.role instead of hasPermission to reduce re-renders

  // Create new ticket
  const createTicket = useCallback(async (
    title: string,
    type: TicketType,
    tasks: string[],
    isAnonymous: boolean
  ): Promise<boolean> => {
    if (!user || !firestoreDB) {
      showError('Authentication required');
      return false;
    }

    try {
      setIsLoading(true);
      
      const ticketTasks: TicketTask[] = tasks.map((text, index) => ({
        id: `task_${index}`,
        text,
        completed: false
      }));

      const ticketData = {
        title,
        type,
        isAnonymous,
        authorId: user.uid,
        authorEmail: user.email || '',
        authorDisplayName: user.displayName || user.email || 'Unknown',
        tasks: ticketTasks,
        status: 'open' as const,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };

      await addDoc(collection(firestoreDB, 'tickets'), ticketData);
      showSuccess('Ticket created successfully!');
      return true;
    } catch (error) {
      console.error('Error creating ticket:', error);
      showError('Failed to create ticket');
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [user, showSuccess, showError]);

  // Toggle task completion (developer only)
  const toggleTask = useCallback(async (
    ticketId: string, 
    taskId: string, 
    completed: boolean
  ): Promise<boolean> => {
    if (!user || (user.role !== 'developer' && user.role !== 'super_admin') || !firestoreDB) {
      showError('Developer access required');
      return false;
    }

    try {
      const ticket = tickets.find(t => t.id === ticketId);
      if (!ticket) return false;

      const updatedTasks = ticket.tasks.map(task => {
        if (task.id === taskId) {
          return {
            ...task,
            completed,
            completedBy: completed ? user.uid : undefined,
            completedAt: completed ? Timestamp.now() : undefined
          };
        }
        return task;
      });

      const completedCount = updatedTasks.filter(t => t.completed).length;
      const progress = completedCount / updatedTasks.length;
      let status = ticket.status;
      
      if (progress === 1 && status !== 'completed') {
        status = 'completed';
      } else if (progress > 0 && progress < 1 && status === 'open') {
        status = 'in_progress';
      }

      await updateDoc(doc(firestoreDB, 'tickets', ticketId), {
        tasks: updatedTasks,
        status,
        updatedAt: serverTimestamp(),
        ...(status === 'completed' && { completedAt: serverTimestamp() })
      });

      return true;
    } catch (error) {
      console.error('Error updating task:', error);
      showError('Failed to update task');
      return false;
    }
  }, [user, tickets, showError]);

  // Reject ticket (developer only)
  const rejectTicket = useCallback(async (
    ticketId: string,
    reason: string
  ): Promise<boolean> => {
    if (!user || (user.role !== 'developer' && user.role !== 'super_admin') || !firestoreDB) {
      showError('Developer access required');
      return false;
    }

    try {
      await updateDoc(doc(firestoreDB, 'tickets', ticketId), {
        status: 'rejected',
        rejectionReason: reason,
        rejectedBy: user.uid,
        rejectedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      showSuccess('Ticket rejected');
      return true;
    } catch (error) {
      console.error('Error rejecting ticket:', error);
      showError('Failed to reject ticket');
      return false;
    }
  }, [user, showSuccess, showError]);

  // Delete ticket
  const deleteTicket = useCallback(async (ticketId: string): Promise<boolean> => {
    if (!user || !firestoreDB) return false;

    // Check permissions - user can delete own tickets if not started, admins can delete any
    const ticket = tickets.find(t => t.id === ticketId);
    if (!ticket) return false;

    const canDelete = 
      (ticket.authorId === user.uid && ticket.status === 'open') || // Own ticket, not started
      user.role === 'developer' || // Developer can delete any
      user.role === 'super_admin'; // Super admin can delete any

    if (!canDelete) {
      showError('You do not have permission to delete this ticket');
      return false;
    }

    try {
      const ticketRef = doc(firestoreDB, 'tickets', ticketId);
      await deleteDoc(ticketRef);

      showSuccess('Ticket deleted successfully');
      return true;
    } catch (error) {
      console.error('Error deleting ticket:', error);
      showError('Failed to delete ticket');
      return false;
    }
  }, [user, tickets, showSuccess, showError]);

  // Update ticket (user can edit own tickets if not started)
  const updateTicket = useCallback(async (
    ticketId: string, 
    updates: { title?: string; type?: TicketType; tasks?: string[] }
  ): Promise<boolean> => {
    if (!user || !firestoreDB) return false;

    // Check if user can edit - only own tickets and only if not started
    const ticket = tickets.find(t => t.id === ticketId);
    if (!ticket || ticket.authorId !== user.uid || ticket.status !== 'open') {
      showError('You can only edit your own tickets that haven\'t been started');
      return false;
    }

    try {
      const ticketRef = doc(firestoreDB, 'tickets', ticketId);
      const updateData: any = {
        updatedAt: serverTimestamp()
      };

      if (updates.title) updateData.title = updates.title;
      if (updates.type) updateData.type = updates.type;
      if (updates.tasks) {
        // Convert tasks to proper format
        updateData.tasks = updates.tasks.filter(t => t.trim()).map((task, index) => ({
          id: `task_${Date.now()}_${index}`,
          text: task.trim(),
          completed: false
        }));
      }

      await updateDoc(ticketRef, updateData);

      showSuccess('Ticket updated successfully');
      return true;
    } catch (error) {
      console.error('Error updating ticket:', error);
      showError('Failed to update ticket');
      return false;
    }
  }, [user, tickets, showSuccess, showError]);

  // Helper functions for permissions
  const canDeleteTicket = useCallback((ticket: Ticket): boolean => {
    if (!user) return false;
    
    const isOwn = ticket.authorId === user.uid && ticket.status === 'open';
    const isDev = user.role === 'developer' || user.role === 'super_admin';
    const canDelete = isOwn || isDev;
    
    return canDelete;
  }, [user]);

  const canEditTicket = useCallback((ticket: Ticket): boolean => {
    if (!user) return false;
    return ticket.authorId === user.uid && ticket.status === 'open';
  }, [user]);

  // Sort tickets: Active first, then completed/rejected (for collapsing)
  const sortedTickets = [...tickets].sort((a, b) => {
    // Priority: open > in_progress > completed/rejected
    const statusPriority = { 'open': 0, 'in_progress': 1, 'completed': 2, 'rejected': 2 };
    const aPriority = statusPriority[a.status] || 3;
    const bPriority = statusPriority[b.status] || 3;
    
    if (aPriority !== bPriority) {
      return aPriority - bPriority;
    }
    
    // Within same status, sort by creation date (newest first)
    return (b.createdAt?.toDate().getTime() || 0) - (a.createdAt?.toDate().getTime() || 0);
  });

  return {
    tickets: sortedTickets,
    isLoading,
    createTicket,
    toggleTask,
    rejectTicket,
    deleteTicket,
    updateTicket,
    canDeleteTicket,
    canEditTicket,
    canCreateTickets: user && user.role !== 'pending',
    isDeveloper: user?.role === 'developer' || user?.role === 'super_admin',
    isSuperAdminOrDeveloper: user?.role === 'developer' || user?.role === 'super_admin'
  };
}; 