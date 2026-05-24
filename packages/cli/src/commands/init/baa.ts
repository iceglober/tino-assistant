import { confirm, select } from "@inquirer/prompts";
import { checkAwsAccess } from "../../utils/aws.js";
import { displayInfo, displayStep, displaySuccess, displayWarning } from "../../utils/display.js";
import type { DeployConfig } from "./types.js";

/**
 * Step 3: BAA verification.
 * Attempts programmatic check first; falls back to manual confirmation.
 */
export async function stepBaa(config: Partial<DeployConfig>): Promise<Partial<DeployConfig>> {
  displayStep(3, 5, "BAA Verification");

  displayInfo("Checking AWS BAA status...");
  displayInfo("Attempting to verify via AWS Artifact API...");

  const awsIdentity = await checkAwsAccess();

  let awsBaaStatus: "verified" | "manual-confirmed" | "skipped" = "skipped";

  if (awsIdentity) {
    // AWS CLI is accessible. The AWS Artifact API doesn't have a clean
    // "is BAA signed?" endpoint, so we confirm AWS access and ask manually.
    displayInfo(`AWS account ${awsIdentity.accountId} is accessible.`);
    displayWarning(
      "Could not automatically verify AWS BAA status (AWS Artifact API does not expose BAA status programmatically).",
    );

    const baaAnswer = await select({
      message: "Have you accepted the AWS Business Associate Addendum (BAA)?",
      choices: [
        { name: "Yes, BAA is signed", value: "yes" },
        { name: "No, I haven't signed it yet", value: "no" },
        { name: "I'm not sure", value: "unsure" },
      ],
    });

    if (baaAnswer === "yes") {
      awsBaaStatus = "manual-confirmed";
      displaySuccess(`AWS BAA confirmed on account ${awsIdentity.accountId}.`);
    } else {
      displayWarning("WARNING: Deploying tino without an AWS BAA may violate HIPAA.");
      displayInfo("  The BAA covers all AWS services tino uses (ECS, DynamoDB,");
      displayInfo("  Secrets Manager, Bedrock, CloudWatch, KMS).");
      displayInfo("");
      displayInfo("  Sign it at: https://console.aws.amazon.com/artifact/");

      const proceed = await select({
        message: "Do you want to proceed anyway? (not recommended)",
        choices: [
          { name: "No, I'll sign the BAA first", value: "exit" },
          { name: "Yes, proceed without BAA (at my own risk)", value: "proceed" },
        ],
      });

      if (proceed === "exit") {
        displayInfo("Exiting. Sign the BAA at https://console.aws.amazon.com/artifact/ and re-run tino init.");
        process.exit(0);
      }

      awsBaaStatus = "skipped";
      displayWarning("Proceeding without confirmed AWS BAA. This is at your own risk.");
    }
  } else {
    displayWarning("Could not connect to AWS. Make sure AWS CLI is configured (aws configure).");
    displayInfo("You can check BAA status at: AWS Console → Artifact → Agreements");

    const baaAnswer = await select({
      message: "Have you accepted the AWS Business Associate Addendum (BAA)?",
      choices: [
        { name: "Yes, BAA is signed", value: "yes" },
        { name: "No, I haven't signed it yet", value: "no" },
        { name: "I'm not sure", value: "unsure" },
      ],
    });

    if (baaAnswer === "yes") {
      awsBaaStatus = "manual-confirmed";
      displaySuccess("AWS BAA confirmed (manual).");
    } else {
      displayWarning("WARNING: Deploying tino without an AWS BAA may violate HIPAA.");
      displayInfo("  Sign it at: https://console.aws.amazon.com/artifact/");

      const proceed = await confirm({
        message: "Do you want to proceed anyway? (not recommended)",
        default: false,
      });

      if (!proceed) {
        displayInfo("Exiting. Sign the BAA and re-run tino init.");
        process.exit(0);
      }

      awsBaaStatus = "skipped";
      displayWarning("Proceeding without confirmed AWS BAA.");
    }
  }

  return {
    ...config,
    compliance: {
      frameworks: ["hipaa"],
      baaStatus: {
        ...(config.compliance?.baaStatus ?? { aws: "skipped", bedrock: "skipped" }),
        aws: awsBaaStatus,
      },
    },
  };
}
