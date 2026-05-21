import type { CalendarVisibility, PrivacyContact, PrivacyConversation, PrivacyLabel } from "./types.js";

export interface EmailSample {
  label: string;
  subjects: string[];
}

export interface ContactSample {
  address: string;
  subjects: string[];
}

export interface DMSample {
  id: string;
  messages: string[];
}

export interface EmailPort {
  getLabels(userId: string): Promise<PrivacyLabel[]>;
  getContacts(userId: string, opts?: { sinceDays?: number }): Promise<PrivacyContact[]>;
  getSampleSubjects(userId: string, opts?: { maxPerLabel?: number }): Promise<EmailSample[]>;
  getContactSamples(userId: string, addresses: string[], opts?: { maxPerContact?: number }): Promise<ContactSample[]>;
}

export interface CalendarPort {
  getVisibility(userId: string): Promise<CalendarVisibility>;
}

export interface MessagingPort {
  getDMs(userId: string): Promise<PrivacyConversation[]>;
  getDMSamples(userId: string, conversationIds: string[], opts?: { maxPerConversation?: number }): Promise<DMSample[]>;
}
