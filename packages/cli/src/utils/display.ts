import chalk from "chalk";

const BANNER = `
  ╔══════════════════════════════════════╗
  ║          tino — deployment setup     ║
  ╚══════════════════════════════════════╝
`;

export function displayBanner(): void {
  console.log(chalk.cyan(BANNER));
}

export function displaySummary(config: {
  compliance?: { frameworks?: string[]; baaStatus?: { aws?: string; bedrock?: string } };
  provider?: string;
  region?: string;
  iac?: string;
}): void {
  const awsBaa = config.compliance?.baaStatus?.aws ?? "unknown";
  const baaIcon = awsBaa === "verified" ? "✓" : awsBaa === "manual-confirmed" ? "✓ (manual)" : "⚠";

  console.log(
    chalk.cyan(`
  ╔══════════════════════════════════════════════════╗
  ║  Ready to deploy tino                           ║
  ║                                                 ║
  ║  Compliance:  ${padRight("HIPAA", 33)}║
  ║  Provider:    ${padRight(`${config.provider ?? "aws"} (${config.region ?? "us-east-1"})`, 33)}║
  ║  BAA:         ${padRight(`${baaIcon} AWS BAA ${awsBaa}`, 33)}║
  ║  IaC:         ${padRight(config.iac ?? "standalone", 33)}║
  ║  Config:      ${padRight("via console after deploy", 33)}║
  ║                                                 ║
  ║  This will create:                              ║
  ║    • ECS Fargate cluster + service              ║
  ║    • DynamoDB table (encrypted, TTL enabled)    ║
  ║    • KMS key (for credential encryption)        ║
  ║    • CloudWatch log group + alarms              ║
  ║    • IAM roles (least-privilege)                ║
  ╚══════════════════════════════════════════════════╝
`),
  );
}

function padRight(str: string, len: number): string {
  return str.length >= len ? str.slice(0, len) : str + " ".repeat(len - str.length);
}

export function displaySuccess(message: string): void {
  console.log(chalk.green(`  ✓ ${message}`));
}

export function displayWarning(message: string): void {
  console.log(chalk.yellow(`  ⚠ ${message}`));
}

export function displayError(message: string): void {
  console.log(chalk.red(`  ✗ ${message}`));
}

export function displayStep(step: number, total: number, title: string): void {
  console.log("");
  console.log(chalk.bold.blue(`  Step ${step}/${total}: ${title}`));
  console.log(chalk.dim(`  ${"─".repeat(40)}`));
}

export function displayInfo(message: string): void {
  console.log(chalk.dim(`  ℹ ${message}`));
}
