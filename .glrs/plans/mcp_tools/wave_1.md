# Wave 1: Console UI — Catalog Browser + Credential Entry

## Goal

Add an "MCP Tools" section to the Customize page where users can browse the catalog, connect servers by entering credentials, and see which servers are active.

## Items

### 1a. API client functions

**Modified:** `src/console-app/lib/api.ts`

```typescript
export interface McpCatalogEntry {
  id: string;
  displayName: string;
  description: string;
  icon: string;
  fields: Array<{ key: string; label: string; secret?: boolean; placeholder?: string }>;
}

export interface McpServerStatus {
  id: string;
  enabled: boolean;
}

export async function getMcpCatalog(): Promise<McpCatalogEntry[]> { ... }
export async function getMcpServers(): Promise<McpServerStatus[]> { ... }
export async function saveMcpServer(id: string, credentials: Record<string, string>): Promise<void> { ... }
export async function removeMcpServer(id: string): Promise<void> { ... }
```

### 1b. MCP section on Customize page

**Modified:** `src/console-app/pages/Capabilities.tsx`

Add an "MCP Tools" section below the existing capability cards in the **Tools** tab. Layout:

```
── Integrations ──────────────────────────
[Gmail ● on] [Calendar ● on] [+ connect Google]

── MCP Tools ─────────────────────────────
Connect external tool servers to give tino access to more services.

[Ramp 💳]          [Rippling 👥]
 expenses           HR & payroll
 ● connected        + connect
```

Each catalog entry renders as a card:
- **Connected**: shows "● connected" badge + gear icon to reconfigure/disconnect
- **Not connected**: shows "+ connect" link that opens a credential modal

Clicking "connect" opens a modal (similar to `CapabilityModal`) with the server's `fields` rendered as inputs. On save, calls `saveMcpServer(id, credentials)`. On disconnect, calls `removeMcpServer(id)` with confirmation.

### 1c. MCP credential modal

**New component:** `src/console-app/components/McpConnectModal.tsx`

Renders the server's `fields` array as a form. Secret fields use `RevealInput`. Non-secret fields use plain text inputs. Save button calls the API and closes the modal.

Reuses the existing modal pattern from `CapabilityModal` — backdrop, card, close button, form fields, save/cancel buttons.

## Testing

- Visual: browse catalog, connect a server, see it show as connected, disconnect it.
- The modal should validate that all fields are filled before saving.
- Disconnecting should show a confirmation prompt ("Remove Ramp? tino will lose access to Ramp tools.").
