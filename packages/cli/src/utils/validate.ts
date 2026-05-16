/**
 * Token format validators — check token prefixes without making network calls.
 */

export function isSlackBotToken(token: string): boolean {
  return token.startsWith("xoxb-");
}

export function isSlackAppToken(token: string): boolean {
  return token.startsWith("xapp-");
}

export function isSlackUserToken(token: string): boolean {
  return token.startsWith("xoxp-");
}

export function isGitHubPat(token: string): boolean {
  return token.startsWith("ghp_") || token.startsWith("github_pat_") || token.startsWith("gho_");
}

export function isLinearToken(token: string): boolean {
  return token.startsWith("lin_");
}

export function isGoogleClientId(clientId: string): boolean {
  return clientId.trim().endsWith(".apps.googleusercontent.com");
}
