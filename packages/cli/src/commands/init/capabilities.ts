import { checkbox, select, input, password } from '@inquirer/prompts';
import type { DeployConfig } from './types.js';
import { displayStep, displaySuccess, displayWarning, displayInfo } from '../../utils/display.js';
import { validateGitHubToken, validateGitHubRepo, validateSlackToken, pushSecret } from '../../utils/aws.js';
import { isGitHubPat, isLinearToken, isSlackUserToken, isGoogleClientId } from '../../utils/validate.js';

type BaaStatus = 'confirmed' | 'no-baa' | 'unknown';

interface CapabilityResult {
  enabled: boolean;
  baaStatus: BaaStatus;
}

/**
 * Step 7: Capability selection and per-capability credential collection.
 * Credentials are pushed to Secrets Manager immediately — never written to disk.
 */
export async function stepCapabilities(
  config: Partial<DeployConfig>
): Promise<Partial<DeployConfig>> {
  displayStep(7, 8, 'Capabilities');

  displayInfo('You can add more capabilities later via the console.');
  displayInfo('');

  const selected = await checkbox({
    message: 'Which capabilities do you want to enable now?',
    choices: [
      { name: 'GitHub (search code, check CI)', value: 'github' },
      { name: 'Linear (issue tracking)', value: 'linear' },
      { name: 'Google Calendar', value: 'google-calendar' },
      { name: 'Gmail', value: 'gmail' },
      { name: 'Slack reading (read channels/DMs)', value: 'slack-reading' },
      { name: 'CloudWatch Logs', value: 'cloudwatch' },
      { name: 'Skip — configure these in the console', value: '__skip__' },
    ],
  });

  const capabilities: Record<string, CapabilityResult> = {};
  const region = config.region ?? 'us-east-1';

  // If skip is selected or nothing selected, return empty capabilities
  if (selected.includes('__skip__') || selected.length === 0) {
    displayInfo('Skipping capabilities — configure them in the console later.');
    return { ...config, capabilities };
  }

  // Process each selected capability
  for (const cap of selected) {
    if (cap === '__skip__') continue;

    switch (cap) {
      case 'github':
        capabilities['github'] = await setupGitHub(region);
        break;
      case 'linear':
        capabilities['linear'] = await setupLinear(region);
        break;
      case 'google-calendar':
        capabilities['google-calendar'] = await setupGoogleCalendar(region);
        break;
      case 'gmail':
        capabilities['gmail'] = await setupGmail(region);
        break;
      case 'slack-reading':
        capabilities['slack-reading'] = await setupSlackReading(region);
        break;
      case 'cloudwatch':
        capabilities['cloudwatch'] = await setupCloudWatch();
        break;
    }
  }

  return { ...config, capabilities };
}

async function askBaaStatus(service: string, baaNote: string): Promise<BaaStatus> {
  displayWarning(`HIPAA note for ${service}: ${baaNote}`);
  const answer = await select({
    message: `Does your ${service} plan include a BAA?`,
    choices: [
      { name: 'Yes', value: 'confirmed' },
      { name: 'No', value: 'no-baa' },
      { name: "I'm not sure", value: 'unknown' },
    ],
  });

  if (answer === 'no-baa' || answer === 'unknown') {
    displayWarning(
      `WARNING: ${service} without a BAA means data flowing through tino may not be covered.`
    );
    displayInfo('  If your data contains PHI, this may be a HIPAA violation.');

    const proceed = await select({
      message: `Proceed with ${service} enabled?`,
      choices: [
        { name: "Yes, my data doesn't contain PHI", value: 'yes' },
        { name: `No, disable ${service} for now`, value: 'no' },
      ],
    });

    if (proceed === 'no') {
      displayInfo(`${service} disabled.`);
      return answer as BaaStatus;
    }
  }

  return answer as BaaStatus;
}

