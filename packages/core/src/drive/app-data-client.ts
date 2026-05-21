import type { drive_v3 } from "googleapis";
import { AppDataError, type AppDataClient } from "./types.js";

export function createDriveAppDataClient(drive: drive_v3.Drive): AppDataClient {
  async function findFileId(fileName: string): Promise<string | null> {
    try {
      const res = await drive.files.list({
        spaces: "appDataFolder",
        q: `name = '${fileName}'`,
        fields: "files(id, name)",
        pageSize: 1,
      });
      return res.data.files?.[0]?.id ?? null;
    } catch (err) {
      throw classifyError(err);
    }
  }

  return {
    async readJson<T>(fileName: string): Promise<T | null> {
      const fileId = await findFileId(fileName);
      if (!fileId) return null;

      try {
        const res = await drive.files.get(
          { fileId, alt: "media" },
          { responseType: "text" },
        );
        return JSON.parse(res.data as string) as T;
      } catch (err) {
        const classified = classifyError(err);
        if (classified.code === "not_found") return null;
        throw classified;
      }
    },

    async writeJson(fileName: string, data: unknown): Promise<void> {
      const body = JSON.stringify(data);
      const fileId = await findFileId(fileName);

      try {
        if (fileId) {
          await drive.files.update({
            fileId,
            media: { mimeType: "application/json", body },
          });
        } else {
          await drive.files.create({
            requestBody: {
              name: fileName,
              parents: ["appDataFolder"],
              mimeType: "application/json",
            },
            media: { mimeType: "application/json", body },
          });
        }
      } catch (err) {
        throw classifyError(err);
      }
    },

    async deleteFile(fileName: string): Promise<boolean> {
      const fileId = await findFileId(fileName);
      if (!fileId) return false;

      try {
        await drive.files.delete({ fileId });
        return true;
      } catch (err) {
        const classified = classifyError(err);
        if (classified.code === "not_found") return false;
        throw classified;
      }
    },

    async listFiles(): Promise<Array<{ id: string; name: string }>> {
      try {
        const res = await drive.files.list({
          spaces: "appDataFolder",
          fields: "files(id, name)",
          pageSize: 100,
        });
        return (res.data.files ?? [])
          .filter((f): f is { id: string; name: string } => !!f.id && !!f.name)
          .map((f) => ({ id: f.id, name: f.name }));
      } catch (err) {
        throw classifyError(err);
      }
    },
  };
}

function classifyError(err: unknown): AppDataError {
  const status = (err as { code?: number })?.code;
  const message = (err as Error)?.message ?? String(err);

  if (status === 401) return new AppDataError("auth_failed", message, err);
  if (status === 403) return new AppDataError("scope_missing", message, err);
  if (status === 404) return new AppDataError("not_found", message, err);
  if (status === 429) return new AppDataError("rate_limited", message, err);
  return new AppDataError("network", message, err);
}
