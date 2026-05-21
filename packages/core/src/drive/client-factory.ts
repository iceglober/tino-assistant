import { google } from "googleapis";
import type { GoogleCreds } from "../privacy/adapters/credentials.js";
import { createDriveAppDataClient } from "./app-data-client.js";
import type { AppDataClient } from "./types.js";

export function createAppDataClient(creds: GoogleCreds): AppDataClient {
  const auth = new google.auth.OAuth2(creds.clientId, creds.clientSecret);
  auth.setCredentials({ refresh_token: creds.refreshToken });
  const drive = google.drive({ version: "v3", auth });
  return createDriveAppDataClient(drive);
}
