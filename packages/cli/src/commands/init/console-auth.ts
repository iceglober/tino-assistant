import { input, password, select } from "@inquirer/prompts";
import { displayInfo, displayStep, displaySuccess } from "../../utils/display.js";
import type { DeployConfig } from "./types.js";

/**
 * Step 6: Console authentication setup.
 * Collects Google OAuth client ID, client secret, and allowed domain.
 * These are passed to TinoService at deploy time — no Slack tokens needed.
 */
export async function stepConsoleAuth(config: Partial<DeployConfig>): Promise<Partial<DeployConfig>> {
  displayStep(5, 6, "Console Authentication");

  displayInfo("  The tino console is protected by Google Sign-In.");
  displayInfo("  You need a GCP OAuth client (Web application type).");
  displayInfo("");

  // Walk through GCP setup if needed
  const hasClient = await select({
    message: "Do you have a Google OAuth Web client?",
    choices: [
      { name: "Yes, I have the client ID and secret", value: "yes" },
      { name: "No, walk me through creating one", value: "no" },
    ],
  });

  if (hasClient === "no") {
    displayInfo("");
    displayInfo("  Let's set up your Google OAuth client:");
    displayInfo("");
    displayInfo("  1. Go to https://console.cloud.google.com/apis/credentials");
    displayInfo("  2. Create credentials → OAuth client ID → Web application");
    displayInfo('  3. Name: "tino console"');
    displayInfo("  4. Authorized redirect URIs: (leave blank for now — add after deploy)");
    displayInfo("  5. Copy the Client ID and Client Secret");
    displayInfo("");
  }

  const clientId = await input({
    message: "Google OAuth Client ID:",
    validate: (v) => (v.includes(".apps.googleusercontent.com") ? true : "Should end with .apps.googleusercontent.com"),
  });

  const clientSecret = await password({
    message: "Google OAuth Client Secret:",
    mask: "*",
    validate: (v) => (v.trim().length > 0 ? true : "Required"),
  });

  const domain = await input({
    message: "Allowed email domain (e.g., kayn.ai):",
    validate: (v) => (v.includes(".") ? true : "Enter a domain like kayn.ai"),
  });

  displaySuccess(`Console auth: Google OAuth, restricted to @${domain.trim()}`);

  return {
    ...config,
    googleOAuthClientId: clientId.trim(),
    googleOAuthClientSecret: clientSecret.trim(),
    allowedDomain: domain.trim(),
  };
}
