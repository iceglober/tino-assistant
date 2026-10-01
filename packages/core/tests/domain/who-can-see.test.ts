import { describe, expect, it } from "vitest";
import {
  describeWhoCanSee,
  everyoneInWorkspace,
  membersOfChannel,
  nobody,
  onlyUser,
  onlyUserInChannel,
  parseWhoCanSee,
  type Readers,
  readersMaySee,
  strictestOf,
} from "../../src/domain/who-can-see.js";

const dmWith = (userId: string, channels: string[] = []): Readers => ({
  soleReaderId: userId,
  includesOutsiders: false,
  channelsAllReadersAreIn: new Set(channels),
});
const internalChannel = (channelId: string): Readers => ({
  soleReaderId: null,
  includesOutsiders: false,
  channelsAllReadersAreIn: new Set([channelId]),
});
const sharedChannel = (channelId: string): Readers => ({
  soleReaderId: null,
  includesOutsiders: true,
  channelsAllReadersAreIn: new Set([channelId]),
});

describe("readersMaySee", () => {
  it.each([
    // [readers, data, allowed]
    ["U's DM", dmWith("U"), onlyUser("U"), true],
    ["U's DM", dmWith("U"), onlyUser("V"), false],
    ["U's DM", dmWith("U"), everyoneInWorkspace, true],
    ["U's DM, U in #C", dmWith("U", ["C"]), membersOfChannel("C"), true],
    ["U's DM, U not in #C", dmWith("U"), membersOfChannel("C"), false],
    ["#C", internalChannel("C"), onlyUser("U"), false],
    ["#C", internalChannel("C"), everyoneInWorkspace, true],
    ["#C", internalChannel("C"), membersOfChannel("C"), true],
    ["#C", internalChannel("C"), membersOfChannel("D"), false],
    ["shared #X", sharedChannel("X"), everyoneInWorkspace, false],
    ["shared #X", sharedChannel("X"), membersOfChannel("X"), true],
    ["shared #X", sharedChannel("X"), membersOfChannel("C"), false],
    ["shared #X", sharedChannel("X"), onlyUser("U"), false],
    ["U's DM", dmWith("U", ["C"]), nobody, false],
  ] as const)("%s → %o: %s", (_name, readers, data, allowed) => {
    expect(readersMaySee(readers, data)).toBe(allowed);
  });
});

describe("strictestOf", () => {
  it("workspace is the widest, but keeps outsiders out of what it touches", () => {
    expect(strictestOf(everyoneInWorkspace, onlyUser("U"))).toEqual(onlyUser("U"));
    expect(strictestOf(membersOfChannel("C"), everyoneInWorkspace)).toEqual(
      membersOfChannel("C", { insidersOnly: true }),
    );
    expect(readersMaySee(sharedChannel("C"), strictestOf(membersOfChannel("C"), everyoneInWorkspace))).toBe(false);
    expect(readersMaySee(internalChannel("C"), strictestOf(membersOfChannel("C"), everyoneInWorkspace))).toBe(true);
    expect(strictestOf(everyoneInWorkspace, everyoneInWorkspace)).toEqual(everyoneInWorkspace);
  });

  it("two different people or two different channels: nobody", () => {
    expect(strictestOf(onlyUser("U"), onlyUser("V"))).toEqual(nobody);
    expect(strictestOf(membersOfChannel("C"), membersOfChannel("D"))).toEqual(nobody);
    expect(strictestOf(onlyUser("U"), onlyUser("U"))).toEqual(onlyUser("U"));
  });

  it("a person's private sources used in a channel: only that person, while they're in it", () => {
    expect(strictestOf(membersOfChannel("C"), onlyUser("U"))).toEqual(onlyUserInChannel("U", "C"));
    expect(strictestOf(onlyUser("U"), membersOfChannel("C"))).toEqual(onlyUserInChannel("U", "C"));
    expect(strictestOf(onlyUserInChannel("U", "C"), onlyUser("V"))).toEqual(nobody);
    expect(strictestOf(onlyUserInChannel("U", "C"), membersOfChannel("D"))).toEqual(nobody);
    expect(strictestOf(onlyUserInChannel("U", "C"), everyoneInWorkspace)).toEqual(onlyUserInChannel("U", "C"));
  });

  it("only-in-channel data reaches that person only while they're a member", () => {
    expect(readersMaySee(dmWith("U", ["C"]), onlyUserInChannel("U", "C"))).toBe(true);
    expect(readersMaySee(dmWith("U", []), onlyUserInChannel("U", "C"))).toBe(false);
    expect(readersMaySee(internalChannel("C"), onlyUserInChannel("U", "C"))).toBe(false);
  });

  it("nobody absorbs everything", () => {
    expect(strictestOf(nobody, everyoneInWorkspace)).toEqual(nobody);
    expect(strictestOf(onlyUser("U"), nobody)).toEqual(nobody);
  });

  it("never lets more readers see the result than could see either input", () => {
    const labels = [
      everyoneInWorkspace,
      membersOfChannel("C"),
      membersOfChannel("C", { insidersOnly: true }),
      membersOfChannel("D"),
      onlyUser("U"),
      onlyUser("V"),
      onlyUserInChannel("U", "C"),
      onlyUserInChannel("V", "D"),
      nobody,
    ];
    const readers = [
      dmWith("U", ["C"]),
      dmWith("U", []),
      dmWith("V", ["D"]),
      dmWith("V", ["C", "D"]),
      internalChannel("C"),
      internalChannel("D"),
      sharedChannel("C"),
    ];
    for (const a of labels)
      for (const b of labels)
        for (const r of readers) {
          if (readersMaySee(r, strictestOf(a, b))) {
            expect(readersMaySee(r, a) && readersMaySee(r, b)).toBe(true);
          }
        }
  });
});

describe("storage form", () => {
  it("round-trips", () => {
    for (const w of [
      everyoneInWorkspace,
      membersOfChannel("C1"),
      membersOfChannel("C1", { insidersOnly: true }),
      onlyUser("u-1"),
      onlyUserInChannel("u-1", "C1"),
      nobody,
    ]) {
      expect(parseWhoCanSee(describeWhoCanSee(w))).toEqual(w);
    }
  });

  it("anything unrecognized is treated as nobody", () => {
    expect(parseWhoCanSee("")).toEqual(nobody);
    expect(parseWhoCanSee("user:")).toEqual(nobody);
    expect(parseWhoCanSee("everyone")).toEqual(nobody);
    expect(parseWhoCanSee("user:u1@elsewhere")).toEqual(nobody);
  });
});
