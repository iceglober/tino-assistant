import type { CalendarEvent, CalendarPort as DiscoveryCalendarPort } from "../../discovery/calendar-port.js";
import type { DiscoveryResult } from "../../discovery/types.js";
import type { CalendarPort, ContactSample, DMSample, EmailPort, EmailSample, MessagingPort } from "../ports.js";
import type { ScanResult, ScanSuggestion } from "../scan-types.js";
import type { CalendarVisibility, PrivacyContact, PrivacyConversation, PrivacyLabel } from "../types.js";

const LABELS: PrivacyLabel[] = [
  { name: "INBOX", itemCount: 1842 },
  { name: "Personal", itemCount: 312 },
  { name: "Finance", itemCount: 187 },
  { name: "HR", itemCount: 94 },
  { name: "Receipts", itemCount: 276 },
  { name: "Legal", itemCount: 43 },
  { name: "Medical", itemCount: 18 },
  { name: "Travel", itemCount: 156 },
  { name: "Newsletters", itemCount: 523 },
  { name: "Shopping", itemCount: 201 },
  { name: "Family", itemCount: 67 },
  { name: "Therapy", itemCount: 12 },
  { name: "Work", itemCount: 891 },
  { name: "Vendor Updates", itemCount: 340 },
  { name: "Private", itemCount: 29 },
];

const CONTACTS: PrivacyContact[] = [
  { address: "alice@company.com", displayName: "Alice Chen", itemCount: 234 },
  { address: "bob@company.com", displayName: "Bob Martinez", itemCount: 189 },
  { address: "carol@company.com", displayName: "Carol Kim", itemCount: 156 },
  { address: "doctor@medcenter.com", displayName: "Dr. Sarah Williams", itemCount: 14 },
  { address: "hr@company.com", displayName: "HR Department", itemCount: 42 },
  { address: "finance@company.com", displayName: "Finance Team", itemCount: 38 },
  { address: "dave@vendor.io", displayName: "Dave (Vendor)", itemCount: 67 },
  { address: "support@stripe.com", displayName: "Stripe Support", itemCount: 23 },
  { address: "noreply@github.com", displayName: "GitHub", itemCount: 412 },
  { address: "therapist@wellness.org", displayName: "Dr. James Park", itemCount: 8 },
  { address: "lawyer@firm.com", displayName: "Legal Counsel", itemCount: 15 },
  { address: "spouse@personal.com", displayName: "Partner", itemCount: 87 },
  { address: "tax@accountant.com", displayName: "Tax Advisor", itemCount: 11 },
  { address: "team@linear.app", displayName: "Linear", itemCount: 198 },
  { address: "notifications@slack.com", displayName: "Slack", itemCount: 302 },
];

const DMS: PrivacyConversation[] = [
  { id: "D001", participantId: "U001", participantName: "Alice Chen", itemCount: 342 },
  { id: "D002", participantId: "U002", participantName: "Bob Martinez", itemCount: 198 },
  { id: "D003", participantId: "U003", participantName: "Carol Kim", itemCount: 156 },
  { id: "D004", participantId: "U004", participantName: "Dave (Ops)", itemCount: 89 },
  { id: "D005", participantId: "U005", participantName: "Dr. Therapy Bot", itemCount: 4 },
  { id: "D006", participantId: "U006", participantName: "HR Manager", itemCount: 23 },
  { id: "D007", participantId: "U007", participantName: "Finance Lead", itemCount: 31 },
  { id: "D008", participantId: "U008", participantName: "Legal Review", itemCount: 12 },
  { id: "D009", participantId: "U009", participantName: "Personal Friend", itemCount: 45 },
  { id: "D010", participantId: "U010", participantName: "Family Group", itemCount: 67 },
];

const CALENDARS: CalendarVisibility = {
  defaultVisibility: "public",
  calendars: [
    { id: "primary", name: "Work Calendar" },
    { id: "personal@gmail.com", name: "Personal" },
    { id: "team@company.com", name: "Team Syncs" },
    { id: "holidays@group.v.calendar.google.com", name: "US Holidays" },
  ],
};

