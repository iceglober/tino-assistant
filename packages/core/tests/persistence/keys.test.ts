import { describe, expect, it } from "vitest";
import {
  CONFIG_PK,
  CONFIG_SK_PREFIX,
  CAP_SK_PREFIX,
  HISTORY_SK,
  ORG_USER_PARTITION,
  capabilitySk,
  configSk,
  historyPk,
  identityPk,
  orgUserPk,
  sessionPk,
  tenantPrefix,
  userCapPk,
} from "../../src/persistence/keys.js";

describe("partition key helpers", () => {
  it("tenantPrefix returns empty string by default", () => {
    expect(tenantPrefix()).toBe("");
  });

  it("historyPk produces HISTORY#<userId>", () => {
    expect(historyPk("u123")).toBe("HISTORY#u123");
  });

  it("HISTORY_SK is 'HISTORY'", () => {
    expect(HISTORY_SK).toBe("HISTORY");
  });

  it("identityPk produces IDENTITY#<provider>#<externalId>", () => {
    expect(identityPk("slack", "U_ABC")).toBe("IDENTITY#slack#U_ABC");
    expect(identityPk("google", "a@b.io")).toBe("IDENTITY#google#a@b.io");
  });

  it("orgUserPk produces ORG#USER#<id>", () => {
    expect(orgUserPk("uuid-1")).toBe("ORG#USER#uuid-1");
  });

  it("ORG_USER_PARTITION is 'ORG#USER'", () => {
    expect(ORG_USER_PARTITION).toBe("ORG#USER");
  });

  it("userCapPk produces USER#<id>", () => {
    expect(userCapPk("uuid-1")).toBe("USER#uuid-1");
  });

  it("capabilitySk produces CAP#<id>", () => {
    expect(capabilitySk("github")).toBe("CAP#github");
  });

  it("CAP_SK_PREFIX is 'CAP#'", () => {
    expect(CAP_SK_PREFIX).toBe("CAP#");
  });

  it("CONFIG_PK is 'CONFIG'", () => {
    expect(CONFIG_PK).toBe("CONFIG");
  });

  it("configSk produces CONFIG#<key>", () => {
    expect(configSk("slack.botToken")).toBe("CONFIG#slack.botToken");
  });

  it("CONFIG_SK_PREFIX is 'CONFIG#'", () => {
    expect(CONFIG_SK_PREFIX).toBe("CONFIG#");
  });

  it("sessionPk produces SESSION#<key>", () => {
    expect(sessionPk("abc123")).toBe("SESSION#abc123");
  });

  it("userKey produces USER#<id> with no prefix", () => {
    expect(userCapPk("my-user")).toBe("USER#my-user");
    expect(userCapPk("my-user").startsWith("TENANT")).toBe(false);
  });
});
