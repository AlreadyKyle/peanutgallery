// The tool names no writing session may have, in both namings: Claude Code's (a role's tools_json and
// the command line's init line) and Managed Agents' (a managed session's start event).
export const EXCLUDED_TOOLS = ['WebFetch', 'WebSearch', 'Agent', 'Task'] as const;
export const EXCLUDED_MANAGED_TOOLS = ['web_fetch', 'web_search'] as const;
export const MCP_PREFIX = 'mcp__';

export function refusedTools(tools: readonly string[]): string[] {
  return tools.filter(
    (tool) => (EXCLUDED_TOOLS as readonly string[]).includes(tool) || (EXCLUDED_MANAGED_TOOLS as readonly string[]).includes(tool) || tool.startsWith(MCP_PREFIX),
  );
}
