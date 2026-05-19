export interface InstanceIsolationConfig {
  instanceId: string;
  canShareWith: string[];
}

export interface ToolResult {
  instanceId: string;
  data: unknown;
}

export interface FilteredToolResult {
  instanceId: string;
  data: unknown;
  filtered: boolean;
  reason?: string;
}

export function filterToolResults(
  activeInstanceId: string,
  results: ToolResult[],
  isolationConfigs: Map<string, InstanceIsolationConfig>,
): FilteredToolResult[] {
  return results.map((result) => {
    if (result.instanceId === activeInstanceId) {
      return { ...result, filtered: false };
    }

    const config = isolationConfigs.get(result.instanceId);
    if (!config) {
      return { ...result, filtered: false };
    }

    if (config.canShareWith.includes(activeInstanceId)) {
      return { ...result, filtered: false };
    }

    return {
      instanceId: result.instanceId,
      data: null,
      filtered: true,
      reason: `isolated by canShareWith — ${result.instanceId} does not share with ${activeInstanceId}`,
    };
  });
}
