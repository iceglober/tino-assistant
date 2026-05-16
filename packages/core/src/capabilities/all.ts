/**
 * Single source of truth for the ordered capability module list.
 *
 * Lifted out of `registry.ts` so other modules (e.g. `schema.ts`,
 * `server/routes/capabilities.ts`) can iterate the canonical set without
 * pulling in the registry's runtime dependencies.
 */
import type { CapabilityModule } from './types.js';
import { githubCapability } from './github.js';
import { linearCapability } from './linear.js';
import { slackCapability } from './slack.js';
import { gmailCapability } from './gmail.js';
import { calendarCapability } from './calendar.js';
import { cloudwatchCapability } from './cloudwatch.js';

export const ALL_CAPABILITIES: CapabilityModule[] = [
  githubCapability,
  linearCapability,
  slackCapability,
  gmailCapability,
  calendarCapability,
  cloudwatchCapability,
];