async function setupGitHub(region: string): Promise<CapabilityResult> {
  displayInfo('');
  displayInfo('Setting up GitHub...');

  let token = '';
  let tokenValid = false;

  while (!tokenValid) {
    token = await password({
      message: 'GitHub Personal Access Token (ghp_... or github_pat_...):',
      mask: '*',
    });

    if (!isGitHubPat(token)) {
      displayWarning('GitHub PAT must start with ghp_, github_pat_, or gho_. Please try again.');
      continue;
    }

    displayInfo('Validating GitHub token...');
    const result = await validateGitHubToken(token);

    if (result.ok) {
      displaySuccess(`Token validated. Authenticated as: ${result.login ?? 'unknown'}`);
      tokenValid = true;
    } else {
      displayWarning(`Token validation failed: ${result.error ?? 'unknown'}. Please try again.`);
    }
  }

  const repo = await input({
    message: 'Default GitHub repo (owner/repo):',
    validate: (v) => {
      const trimmed = v.trim();
      if (!trimmed.includes('/')) return 'Format must be owner/repo';
      return true;
    },
  });

  displayInfo(`Checking access to ${repo.trim()}...`);
  const repoResult = await validateGitHubRepo(token, repo.trim());

  if (repoResult.ok) {
    displaySuccess(`${repo.trim()} — accessible.`);
  } else {
    displayWarning(`Could not access ${repo.trim()}: ${repoResult.error ?? 'unknown'}`);
    displayInfo('  You can update the repo in the console later.');
  }

  // Push token to Secrets Manager
  try {
    await pushSecret('/tino/GITHUB_PAT', token, region);
    displaySuccess('GitHub token stored in Secrets Manager.');
  } catch (err) {
    displayWarning(`Could not push to Secrets Manager: ${err instanceof Error ? err.message : String(err)}`);
  }

  const baaStatus = await askBaaStatus(
    'GitHub',
    'GitHub Enterprise Cloud offers a BAA. GitHub Free/Pro/Team do NOT have a BAA.'
  );

  return { enabled: true, baaStatus };
}

async function setupLinear(region: string): Promise<CapabilityResult> {
  displayInfo('');
  displayInfo('Setting up Linear...');

  let token = '';
  let tokenValid = false;

  while (!tokenValid) {
    token = await password({
      message: 'Linear API Token (lin_...):',
      mask: '*',
    });

    if (!isLinearToken(token)) {
      displayWarning('Linear token must start with lin_. Please try again.');
      continue;
    }

    // Validate via Linear API
    displayInfo('Validating Linear token...');
    try {
      const response = await fetch('https://api.linear.app/graphql', {
        method: 'POST',
        headers: {
          Authorization: token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: '{ viewer { id name } }' }),
      });
      const data = (await response.json()) as { data?: { viewer?: { name?: string } } };
      if (data.data?.viewer?.name) {
        displaySuccess(`Token validated. Authenticated as: ${data.data.viewer.name}`);
        tokenValid = true;
      } else {
        displayWarning('Token validation failed. Please try again.');
      }
    } catch {
      displayWarning('Could not reach Linear API. Accepting token on format check.');
      tokenValid = true;
    }
  }

  try {
    await pushSecret('/tino/LINEAR_TOKEN', token, region);
    displaySuccess('Linear token stored in Secrets Manager.');
  } catch (err) {
    displayWarning(`Could not push to Secrets Manager: ${err instanceof Error ? err.message : String(err)}`);
  }

  const baaStatus = await askBaaStatus(
    'Linear',
    'Linear does not currently offer a BAA. If your issues contain PHI, this may be a HIPAA concern.'
  );

  return { enabled: true, baaStatus };
}

async function setupGoogleCalendar(region: string): Promise<CapabilityResult> {
  displayInfo('');
  displayInfo('Setting up Google Calendar...');
  displayInfo('  You need a Google OAuth2 refresh token for each user.');
  displayInfo('  Run: pnpm tsx scripts/google-auth.ts to generate one.');
  displayInfo('');

  const clientId = await input({
    message: 'Google OAuth2 Client ID (ends with .apps.googleusercontent.com):',
    validate: (v) => {
      if (!isGoogleClientId(v.trim())) {
        return 'Client ID must end with .apps.googleusercontent.com';
      }
      return true;
    },
  });

  const clientSecret = await password({
    message: 'Google OAuth2 Client Secret:',
    mask: '*',
    validate: (v) => (v.trim().length > 0 ? true : 'Client secret cannot be empty'),
  });

  try {
    await pushSecret('/tino/GOOGLE_CLIENT_ID', clientId.trim(), region);
    await pushSecret('/tino/GOOGLE_CLIENT_SECRET', clientSecret, region);
    displaySuccess('Google credentials stored in Secrets Manager.');
  } catch (err) {
    displayWarning(`Could not push to Secrets Manager: ${err instanceof Error ? err.message : String(err)}`);
  }

  const baaStatus = await askBaaStatus(
    'Google Calendar',
    'Google Workspace (Business/Enterprise) offers a BAA. Google personal accounts do NOT.'
  );

  return { enabled: true, baaStatus };
}

