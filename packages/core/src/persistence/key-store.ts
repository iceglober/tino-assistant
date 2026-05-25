export interface UserKeyStorePort {
  getOrCreateKey(userId: string): Promise<Buffer | null>;
  evict(userId: string): void;
}
