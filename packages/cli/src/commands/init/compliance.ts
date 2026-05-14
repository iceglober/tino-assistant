import { select } from '@inquirer/prompts';
import type { DeployConfig } from './types.js';
import { displayStep, displaySuccess, displayInfo } from '../../utils/display.js';

/**
 * Step 1: Compliance framework selection.
 * HIPAA is the only option — it's the baseline for all tino deployments.
 */
export async function stepCompliance(
  config: Partial<DeployConfig>
): Promise<Partial<DeployConfig>> {
  displayStep(1, 8, 'Compliance Framework');

  const framework = await select({
    message: 'Which compliance frameworks must you adhere to?',
    choices: [
      { name: 'HIPAA', value: 'hipaa' },
      { name: '(more coming soon)', value: 'hipaa', disabled: true },
    ],
    default: 'hipaa',
  });

  if (framework !== 'hipaa') {
    // Should never happen given the choices, but guard anyway
    throw new Error('Only HIPAA is supported in this version.');
  }

  displaySuccess('HIPAA selected. tino will enforce:');
  displayInfo('• encryption at rest (KMS)');
  displayInfo('• encryption in transit (TLS-only)');
  displayInfo('• audit logging (every data access)');
  displayInfo('• data retention policies (configurable TTL)');
  displayInfo('• PHI redaction in logs');
  displayInfo('• BAA verification for all services');

  return {
    ...config,
    compliance: {
      frameworks: ['hipaa'],
      baaStatus: {
        aws: 'skipped',
        bedrock: 'skipped',
        ...(config.compliance?.baaStatus ?? {}),
      },
    },
    hipaa: {
      kmsKeyAlias: 'alias/tino',
      auditRetentionDays: 90,
      historyRetentionDays: 30,
      enforceEncryption: true,
      enforceTls: true,
      enforceAuditLogging: true,
    },
  };
}
