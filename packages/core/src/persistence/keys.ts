/**
 * Central partition-key module.
 *
 * Single-tenant: prefix is empty string. All keys look like 'USER#<id>...'.
 * Future managed-multi-tenant: prefix becomes 'TENANT#<tenantId>#'.
 *
 * No code path should construct partition keys without going through this module.
 */

export function tenantPrefix(): string {
  return "";
}

export function historyPk(userId: string): string {
  return `${tenantPrefix()}HISTORY#${userId}`;
}

export const HISTORY_SK = "HISTORY";

export function identityPk(provider: string, externalId: string): string {
  return `${tenantPrefix()}IDENTITY#${provider}#${externalId}`;
}

export function orgUserPk(tinoUserId: string): string {
  return `${tenantPrefix()}ORG#USER#${tinoUserId}`;
}

export const ORG_USER_PARTITION = "ORG#USER";

export function userCapPk(tinoUserId: string): string {
  return `${tenantPrefix()}USER#${tinoUserId}`;
}

export function capabilitySk(capabilityId: string): string {
  return `CAP#${capabilityId}`;
}

export const CAP_SK_PREFIX = "CAP#";

export const CONFIG_PK = "CONFIG";

export function configSk(key: string): string {
  return `${tenantPrefix()}CONFIG#${key}`;
}

export const CONFIG_SK_PREFIX = "CONFIG#";

export function sessionPk(key: string): string {
  return `${tenantPrefix()}SESSION#${key}`;
}
