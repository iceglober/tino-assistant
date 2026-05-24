/**
 * tino init — Bootstrap a new HIPAA-compliant tino deployment.
 *
 * Chains 5 interactive steps to collect deployment config,
 * then writes tino.deploy.json and deploys.
 *
 * All runtime config (Google OAuth, Slack tokens, model, capabilities)
 * is configured via the console setup wizard after deploy — not here.
 */
import { command } from "cmd-ts";
import { displayBanner } from "../utils/display.js";
import { stepBaa } from "./init/baa.js";
import { stepCompliance } from "./init/compliance.js";
import { stepInfrastructure } from "./init/infrastructure.js";
import { stepProvider } from "./init/provider.js";
import { stepReview } from "./init/review.js";
import type { DeployConfig } from "./init/types.js";

export const init = command({
  name: "init",
  description: "Set up a new HIPAA-compliant tino deployment",
  args: {},
  handler: async () => {
    displayBanner();

    let config: Partial<DeployConfig> = {};

    config = await stepCompliance(config); // step 1
    config = await stepProvider(config); // step 2
    config = await stepBaa(config); // step 3
    config = await stepInfrastructure(config); // step 4
    await stepReview(config as DeployConfig); // step 5
  },
});
