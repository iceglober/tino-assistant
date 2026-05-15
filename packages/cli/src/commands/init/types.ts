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
      google?: 'confirmed' | 'no-baa' | 'unknown';
      linear?: 'confirmed' | 'no-baa' | 'unknown';
    };
  };
  provider: 'aws';
  region: string;
  iac: 'standalone' | 'existing';
  infraPath?: string;      // path to existing Pulumi project (only for 'existing')
  pulumiStack?: string;    // stack name (default: 'dev')
  googleOAuthClientId: string;
  googleOAuthClientSecret: string;
  allowedDomain: string;
  hipaa: {
    kmsKeyAlias: string;
    auditRetentionDays: number;
    historyRetentionDays: number;
    enforceEncryption: true;
    enforceTls: true;
    enforceAuditLogging: true;
  };
}
