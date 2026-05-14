/**
 * DeployConfig — the full deployment configuration collected by `tino init`.
 * Credentials are NEVER stored here — only boolean flags and non-sensitive config.
 */
export interface DeployConfig {
  compliance: {
    frameworks: ['hipaa'];
    baaStatus: {
      aws: 'verified' | 'manual-confirmed' | 'skipped';
      bedrock: 'verified' | 'manual-confirmed' | 'skipped';
      github?: 'confirmed' | 'no-baa' | 'unknown';
      slack?: 'confirmed' | 'no-baa' | 'unknown';
      google?: 'confirmed' | 'no-baa' | 'unknown';
      linear?: 'confirmed' | 'no-baa' | 'unknown';
    };
  };
  provider: 'aws';
  region: string;
  model: {
    provider: 'bedrock';
    modelId: string;
  };
  iac: 'cdk' | 'terraform' | 'pulumi' | 'existing';
  vpc: 'default' | 'new' | { vpcId: string };
  slack: {
    botTokenSet: boolean;
    appTokenSet: boolean;
    adminUserId: string;
  };
  capabilities: {
    [id: string]: {
      enabled: boolean;
      baaStatus: 'confirmed' | 'no-baa' | 'unknown';
    };
  };
  hipaa: {
    kmsKeyAlias: string;
    auditRetentionDays: number;
    historyRetentionDays: number;
    enforceEncryption: true;
    enforceTls: true;
    enforceAuditLogging: true;
  };
}
