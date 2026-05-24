/**
 * Shared deployment logic used by both `tino deploy` and `tino init`.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execaCommandSync } from "execa";
import { displayError, displayInfo, displayStep, displaySuccess } from "../utils/display.js";
import type { DeployConfig } from "./init/types.js";

function run(cmd: string, cwd?: string): void {
  execaCommandSync(cmd, { stdio: "inherit", cwd });
}

/**
 * Detect the tino-assistant repo root from the infra project's package.json.
 * Looks for a `file:` link to `@tino/aws` and resolves two levels up
 * (packages/aws → packages → tino-assistant).
 */
function detectTinoRepoRoot(infraDir: string): string | null {
  try {
    const pkgJson = JSON.parse(readFileSync(resolve(infraDir, "package.json"), "utf8"));
    const awsPath = pkgJson.dependencies?.["@tino/aws"];
    if (awsPath?.startsWith("file:")) {
      // file:../path/to/tino-assistant/packages/aws → resolve to repo root (2 levels up)
      const awsAbsPath = resolve(infraDir, awsPath.replace("file:", ""));
      return resolve(awsAbsPath, "..", ".."); // packages/aws → packages → tino-assistant
    }
    return null;
  } catch {
    return null;
  }
}

export async function executeDeploy(config: DeployConfig): Promise<void> {
  // All paths are relative to where `tino init` was run
  const cwd = process.cwd();
  const infraDir = resolve(cwd, config.infraPath ?? "infra-tino");
  const stack = config.pulumiStack ?? "dev";
  const region = config.region;

  // Verify the infra directory exists before trying to deploy
  try {
    const { statSync } = await import("node:fs");
    statSync(infraDir);
  } catch {
    displayError(`Infrastructure directory not found: ${infraDir}`);
    displayInfo(`  Run \`tino init\` first to generate the Pulumi project.`);
    process.exit(1);
  }

  try {
    // Step 1: Set Pulumi config values
    displayStep(1, 2, "Configuring Pulumi stack");
    run(`pulumi config set aws:region ${region} --stack ${stack}`, infraDir);
    // BAA acknowledgment (required when HIPAA compliance is on)
    run(`pulumi config set tino:baaAcknowledged true --stack ${stack}`, infraDir);

    // Detect the tino-assistant repo root from the file: link in infra package.json
    // and set it as the Docker build context. @pulumi/docker-build reads this during
    // `pulumi up` to locate the Dockerfile at the repo root.
    const tinoRepoRoot = detectTinoRepoRoot(infraDir);
    if (tinoRepoRoot) {
      run(`pulumi config set tino:dockerContext ${tinoRepoRoot} --stack ${stack}`, infraDir);
    }

    // Step 2: pulumi up — creates infra, builds + pushes Docker image, deploys service
    displayStep(2, 2, "Deploying (pulumi up — builds image, pushes to ECR, deploys service)");
    run(`pulumi up --yes --stack ${stack}`, infraDir);

    displaySuccess("tino is deployed!");
    displayInfo(`  Console URL: pulumi stack output consoleUrl --stack ${stack}`);
    displayInfo(`  Logs: aws logs tail /ecs/tino --follow --region ${region}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    displayError(`Deployment failed: ${message}`);
    process.exit(1);
  }
}
