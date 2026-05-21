export type KundenTicketStatus = 'new' | 'in_review' | 'resolved';

export interface KundenTicketAuthor {
  uid: string | null;
  email: string | null;
  displayName: string | null;
  role: string | null;
}

export interface KundenTicketStovePassport {
  modelName: string;
  stoveSerial: string;
  controllerSerial: string;
  currentControllerSerial: string;
  imageUrl?: string;
}

export interface KundenTicketStatusSnapshot {
  health: 'good' | 'bad';
  headline: string;
  details: string;
  safeHints: string[];
  aiRecommendations?: string;
}

/**
 * Internal note left on a ticket by staff. Visible to admin/developer/super_admin
 * only — dealers never see this thread. We use a millisecond client timestamp
 * (not serverTimestamp) because Firestore disallows server timestamps inside
 * array elements; clock skew of a few seconds is fine for a comment thread.
 */
export interface KundenTicketNote {
  id: string;
  text: string;
  authorUid: string | null;
  authorName: string | null;
  authorRole: string | null;
  createdAt: number;
}

export interface KundenTicket {
  id: string;
  status: KundenTicketStatus;
  deviceId: string;
  stovePassport: KundenTicketStovePassport;
  statusSnapshot: KundenTicketStatusSnapshot;
  customerQuestion: string;
  geminiAnswer: string;
  pageSummary: string;
  source: 'dealer_mode';
  author: KundenTicketAuthor;
  createdAt: any;
  updatedAt: any;
  /** Optional — older tickets predating the notes feature have no array. */
  notes?: KundenTicketNote[];
}

export interface CreateKundenTicketInput {
  deviceId: string;
  stovePassport: KundenTicketStovePassport;
  statusSnapshot: KundenTicketStatusSnapshot;
  customerQuestion: string;
  geminiAnswer: string;
  pageSummary: string;
  author: KundenTicketAuthor;
}
