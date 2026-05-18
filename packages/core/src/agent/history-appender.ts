import type { ModelMessage } from "ai";
import type { HistoryStore } from "./history.js";

export interface PrivacyFilterResult {
  persist: boolean;
  placeholder?: string;
}

export interface PrivacyFilter {
  filter(userId: string, messages: ModelMessage[]): Promise<ModelMessage[]>;
}

export class HistoryAppender {
  constructor(
    private historyStore: HistoryStore,
    private privacyFilter: PrivacyFilter,
  ) {}

  async append(userId: string, messages: ModelMessage[]): Promise<void> {
    const filtered = await this.privacyFilter.filter(userId, messages);
    await this.historyStore.append(userId, filtered);
  }
}

export class DefaultPrivacyFilter implements PrivacyFilter {
  async filter(_userId: string, messages: ModelMessage[]): Promise<ModelMessage[]> {
    return messages;
  }
}
