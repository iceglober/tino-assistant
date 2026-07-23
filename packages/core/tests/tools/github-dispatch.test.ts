import { describe, expect, it, vi } from "vitest";
import { executeWorkflowDispatch, workflowDispatchPolicySchema } from "../../src/tools/github/dispatch.js";

const policy = workflowDispatchPolicySchema.parse({
  owner: "kn-eng",
  repo: "kn-eng",
  workflow: "docs-agent.yml",
  refs: ["main"],
  inputs: { operation: ["inventory", "hygiene"] },
});

function deps() {
  return {
    octokit: {
      actions: { createWorkflowDispatch: vi.fn().mockResolvedValue({ status: 204 }) },
    } as never,
    allowedRepos: [{ owner: "kn-eng", repo: "kn-eng" }],
    policies: [policy],
  };
}

describe("GitHub workflow dispatch", () => {
  it("dispatches an exact allowlisted operation", async () => {
    const configured = deps();
    await expect(
      executeWorkflowDispatch(configured, {
        owner: "kn-eng",
        repo: "kn-eng",
        workflow: "docs-agent.yml",
        ref: "main",
        inputs: { operation: "inventory" },
      }),
    ).resolves.toEqual({ dispatched: true });
    expect(configured.octokit.actions.createWorkflowDispatch).toHaveBeenCalledOnce();
  });

  it.each([
    [{ owner: "other", repo: "repo", workflow: "docs-agent.yml", ref: "main", inputs: {} }, "repo_not_allowlisted"],
    [{ owner: "kn-eng", repo: "kn-eng", workflow: "other.yml", ref: "main", inputs: {} }, "workflow_not_allowlisted"],
    [
      { owner: "kn-eng", repo: "kn-eng", workflow: "docs-agent.yml", ref: "dev", inputs: {} },
      "workflow_not_allowlisted",
    ],
    [
      { owner: "kn-eng", repo: "kn-eng", workflow: "docs-agent.yml", ref: "main", inputs: { command: "rm" } },
      "workflow_input_not_allowlisted",
    ],
    [
      { owner: "kn-eng", repo: "kn-eng", workflow: "docs-agent.yml", ref: "main", inputs: { operation: "shell" } },
      "workflow_input_value_not_allowlisted",
    ],
  ])("rejects dispatch outside policy", async (input, error) => {
    const configured = deps();
    await expect(executeWorkflowDispatch(configured, input)).resolves.toEqual({ error });
    expect(configured.octokit.actions.createWorkflowDispatch).not.toHaveBeenCalled();
  });

  it("rejects a dispatch that omits an allowlisted input (would run the workflow default)", async () => {
    const configured = deps();
    await expect(
      executeWorkflowDispatch(configured, {
        owner: "kn-eng",
        repo: "kn-eng",
        workflow: "docs-agent.yml",
        ref: "main",
        inputs: {},
      }),
    ).resolves.toEqual({ error: "workflow_required_input_missing" });
    expect(configured.octokit.actions.createWorkflowDispatch).not.toHaveBeenCalled();
  });

  it("dispatches with the policy's workflow name, not the agent's case-variant string", async () => {
    const configured = deps();
    await expect(
      executeWorkflowDispatch(configured, {
        owner: "KN-ENG",
        repo: "kn-eng",
        workflow: "Docs-Agent.YML",
        ref: "main",
        inputs: { operation: "inventory" },
      }),
    ).resolves.toEqual({ dispatched: true });
    expect(configured.octokit.actions.createWorkflowDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ workflow_id: "docs-agent.yml" }),
    );
  });
});