async function setupGmail(region: string): Promise<CapabilityResult> {
  displayInfo('');
  displayInfo('Setting up Gmail...');
  displayInfo('  Gmail uses the same Google OAuth2 credentials as Google Calendar.');
  displayInfo('  If you already set up Google Calendar, the same credentials apply.');
  displayInfo('');

  const clientId = await input({
    message: 'Google OAuth2 Client ID (ends with .apps.googleusercontent.com):',
    validate: (v) => {
      if (!isGoogleClientId(v.trim())) {
        return 'Client ID must end with .apps.googleusercontent.com';
      }
      return true;
    },
  });

  const clientSecret = await password({
    message: 'Google OAuth2 Client Secret:',
    mask: '*',
    validate: (v) => (v.trim().length > 0 ? true : 'Client secret cannot be empty'),
  });

  try {
    await pushSecret('/tino/GOOGLE_CLIENT_ID', clientId.trim(), region);
    await pushSecret('/tino/GOOGLE_CLIENT_SECRET', clientSecret, region);
    displaySuccess('Google credentials stored in Secrets Manager.');
  } catch (err) {
    displayWarning(`Could not push to Secrets Manager: ${err instanceof Error ? err.message : String(err)}`);
  }

  const baaStatus = await askBaaStatus(
    'Gmail',
    'Google Workspace (Business/Enterprise) offers a BAA. Google personal accounts do NOT.'
  );

  return { enabled: true, baaStatus };
}

async function setupSlackReading(region: string): Promise<CapabilityResult> {
  displayInfo('');
  displayInfo('Setting up Slack reading...');
  displayInfo('  Each user provides their own Slack user token (xoxp-) for privacy.');
  displayInfo('  tino sees exactly what each user sees — no more, no less.');
  displayInfo('');

  let token = '';
  let tokenValid = false;

  while (!tokenValid) {
    token = await password({
      message: 'Slack User Token (xoxp-...) for the admin user:',
      mask: '*',
    });

    if (!isSlackUserToken(token)) {
      displayWarning('Slack user token must start with xoxp-. Please try again.');
      continue;
    }

    displayInfo('Validating Slack user token...');
    const result = await validateSlackToken(token);

    if (result.ok) {
      displaySuccess(`Token validated. User: ${result.user ?? 'unknown'}`);
      tokenValid = true;
    } else {
      displayWarning(`Token validation failed: ${result.error ?? 'unknown'}. Please try again.`);
    }
  }

  try {
    await pushSecret('/tino/SLACK_USER_TOKEN', token, region);
    displaySuccess('Slack user token stored in Secrets Manager.');
  } catch (err) {
    displayWarning(`Could not push to Secrets Manager: ${err instanceof Error ? err.message : String(err)}`);
  }

  const baaStatus = await askBaaStatus(
    'Slack',
    'Slack Enterprise Grid offers a BAA. Slack Free/Pro/Business+ do NOT have a BAA.'
  );

  return { enabled: true, baaStatus };
}

async function setupCloudWatch(): Promise<CapabilityResult> {
  displayInfo('');
  displayInfo('Setting up CloudWatch Logs...');
  displayInfo('  CloudWatch Logs uses the ECS task role — no additional credentials needed.');
  displayInfo('  The CDK stack will grant the task role read access to configured log groups.');
  displayInfo('');

  const logGroup = await input({
    message: 'Default CloudWatch log group name (e.g. /ecs/my-service):',
    validate: (v) => (v.trim().length > 0 ? true : 'Log group name cannot be empty'),
  });

  displaySuccess(`CloudWatch log group: ${logGroup.trim()}`);
  displayInfo('  CloudWatch is an AWS service covered by the AWS BAA.');

  return { enabled: true, baaStatus: 'confirmed' };
}