const SAMPLE_SUBJECTS: Record<string, string[]> = {
  Medical: [
    "Lab Results - Quest Diagnostics",
    "Prescription Refill Reminder",
    "Appointment Confirmation - Dr. Williams",
  ],
  Finance: ["Your W-2 is ready", "Monthly Statement - Chase ****4821", "401(k) Contribution Update"],
  HR: ["Benefits Enrollment Deadline", "Performance Review Scheduled", "PTO Balance Update"],
  Legal: ["NDA - Signature Required", "Contract Amendment - Review", "Compliance Training Due"],
  Receipts: ["CVS Pharmacy Receipt", "Blue Cross Blue Shield - EOB", "Amazon Order #112-3456"],
  Personal: ["Dinner Saturday?", "Flight Confirmation - LAX to JFK", "Happy Birthday!"],
  Family: ["Soccer Practice Schedule", "School Picture Day", "Holiday Gathering Plans"],
  Therapy: ["Session Notes - Follow-up", "Appointment Reminder - Thursday 3pm"],
  Private: ["Account Recovery Code", "Two-Factor Authentication", "Password Reset"],
  Work: ["Sprint Planning - Q3", "Code Review: PR #482", "Team Standup Notes"],
  "Vendor Updates": ["New API version available", "Service maintenance window", "Billing update"],
  Newsletters: ["TechCrunch Daily", "Morning Brew", "The Pragmatic Engineer"],
  Travel: ["Hotel Confirmation - Marriott", "Rental Car Pickup Details", "TSA PreCheck Renewal"],
  Shopping: ["Your order has shipped", "Price drop alert", "Return label enclosed"],
  INBOX: ["Re: Project timeline", "Meeting moved to 2pm", "Quick question about the API"],
};

const CONTACT_SUBJECTS: Record<string, string[]> = {
  "doctor@medcenter.com": [
    "Lab Results - Annual Physical",
    "Prescription Refill: Lisinopril",
    "Appointment Reminder: Tuesday 10am",
  ],
  "therapist@wellness.org": [
    "Session Recap - Anxiety Management",
    "Homework: Thought Journal",
    "Rescheduled to Thursday 3pm",
  ],
  "lawyer@firm.com": ["NDA Review - Final Draft", "Employment Agreement Amendment", "Quick question about non-compete"],
  "hr@company.com": ["Benefits Open Enrollment Deadline", "Updated PTO Policy", "Performance Review Scheduled"],
  "finance@company.com": ["Q3 Budget Review", "Expense Report Approved", "Payroll Schedule Change"],
  "tax@accountant.com": ["2025 Tax Return Draft", "Missing W-2 from Contractor", "Estimated Quarterly Payment Due"],
  "spouse@personal.com": ["Dinner plans tonight?", "School called — pickup at 3", "Don't forget the dry cleaning"],
  "alice@company.com": ["Re: Sprint Planning", "PR Review: auth refactor", "Can you join the 2pm?"],
  "bob@company.com": ["Deploy checklist for v2.4", "On-call handoff notes", "Lunch?"],
  "carol@company.com": ["Design review feedback", "Updated wireframes attached", "Sync on roadmap priorities"],
  "dave@vendor.io": ["API v3 migration timeline", "Invoice #4821 attached", "Onboarding call Thursday"],
  "support@stripe.com": ["Payment #py_abc123 succeeded", "API key rotation reminder", "Webhook endpoint failing"],
  "noreply@github.com": ["[kn-eng/kn-eng] PR #482 merged", "Dependabot alert: lodash", "New issue: Login timeout"],
  "team@linear.app": ["KN-342 assigned to you", "Sprint 23 completed", "Backlog grooming tomorrow"],
  "notifications@slack.com": ["You were mentioned in #general", "New DM from Carol Kim", "Reminder: standup in 10 min"],
};

const DM_MESSAGES: Record<string, string[]> = {
  D001: ["hey, can you review the PR when you get a chance?", "the deploy looks good, nice work", "standup in 5"],
  D002: ["on-call handoff: no open incidents", "heads up — the CI pipeline is slow today", "good to merge"],
  D003: ["updated the figma, take a look", "the client wants to move the deadline up", "can we sync at 3?"],
  D004: ["CPU alert on prod-web-3 cleared", "rotating secrets tonight at 11pm", "all green after the patch"],
  D005: ["reminder: session Thursday 3pm", "here's the worksheet we discussed", "how did the breathing exercise go?"],
  D006: ["your PTO request is approved", "we need to discuss comp adjustments", "open enrollment ends Friday"],
  D007: ["Q3 budget is approved", "please submit expenses by EOD", "payroll runs tomorrow"],
  D008: [
    "NDA is signed — see attached",
    "any concerns with the non-compete clause?",
    "contract renewal due next month",
  ],
  D009: ["dinner Saturday?", "that movie was amazing", "lol check this out"],
  D010: ["soccer practice moved to 4pm", "happy birthday!!!", "who's bringing dessert?"],
};

