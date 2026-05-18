/**
 * Type-level tests for capability scope discriminator.
 *
 * Asserts that SharedCapability and PrivateCapability are correctly
 * discriminated by the `scope` field, and that startFindWork is only
 * available on SharedCapability.
 */

import { describe, it, expectTypeOf } from "vitest";
import type { PrivateCapability, SharedCapability, CapabilityModule } from "../../src/capabilities/types.js";

describe("CapabilityModule scope discrimination", () => {
  it("SharedCapability permits startFindWork", () => {
    const shared: SharedCapability = {
      id: "test",
      displayName: "Test",
      scope: "shared",
      registerTools: async () => {},
      startFindWork: () => () => {},
    };
    expectTypeOf(shared.startFindWork).toMatchTypeOf<
      ((
        config: any,
        logger: any,
        onNewWork: (summary: string) => Promise<void>,
      ) => () => void) | undefined
    >();
  });

  it("PrivateCapability rejects startFindWork", () => {
    const priv: PrivateCapability = {
      id: "test",
      displayName: "Test",
      scope: "private",
      buildToolsForUser: async () => ({}),
    };
    // @ts-expect-error PrivateCapability does not have startFindWork
    priv.startFindWork;
  });

  it("CapabilityModule narrows on scope === 'shared'", () => {
    const cap: CapabilityModule = {
      id: "test",
      displayName: "Test",
      scope: "shared",
      registerTools: async () => {},
    };

    if (cap.scope === "shared") {
      // After narrowing, registerTools should be available
      expectTypeOf(cap.registerTools).toMatchTypeOf<(config: any, configStore: any, logger: any, tools: any) => Promise<void>>();
    }
  });

  it("CapabilityModule narrows on scope === 'private'", () => {
    const cap: CapabilityModule = {
      id: "test",
      displayName: "Test",
      scope: "private",
      buildToolsForUser: async () => ({}),
    };

    if (cap.scope === "private") {
      // After narrowing, buildToolsForUser should be available
      expectTypeOf(cap.buildToolsForUser).toMatchTypeOf<
        (tinoUserId: string, config: any, configStore: any, logger: any) => Promise<any>
      >();
    }
  });
});
