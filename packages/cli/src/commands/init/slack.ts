import { select, input, password } from '@inquirer/prompts';
import type { DeployConfig } from './types.js';
import { displayStep, displaySuccess, displayWarning, displayInfo } from '../../utils/display.js';
import { validateSlackToken, pushSecret } from '../../utils/aws.js';
import { isSlackBotToken, isSlackAppToken } from '../../utils/validate.js';

/**
 * Step 6: Slack app setup.
 * Walks through app creation if needed, collects tokens, validates via Slack API,
 * and pushes tokens to Secrets Manager immediately (never written to disk).
 */
export async function stepSlack(config: Partial<DeployConfig>): Promise<Partial<DeployConfig>> {
  displayStep(6, 8, 'Slack App');

  const hasApp = await select({
    message: 'Have you created a Slack app for tino?',
    choices: [
      { name: 'Yes, I have the tokens', value: 'yes' },
      { name: 'No, walk me through it', value: 'no' },
    ],
    default: 'yes',
  });

  if (hasApp === 'no') {
    displayInfo("Let's create your Slack app:");
    displayInfo('  1. Go to https://api.slack.com/apps → Create New App → From scratch');
    displayInfo('  2. Name: "tino", Workspace: your workspace');
    displayInfo('  3. Enable Socket Mode → generate App-Level Token (xapp-)');
    displayInfo('  4. OAuth & Permissions → Bot scopes: im:history, im:read, im:write, chat:write');
    displayInfo('  5. Event Subscriptions → subscribe to: message.im');
    displayInfo('  6. Install to workspace → copy Bot Token (xoxb-)');
    displayInfo('');
    displayInfo('  Complete those steps, then come back here to paste your tokens.');
    displayInfo('');
  }

  // Collect bot token
  let botToken = '';
  let botTokenValid = false;

  while (!botTokenValid) {
    botToken = await password({
      message: 'Paste your Bot Token (xoxb-...):',
      mask: '*',
    });

    if (!isSlackBotToken(botToken)) {
      displayWarning('Bot token must start with xoxb-. Please try again.');
      continue;
    }

    displayInfo('Validating bot token with Slack API...');
    const result = await validateSlackToken(botToken);

    if (result.ok) {
      displaySuccess(`Bot token validated. Workspace: ${result.team ?? 'unknown'}`);
      botTokenValid = true;
    } else {
      displayWarning(`Token validation failed: ${result.error ?? 'unknown error'}. Please try again.`);
    }
  }

  // Collect app token
  let appToken = '';
  let appTokenValid = false;

  while (!appTokenValid) {
    appToken = await password({
      message: 'Paste your App Token (xapp-...):',
      mask: '*',
    });

    if (!isSlackAppToken(appToken)) {
      displayWarning('App token must start with xapp-. Please try again.');
      continue;
    }

    displayInfo('Validating app token with Slack API...');
    const result = await validateSlackToken(appToken);

    if (result.ok) {
      displaySuccess('App token validated.');
      appTokenValid = true;
    } else {
      // xapp- tokens may not pass auth.test — treat format check as sufficient
      displayInfo('App token format is valid (xapp- tokens may not respond to auth.test).');
      appTokenValid = true;
    }
  }

  // Push tokens to Secrets Manager immediately — never written to disk
  const region = config.region ?? 'us-east-1';
  displayInfo('Pushing tokens to Secrets Manager...');

  try {
    await pushSecret('/tino/SLACK_BOT_TOKEN', botToken, region);
    await pushSecret('/tino/SLACK_APP_TOKEN', appToken, region);
    displaySuccess('Tokens stored in Secrets Manager.');
  } catch (err) {
    displayWarning(
      `Could not push to Secrets Manager: ${err instanceof Error ? err.message : String(err)}`
    );
    displayInfo('  You can push them manually later:');
    displayInfo('  aws secretsmanager create-secret --name /tino/SLACK_BOT_TOKEN --secret-string <token>');
    displayInfo('  aws secretsmanager create-secret --name /tino/SLACK_APP_TOKEN --secret-string <token>');
  }

  // Collect admin user ID
  const adminUserId = await input({
    message: 'Your Slack User ID (the initial admin):',
    validate: (v) => {
      const trimmed = v.trim();
      if (trimmed.length === 0) return 'User ID cannot be empty';
      if (!trimmed.match(/^[UW][A-Z0-9]+$/)) {
        return 'Slack user IDs start with U or W followed by uppercase letters/numbers (e.g. U05S91V7LJF)';
      }
      return true;
    },
  });

  displaySuccess(`Admin user set: ${adminUserId.trim()}`);
  displayInfo('  Tip: Slack → your profile → ⋯ → Copy member ID');

  return {
    ...config,
    slack: {
      botTokenSet: true,
      appTokenSet: true,
      adminUserId: adminUserId.trim(),
    },
  };
}
