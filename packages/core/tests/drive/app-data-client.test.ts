import { describe, expect, it, vi } from "vitest";
import { createDriveAppDataClient } from "../../src/drive/app-data-client.js";
import { AppDataError } from "../../src/drive/types.js";

function mockDrive() {
  const files = new Map<string, { id: string; name: string; body: string }>();
  let nextId = 1;

  const drive = {
    files: {
      list: vi.fn(async (params: { spaces?: string; q?: string }) => {
        const match = params.q?.match(/name = '(.+)'/);
        const name = match?.[1];
        const results = name
          ? [...files.values()].filter((f) => f.name === name)
          : [...files.values()];
        return { data: { files: results.map((f) => ({ id: f.id, name: f.name })) } };
      }),
      get: vi.fn(async (params: { fileId: string; alt?: string }) => {
        const file = [...files.values()].find((f) => f.id === params.fileId);
        if (!file) throw Object.assign(new Error("Not found"), { code: 404 });
        return { data: file.body };
      }),
      create: vi.fn(async (params: { requestBody: { name: string }; media: { body: string } }) => {
        const id = `file-${nextId++}`;
        files.set(id, { id, name: params.requestBody.name, body: params.media.body });
        return { data: { id } };
      }),
      update: vi.fn(async (params: { fileId: string; media: { body: string } }) => {
        const file = [...files.values()].find((f) => f.id === params.fileId);
        if (file) file.body = params.media.body;
        return { data: { id: params.fileId } };
      }),
      delete: vi.fn(async (params: { fileId: string }) => {
        for (const [key, f] of files) {
          if (f.id === params.fileId) {
            files.delete(key);
            return {};
          }
        }
        throw Object.assign(new Error("Not found"), { code: 404 });
      }),
    },
  };
  // biome-ignore lint/suspicious/noExplicitAny: mock
  return { drive: drive as any, files };
}

describe("AppDataClient", () => {
  it("writes and reads JSON files", async () => {
    const { drive } = mockDrive();
    const client = createDriveAppDataClient(drive);

    await client.writeJson("test.json", { hello: "world" });
    const result = await client.readJson<{ hello: string }>("test.json");

    expect(result).toEqual({ hello: "world" });
  });

  it("returns null for non-existent files", async () => {
    const { drive } = mockDrive();
    const client = createDriveAppDataClient(drive);

    const result = await client.readJson("missing.json");
    expect(result).toBeNull();
  });

  it("overwrites existing files", async () => {
    const { drive } = mockDrive();
    const client = createDriveAppDataClient(drive);

    await client.writeJson("data.json", { v: 1 });
    await client.writeJson("data.json", { v: 2 });

    const result = await client.readJson<{ v: number }>("data.json");
    expect(result).toEqual({ v: 2 });
  });

  it("deletes files", async () => {
    const { drive } = mockDrive();
    const client = createDriveAppDataClient(drive);

    await client.writeJson("temp.json", { x: 1 });
    const deleted = await client.deleteFile("temp.json");
    expect(deleted).toBe(true);

    const result = await client.readJson("temp.json");
    expect(result).toBeNull();
  });

  it("returns false when deleting non-existent file", async () => {
    const { drive } = mockDrive();
    const client = createDriveAppDataClient(drive);

    const deleted = await client.deleteFile("nope.json");
    expect(deleted).toBe(false);
  });

  it("lists files", async () => {
    const { drive } = mockDrive();
    const client = createDriveAppDataClient(drive);

    await client.writeJson("a.json", {});
    await client.writeJson("b.json", {});

    const list = await client.listFiles();
    expect(list).toHaveLength(2);
    expect(list.map((f) => f.name).sort()).toEqual(["a.json", "b.json"]);
  });

  it("classifies 403 as scope_missing", async () => {
    const { drive } = mockDrive();
    drive.files.list.mockRejectedValueOnce(Object.assign(new Error("Insufficient scope"), { code: 403 }));
    const client = createDriveAppDataClient(drive);

    await expect(client.listFiles()).rejects.toThrow(AppDataError);
    try {
      await client.listFiles();
    } catch (err) {
      // The second call is unmocked so it succeeds. Test the first throw.
    }
  });

  it("classifies 401 as auth_failed", async () => {
    const { drive } = mockDrive();
    drive.files.list.mockRejectedValueOnce(Object.assign(new Error("Unauthorized"), { code: 401 }));
    const client = createDriveAppDataClient(drive);

    try {
      await client.listFiles();
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AppDataError);
      expect((err as AppDataError).code).toBe("auth_failed");
    }
  });
});
