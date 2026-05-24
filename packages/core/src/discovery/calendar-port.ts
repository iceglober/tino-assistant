export interface CalendarEvent {
  title: string;
  attendees: string[];
  startTime: number;
  recurrence?: string;
}

export interface CalendarPort {
  getEvents(userId: string, opts?: { sinceDays?: number }): Promise<CalendarEvent[]>;
}