export function createMockEmailAdapter(): EmailPort {
  return {
    async getLabels(): Promise<PrivacyLabel[]> {
      return LABELS;
    },
    async getContacts(): Promise<PrivacyContact[]> {
      return CONTACTS;
    },
    async getSampleSubjects(_userId: string, opts?: { maxPerLabel?: number }): Promise<EmailSample[]> {
      const max = opts?.maxPerLabel ?? 5;
      return LABELS.map((l) => ({
        label: l.name,
        subjects: (SAMPLE_SUBJECTS[l.name] ?? ["General email"]).slice(0, max),
      }));
    },
    async getContactSamples(
      _userId: string,
      addresses: string[],
      opts?: { maxPerContact?: number },
    ): Promise<ContactSample[]> {
      const max = opts?.maxPerContact ?? 3;
      return addresses.map((addr) => ({
        address: addr,
        subjects: (CONTACT_SUBJECTS[addr] ?? ["General email"]).slice(0, max),
      }));
    },
  };
}

const MOCK_EVENTS: CalendarEvent[] = [
  {
    title: "Team Standup",
    attendees: ["alice@company.com", "bob@company.com", "carol@company.com"],
    startTime: Date.now() - 86400000,
    recurrence: "RRULE:FREQ=DAILY",
  },
  {
    title: "Sprint Planning",
    attendees: ["alice@company.com", "bob@company.com", "carol@company.com", "dave@vendor.io"],
    startTime: Date.now() - 604800000,
    recurrence: "RRULE:FREQ=WEEKLY",
  },
  {
    title: "1:1 with Alice",
    attendees: ["alice@company.com"],
    startTime: Date.now() - 172800000,
    recurrence: "RRULE:FREQ=WEEKLY",
  },
  { title: "Design Review", attendees: ["carol@company.com", "dave@vendor.io"], startTime: Date.now() - 259200000 },
  {
    title: "Quarterly Planning",
    attendees: ["alice@company.com", "bob@company.com", "carol@company.com", "hr@company.com", "finance@company.com"],
    startTime: Date.now() - 2592000000,
  },
  {
    title: "Vendor Sync",
    attendees: ["dave@vendor.io"],
    startTime: Date.now() - 432000000,
    recurrence: "RRULE:FREQ=MONTHLY",
  },
  {
    title: "Architecture Review",
    attendees: ["alice@company.com", "bob@company.com"],
    startTime: Date.now() - 345600000,
  },
];

export function createMockCalendarAdapter(): CalendarPort & DiscoveryCalendarPort {
  return {
    async getVisibility(): Promise<CalendarVisibility> {
      return CALENDARS;
    },
    async getEvents(): Promise<CalendarEvent[]> {
      return MOCK_EVENTS;
    },
  };
}

export function createMockMessagingAdapter(): MessagingPort {
  return {
    async getDMs(): Promise<PrivacyConversation[]> {
      return DMS;
    },
    async getDMSamples(
      _userId: string,
      conversationIds: string[],
      opts?: { maxPerConversation?: number },
    ): Promise<DMSample[]> {
      const max = opts?.maxPerConversation ?? 3;
      return conversationIds.map((id) => ({
        id,
        messages: (DM_MESSAGES[id] ?? ["Hey, how's it going?"]).slice(0, max),
      }));
    },
  };
}

