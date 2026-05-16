/**
 * tino console — Port-forward to the ECS exec console (localhost:3001).
 *
 * Uses AWS ECS exec to open an interactive session with the running container.
 */
export async function openConsole(_args: string[]): Promise<void> {
  globalThis.console.log("tino console: ECS exec port-forward not yet implemented");
  globalThis.console.log(
    "Use: aws ecs execute-command --cluster tino --task <task-id> --interactive --command /bin/sh",
  );
}
