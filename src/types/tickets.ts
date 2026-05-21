export type TicketType = 'bug' | 'feature' | 'improvement' | 'question';

export type TicketStatus = 'open' | 'in_progress' | 'completed' | 'rejected';

export interface TicketTask {
  id: string;
  text: string;
  completed: boolean;
  completedBy?: string;
  completedAt?: any; // Firebase timestamp
}

export interface Ticket {
  id: string;
  title: string;
  type: TicketType;
  isAnonymous: boolean;
  authorId: string;
  authorEmail: string;
  authorDisplayName: string;
  tasks: TicketTask[];
  status: TicketStatus;
  rejectionReason?: string;
  rejectedBy?: string;
  rejectedAt?: any;
  createdAt: any; // Firebase timestamp
  updatedAt: any; // Firebase timestamp
  completedAt?: any; // Firebase timestamp
}

export const TICKET_TYPE_LABELS: Record<TicketType, string> = {
  bug: 'Bug Report',
  feature: 'New Feature',
  improvement: 'Improvement',
  question: 'Question'
};

export const TICKET_TYPE_COLORS = {
  light: {
    bug: 'bg-red-100 border-red-300 text-red-950 shadow-sm',
    feature: 'bg-blue-100 border-blue-300 text-blue-950 shadow-sm', 
    improvement: 'bg-amber-100 border-amber-300 text-amber-950 shadow-sm',
    question: 'bg-purple-100 border-purple-300 text-purple-950 shadow-sm'
  },
  dark: {
    bug: 'bg-red-900/30 border-red-700 text-red-200 shadow-lg',
    feature: 'bg-blue-900/30 border-blue-700 text-blue-200 shadow-lg',
    improvement: 'bg-amber-900/30 border-amber-700 text-amber-200 shadow-lg', 
    question: 'bg-purple-900/30 border-purple-700 text-purple-200 shadow-lg'
  }
}; 