const MOCK_LABEL_SUGGESTIONS: ScanSuggestion[] = [
  {
    id: "Medical",
    sensitive: true,
    reason: "Contains medical correspondence (lab results, prescriptions, appointment confirmations)",
    confidence: "high",
  },
  {
    id: "Finance",
    sensitive: true,
    reason: "Contains financial records (tax documents, bank statements, investment updates)",
    confidence: "high",
  },
  {
    id: "HR",
    sensitive: true,
    reason: "Contains HR communications (benefits, performance reviews, compensation)",
    confidence: "high",
  },
  {
    id: "Legal",
    sensitive: true,
    reason: "Contains legal documents (NDAs, contracts, compliance materials)",
    confidence: "high",
  },
  {
    id: "Receipts",
    sensitive: true,
    reason: "Contains purchase receipts that may reveal medical or financial details (pharmacy, insurance EOBs)",
    confidence: "medium",
  },
  {
    id: "Personal",
    sensitive: true,
    reason: "Contains personal communications (travel plans, social arrangements)",
    confidence: "medium",
  },
  {
    id: "Family",
    sensitive: true,
    reason: "Contains family communications (children's schedules, personal events)",
    confidence: "medium",
  },
  {
    id: "Therapy",
    sensitive: true,
    reason: "Contains mental health-related correspondence (session notes, appointment reminders)",
    confidence: "high",
  },
  {
    id: "Private",
    sensitive: true,
    reason: "Contains account security information (recovery codes, 2FA tokens)",
    confidence: "high",
  },
  {
    id: "Work",
    sensitive: false,
    reason: "Standard work communications (planning, code reviews, standup notes)",
    confidence: "high",
  },
  {
    id: "INBOX",
    sensitive: false,
    reason: "General inbox with mixed content — review individual messages",
    confidence: "low",
  },
  {
    id: "Vendor Updates",
    sensitive: false,
    reason: "Automated vendor notifications (API updates, maintenance windows)",
    confidence: "high",
  },
  { id: "Newsletters", sensitive: false, reason: "Public newsletter subscriptions", confidence: "high" },
  {
    id: "Travel",
    sensitive: true,
    reason: "Contains travel itineraries revealing location and schedule",
    confidence: "medium",
  },
  {
    id: "Shopping",
    sensitive: false,
    reason: "Standard e-commerce notifications (shipping, order confirmations)",
    confidence: "medium",
  },
];

const MOCK_CONTACT_SUGGESTIONS: ScanSuggestion[] = [
  {
    id: "doctor@medcenter.com",
    sensitive: true,
    reason: "Frequent contact with a medical provider",
    confidence: "high",
  },
  {
    id: "therapist@wellness.org",
    sensitive: true,
    reason: "Mental health provider — therapy-related correspondence",
    confidence: "high",
  },
  { id: "lawyer@firm.com", sensitive: true, reason: "Legal counsel — privileged communications", confidence: "high" },
  {
    id: "hr@company.com",
    sensitive: true,
    reason: "HR department — may contain compensation, benefits, or personnel issues",
    confidence: "medium",
  },
  {
    id: "tax@accountant.com",
    sensitive: true,
    reason: "Tax advisor — contains financial and tax records",
    confidence: "high",
  },
  {
    id: "spouse@personal.com",
    sensitive: true,
    reason: "Personal/family contact with high message volume",
    confidence: "medium",
  },
  {
    id: "finance@company.com",
    sensitive: true,
    reason: "Finance team — may contain payroll or expense details",
    confidence: "medium",
  },
  {
    id: "alice@company.com",
    sensitive: false,
    reason: "Work colleague — standard professional communication",
    confidence: "high",
  },
  {
    id: "bob@company.com",
    sensitive: false,
    reason: "Work colleague — standard professional communication",
    confidence: "high",
  },
  {
    id: "carol@company.com",
    sensitive: false,
    reason: "Work colleague — standard professional communication",
    confidence: "high",
  },
  { id: "dave@vendor.io", sensitive: false, reason: "Vendor contact — business communications", confidence: "high" },
  {
    id: "support@stripe.com",
    sensitive: false,
    reason: "Payment platform support — automated responses",
    confidence: "medium",
  },
  { id: "noreply@github.com", sensitive: false, reason: "Automated GitHub notifications", confidence: "high" },
  { id: "team@linear.app", sensitive: false, reason: "Project management notifications", confidence: "high" },
  { id: "notifications@slack.com", sensitive: false, reason: "Automated Slack notifications", confidence: "high" },
];

const MOCK_DM_SUGGESTIONS: ScanSuggestion[] = [
  { id: "D005", sensitive: true, reason: "Conversation with mental health-related contact", confidence: "high" },
  {
    id: "D006",
    sensitive: true,
    reason: "HR manager — may contain personnel or compensation discussions",
    confidence: "medium",
  },
  {
    id: "D008",
    sensitive: true,
    reason: "Legal review channel — may contain privileged information",
    confidence: "high",
  },
  { id: "D009", sensitive: true, reason: "Personal friend — non-work communications", confidence: "medium" },
  { id: "D010", sensitive: true, reason: "Family group — personal communications", confidence: "medium" },
  {
    id: "D007",
    sensitive: true,
    reason: "Finance lead — may contain budget or compensation details",
    confidence: "medium",
  },
  { id: "D001", sensitive: false, reason: "High-volume work colleague — standard collaboration", confidence: "high" },
  { id: "D002", sensitive: false, reason: "Work colleague — standard collaboration", confidence: "high" },
  { id: "D003", sensitive: false, reason: "Work colleague — standard collaboration", confidence: "high" },
  { id: "D004", sensitive: false, reason: "Ops team member — operational discussions", confidence: "high" },
];

