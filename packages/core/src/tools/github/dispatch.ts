import type { Octokit } from "@octokit/rest";
import { tool } from "ai";
import { z } from "zod";
import { isAllowedRepo, type RepoSpec } from "./allowlist.js";

const workflowId = z.union([z.string().min(1).max(200), z.number().int().positive()]);
const dispatchInputSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  workflow: workflowId,
  ref: z.string().min(1).max(255),
  inputs: z.record(z.string(), z.string().max(1_000)).default({}),
});

const runInputSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  runId: z.number().int().positive(),
});

export const workflowDispatchPolicySchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  workflow: workflowId,
  refs: z.array(z.string().min(1).max(255)).min(1),
  inputs: z.record(z.string(), z.array(z.string().max(1_000)).min(1)).default({}),
});

export type WorkflowDispatchPolicy = z.infer<typeof workflowDispatchPolicySchema>;

interface DispatchDeps {
  octokit: Octokit;
  allowedRepos: readonly RepoSpec[];
  policies: readonly WorkflowDispatchPolicy[];
}

function sameWorkflow(left: string | number, right: string | number): boolean {
  return String(left).toLowerCase() === String(right).toLowerCase();
}

function matchingPolicy(
  deps: DispatchDeps,
  input: z.infer<typeof dispatchInputSchema>,
): WorkflowDispatchPolicy | undefined {
  return deps.policies.find(
    (policy) =>
      policy.owner.toLowerCase() === input.owner.toLowerCase() &&
      policy.repo.toLowerCase() === input.repo.toLowerCase() &&
      sameWorkflow(policy.workflow, input.workflow) &&
      policy.refs.includes(input.ref),
  );
}

function validateInputs(policy: WorkflowDispatchPolicy, inputs: Record<string, string>): string | null {
  const actual = Object.keys(inputs).sort();
  const allowed = Object.keys(policy.inputs).sort();
  if (actual.some((key) => !allowed.includes(key))) return "workflow_input_not_allowlisted";
  for (const [key, value] of Object.entries(inputs)) {
    const values = policy.inputs[key];
    if (!values?.includes(value)) return "workflow_input_value_not_allowlisted";
  }
  return null;
}

export async function executeWorkflowDispatch(
  deps: DispatchDeps,
  input: z.infer<typeof dispatchInputSchema>,
): Promise<{ dispatched: true } | { error: string }> {
  if (!isAllowedRepo(input.owner, input.repo, deps.allowedRepos)) return { error: "repo_not_allowlisted" };
  const policy = matchingPolicy(deps, input);
  if (!policy) return { error: "workflow_not_allowlisted" };
  const inputError = validateInputs(policy, input.inputs);
  if (inputError) return { error: inputError };
  await deps.octokit.actions.createWorkflowDispatch({
    owner: input.owner,
    repo: input.repo,
    workflow_id: input.workflow,
    ref: input.ref,
    inputs: input.inputs,
  });
  return { dispatched: true };
}

export function githubDispatchWorkflowTool(deps: DispatchDeps) {
  return tool({
    description:
      "Dispatch a configured GitHub Actions workflow. Repository, workflow, ref, input names, and input values must all be allowlisted.",
    inputSchema: dispatchInputSchema,
    execute: (input) => executeWorkflowDispatch(deps, input),
  });
}

export function githubGetWorkflowRunTool(deps: Pick<DispatchDeps, "octokit" | "allowedRepos">) {
  return tool({
    description:
      "Get the current status and conclusion of one GitHub Actions workflow run in an allowlisted repository.",
    inputSchema: runInputSchema,
    execute: async (input) => {
      if (!isAllowedRepo(input.owner, input.repo, deps.allowedRepos)) return { error: "repo_not_allowlisted" };
      const response = await deps.octokit.actions.getWorkflowRun({
        owner: input.owner,
        repo: input.repo,
        run_id: input.runId,
      });
      return {
        id: response.data.id,
        status: response.data.status,
        conclusion: response.data.conclusion,
        headSha: response.data.head_sha,
        htmlUrl: response.data.html_url,
      };
    },
  });
}
