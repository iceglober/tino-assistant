export interface DmMessageEvent {
  type: 'message';
  subtype?: string; // undefined for a normal user-typed message; 'bot_message', 'message_changed', etc. for everything else
  channel: string;
  channel_type: 'im' | 'mpim' | 'channel' | 'group';
  user: string;
  text?: string;
  ts: string;
  thread_ts?: string;
}
