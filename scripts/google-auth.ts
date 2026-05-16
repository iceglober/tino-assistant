#!/usr/bin/env tsx
/**
 * One-off script to obtain a Google OAuth refresh token.
 *
 * Usage:
 *   pnpm tsx scripts/google-auth.ts
 *   pnpm tsx scripts/google-auth.ts --scopes "https://www.googleapis.com/auth/calendar.readonly,https://www.googleapis.com/auth/gmail.readonly"
 *
 * What it does:
 *   1. Reads GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET from .env
 *   2. Starts a localhost HTTP server on port 42069
 *   3. Opens the Google consent URL in your default browser
 *   4. Receives the auth code callback
 *   5. Exchanges the code for tokens
 *   6. Prints the refresh token
 *   7. Exits
 *
 * Paste the printed refresh token into .env as GOOGLE_OAUTH_REFRESH_TOKEN.
 *
 * Re-run with expanded --scopes when adding new Google APIs (e.g., Phase 7
 * adds gmail.readonly). Each re-run generates a NEW refresh token that
 * replaces the old one.
 */
import "dotenv/config";
import http from "node:http";
import { URL } from "node:url";
import { google } from "googleapis";

const DEFAULT_SCOPES = "https://www.googleapis.com/auth/calendar.readonly";
const PORT = 42069;
const REDIRECT_URI = `http://localhost:${PORT}`;

// Parse --scopes arg
const scopesArg = process.argv.find((_, i, arr) => arr[i - 1] === "--scopes");
const scopes = (scopesArg ?? DEFAULT_SCOPES).split(",").map((s) => s.trim());

const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error("ERROR: GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET must be set in .env");
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  prompt: "consent", // force consent to always get a refresh token
  scope: scopes,
});

console.log(`\nOpening browser for Google OAuth consent...\n`);
console.log(`If the browser doesn't open, visit:\n${authUrl}\n`);

// Open browser (macOS)
import("node:child_process").then((cp) => {
  cp.exec(`open "${authUrl}"`);
});

// Start server to receive the callback
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const code = url.searchParams.get("code");

  if (!code) {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("No code received. Try again.");
    return;
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);

    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<h1>✓ Auth complete</h1><p>You can close this tab.</p>");

    console.log("\n✓ Auth successful!\n");
    if (tokens.refresh_token) {
      console.log("Add this to your .env:\n");
      console.log(`GOOGLE_OAUTH_REFRESH_TOKEN=${tokens.refresh_token}\n`);
    } else {
      console.log("WARNING: No refresh token returned. This happens when you've already");
      console.log("authorized this app. Revoke access at https://myaccount.google.com/permissions");
      console.log("and re-run this script.\n");
      if (tokens.access_token) {
        console.log(`(Access token received: ${tokens.access_token.slice(0, 20)}...)`);
      }
    }
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Token exchange failed. Check the console.");
    console.error("Token exchange failed:", err);
  }

  server.close();
  process.exit(0);
});

server.listen(PORT, () => {
  console.log(`Listening on http://localhost:${PORT} for OAuth callback...\n`);
});