export function createMockDiscoveryResult(): DiscoveryResult {
  return {
    roleSummary:
      "Software engineering lead focused on backend services and infrastructure. Primary responsibilities include code review, sprint planning, and vendor management. Frequently coordinates with design and operations teams.",
    inferredTitle: "Engineering Lead",
    inferredDepartment: "Engineering",
    orgRelationships: [
      {
        name: "Alice Chen",
        email: "alice@company.com",
        relationship: "direct-report",
        context: "weekly 1:1, co-authors PRs, reviews your docs",
        interactionFrequency: "daily",
      },
      {
        name: "Bob Martinez",
        email: "bob@company.com",
        relationship: "peer",
        context: "on-call handoffs, deploy coordination",
        interactionFrequency: "daily",
      },
      {
        name: "Carol Kim",
        email: "carol@company.com",
        relationship: "cross-functional",
        context: "design reviews, roadmap syncs",
        interactionFrequency: "weekly",
      },
      {
        name: "Dave (Vendor)",
        email: "dave@vendor.io",
        relationship: "external",
        context: "API integration, vendor sync meetings",
        interactionFrequency: "monthly",
      },
    ],
    responsibilities: [
      {
        title: "Code Review",
        description: "Review pull requests from team members",
        timeHorizon: "daily",
        evidence: "GitHub notifications show daily PR review activity",
      },
      {
        title: "Sprint Planning",
        description: "Lead weekly sprint planning with the engineering team",
        timeHorizon: "weekly",
        evidence: "Recurring 'Sprint Planning' calendar event with full team",
      },
      {
        title: "1:1 Meetings",
        description: "Regular check-ins with direct reports",
        timeHorizon: "weekly",
        evidence: "Recurring '1:1 with Alice' calendar event",
      },
      {
        title: "Vendor Management",
        description: "Coordinate with external vendors on API integrations",
        timeHorizon: "monthly",
        evidence: "Recurring 'Vendor Sync' calendar event with dave@vendor.io",
      },
      {
        title: "Architecture Reviews",
        description: "Review and approve architectural decisions",
        timeHorizon: "ongoing",
        evidence: "Recurring 'Architecture Review' calendar events with engineering team",
      },
    ],
    communicationStyle: {
      summary:
        "Primarily communicates via Slack for quick coordination and email for formal updates. Prefers async communication with structured meeting cadences.",
      preferredChannels: ["slack", "email", "meetings"],
      patterns: ["responds quickly to DMs", "batches email replies", "schedules recurring syncs for ongoing work"],
    },
    workPatterns: {
      meetingLoad: "moderate (8-12 hrs/week)",
      peakHours: "mornings",
      recurringCommitments: [
        "daily standup 9am",
        "weekly sprint planning",
        "weekly 1:1s with direct reports",
        "monthly vendor sync",
      ],
      timeInvestment: [
        { category: "meetings", estimatedPct: 30, details: "Recurring standups, planning, and 1:1s" },
        { category: "code review", estimatedPct: 25, details: "Daily PR reviews from team members" },
        { category: "email", estimatedPct: 20, details: "Vendor coordination and cross-team communication" },
        { category: "Slack", estimatedPct: 15, details: "Team coordination and quick questions" },
        { category: "focus work", estimatedPct: 10, details: "Architecture and planning documents" },
      ],
    },
    painPoints: [
      "High volume of GitHub notifications may be causing context-switching",
      "Multiple recurring meetings could be consolidated",
      "Vendor coordination via email is manual and time-consuming",
    ],
    suggestions: [
      {
        title: "Automate standup summaries",
        description: "Generate daily standup summaries from Slack messages",
        capabilityId: "slack",
      },
      {
        title: "PR review reminders",
        description: "Track open PRs and send reminders for stale reviews",
        capabilityId: "github",
      },
      {
        title: "Meeting prep",
        description: "Generate agenda items from recent email threads before recurring meetings",
        capabilityId: "gmail",
      },
    ],
    analyzedAt: Date.now(),
    dataSourcesUsed: ["email", "calendar"],
  };
}

export function createMockScanResult(): ScanResult {
  return {
    email: {
      labels: MOCK_LABEL_SUGGESTIONS,
      contacts: MOCK_CONTACT_SUGGESTIONS,
    },
    messaging: {
      conversations: MOCK_DM_SUGGESTIONS,
    },
    scannedAt: Date.now(),
  };
}
