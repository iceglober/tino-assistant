import { execSync } from 'node:child_process';

/**
 * AWS helper functions — use AWS CLI via child_process to avoid importing the full SDK.
 */

export interface AwsIdentity {
  accountId: string;
  region: string;
}

/**
 * Check if AWS CLI is configured and accessible.
 * Returns account info on success, null on failure.
 */
export async function checkAwsAccess(): Promise<AwsIdentity | null> {
  try {
    const output = execSync('aws sts get-caller-identity --output json', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10_000,
    });
    const parsed = JSON.parse(output) as { Account?: string };
    const accountId = parsed.Account ?? 'unknown';

    // Get configured region
    let region = 'us-east-1';
    try {
      region = execSync('aws configure get region', {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 5_000,
      }).trim();
    } catch {
      // fall back to default
    }

    return { accountId, region };
  } catch {
    return null;
  }
}

/**
 * Push a secret to AWS Secrets Manager.
 * In dry-run mode (DRY_RUN=true), prints what it would do instead.
 */
export async function pushSecret(name: string, value: string, region: string): Promise<void> {
  if (process.env['DRY_RUN'] === 'true') {
    console.log(`  [DRY RUN] Would push secret: ${name} to region ${region}`);
    return;
  }

  try {
    // Try to create first; if it exists, update it
    execSync(
      `aws secretsmanager create-secret --name "${name}" --secret-string "${value.replace(/"/g, '\\"')}" --region "${region}" 2>/dev/null || aws secretsmanager put-secret-value --secret-id "${name}" --secret-string "${value.replace(/"/g, '\\"')}" --region "${region}"`,
      {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 15_000,
      }
    );
  } catch (err) {
    throw new Error(`Failed to push secret ${name}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export interface BedrockModel {
  id: string;
  name: string;
  status: string;
}

/**
 * List available Bedrock inference profiles.
 */
export async function listBedrockModels(region: string): Promise<BedrockModel[]> {
  try {
    const output = execSync(
      `aws bedrock list-inference-profiles --output json --region "${region}"`,
      {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 15_000,
      }
    );
    const parsed = JSON.parse(output) as {
      inferenceProfileSummaries?: Array<{
        inferenceProfileId?: string;
        inferenceProfileName?: string;
        status?: string;
      }>;
    };
    return (parsed.inferenceProfileSummaries ?? []).map((p) => ({
      id: p.inferenceProfileId ?? '',
      name: p.inferenceProfileName ?? p.inferenceProfileId ?? '',
      status: p.status ?? 'UNKNOWN',
    }));
  } catch {
    return [];
  }
}

/**
 * Verify a specific Bedrock model is accessible by checking inference profiles.
 */
export async function verifyBedrockModel(modelId: string, region: string): Promise<boolean> {
  try {
    const models = await listBedrockModels(region);
    if (models.some((m) => m.id === modelId && m.status === 'ACTIVE')) {
      return true;
    }

    // Fall back: try to get the model directly
    execSync(
      `aws bedrock get-inference-profile --inference-profile-identifier "${modelId}" --region "${region}" --output json`,
      {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 10_000,
      }
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate a Slack token by calling auth.test.
 */
export async function validateSlackToken(
  token: string
): Promise<{ ok: boolean; user?: string; team?: string; error?: string }> {
  try {
    const response = await fetch('https://slack.com/api/auth.test', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
    const data = (await response.json()) as {
      ok: boolean;
      user?: string;
      team?: string;
      error?: string;
    };
    return data;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'network error' };
  }
}

/**
 * Validate a GitHub PAT by calling the GitHub API.
 */
export async function validateGitHubToken(
  token: string
): Promise<{ ok: boolean; login?: string; error?: string }> {
  try {
    const response = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': 'tino-cli/1.0',
      },
    });
    if (response.ok) {
      const data = (await response.json()) as { login?: string };
      return { ok: true, login: data.login };
    }
    return { ok: false, error: `HTTP ${response.status}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'network error' };
  }
}

/**
 * Validate a GitHub repo is accessible.
 */
export async function validateGitHubRepo(
  token: string,
  repo: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await fetch(`https://api.github.com/repos/${repo}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': 'tino-cli/1.0',
      },
    });
    if (response.ok) return { ok: true };
    return { ok: false, error: `HTTP ${response.status}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'network error' };
  }
}
