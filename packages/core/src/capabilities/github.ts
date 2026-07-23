/**
 * GitHub capability module.
 *
 * Registers github_search_code, github_get_file, github_list_workflow_runs,
 * github_get_workflow_run_logs tools. Reads credentials and settings from
 * the capability config stored in the config table.
 *
 * findWork: stub (not yet implemented — enabled=false by default).
 */

import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import type { ToolSet } from "ai";
import { z } from "zod";
import type { ConfigStore } from "../persistence/config.js";
import type { AppLogger } from "../slack/app.js";
import { parseRepoSpec, type RepoSpec } from "../tools/github/allowlist.js";
import {
  githubDispatchWorkflowTool,
  githubGetWorkflowRunTool,
  workflowDispatchPolicySchema,
} from "../tools/github/dispatch.js";
import { githubGetFileTool } from "../tools/github/getFile.js";
import { githubSearchCodeTool } from "../tools/github/search.js";
import { githubGetWorkflowRunLogsTool, githubListWorkflowRunsTool } from "../tools/github/workflows.js";
import type { CapabilityConfig, SharedCapability } from "./types.js";

export const githubCapability: SharedCapability = {
  id: "github",
  displayName: "GitHub",
  scope: "shared",

  fieldSchema: [
    {
      key: "clientId",
      label: "OAuth App Client ID",
      target: "credentials.clientId",
      placeholder: "Iv1.abc123...",
    },
    {
      key: "clientSecret",
      label: "OAuth App Client Secret",
      target: "credentials.clientSecret",
      secret: true,
    },
    { key: "appId", label: "GitHub App ID", target: "credentials.appId" },
    { key: "installationId", label: "GitHub App Installation ID", target: "credentials.installationId" },
    { key: "privateKey", label: "GitHub App Private Key", target: "credentials.privateKey", secret: true },
  ],

  async registerTools(
    config: CapabilityConfig,
    _configStore: ConfigStore,
    logger: AppLogger,
    tools: ToolSet,
  ): Promise<void> {
    const token = config.credentials.token;
    const appId = config.credentials.appId;
    const installationId = config.credentials.installationId;
    const privateKey = config.credentials.privateKey;
    let octokit: Octokit;
    if (token) {
      octokit = new Octokit({ auth: token, userAgent: "tino/0.1" });
    } else if (appId && installationId && privateKey) {
      const parsedInstallationId = Number(installationId);
      if (!Number.isSafeInteger(parsedInstallationId) || parsedInstallationId <= 0)
        throw new Error("GitHub capability: installationId must be a positive integer");
      octokit = new Octokit({
        authStrategy: createAppAuth,
        auth: { appId, installationId: parsedInstallationId, privateKey },
        userAgent: "tino/0.1",
      });
    } else {
      throw new Error("GitHub capability: credentials.token or complete GitHub App credentials are required");
    }

    // Resolve allowlist from capability settings
    const reposRaw = (config.settings.repos as string[] | undefined) ?? [];
    const allowedRepos: RepoSpec[] = reposRaw.flatMap((s) => {
      const parsed = parseRepoSpec(s);
      return parsed ? [parsed] : [];
    });

    // Resolve default repo from capability settings
    let defaultRepo: RepoSpec | undefined;
    const defaultRepoRaw = config.settings.defaultRepo as string | undefined;
    if (defaultRepoRaw) {
      defaultRepo = parseRepoSpec(defaultRepoRaw) ?? undefined;
    }

    // Parse the dispatch policies BEFORE mutating the shared tools object. A malformed
    // policy throws here, leaving the toolset untouched, rather than half-registering the
    // read tools and reporting the capability disabled with an inconsistent live toolset.
    const dispatchPolicies = z.array(workflowDispatchPolicySchema).parse(config.settings.workflowDispatches ?? []);

    tools.github_search_code = githubSearchCodeTool({ octokit, defaultRepo, allowedRepos });
    tools.github_get_file = githubGetFileTool({ octokit, defaultRepo, allowedRepos });
    tools.github_list_workflow_runs = githubListWorkflowRunsTool({ octokit, defaultRepo, allowedRepos });
    tools.github_get_workflow_run_logs = githubGetWorkflowRunLogsTool({ octokit, defaultRepo, allowedRepos });
    if (dispatchPolicies.length > 0) {
      tools.github_dispatch_workflow = githubDispatchWorkflowTool({
        octokit,
        allowedRepos,
        policies: dispatchPolicies,
      });
      tools.github_get_workflow_run = githubGetWorkflowRunTool({ octokit, allowedRepos });
    }

    logger.info(
      {
        defaultRepo: defaultRepo ? `${defaultRepo.owner}/${defaultRepo.repo}` : null,
        allowedReposCount: allowedRepos.length,
      },
      "github tools enabled",
    );
  },
};
