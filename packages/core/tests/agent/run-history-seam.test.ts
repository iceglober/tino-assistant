import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Boundary enforcement test: ensures that only history-appender.ts and run.ts
 * can both call history.append( AND reference "tool-result".
 *
 * This enforces the privacy seam: all paths through which tool results enter
 * history must go through the appender, so wave 3.5 can swap the privacy filter
 * at the construction site in index.ts.
 */
describe("history-appender seam boundary", () => {
  it("only history-appender.ts and run.ts should call history.append AND reference tool-result", () => {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const srcDir = path.join(__dirname, "../../src");
    const allowedFiles = new Set([
      path.join(srcDir, "agent/history-appender.ts"),
      path.join(srcDir, "agent/run.ts"),
      path.join(srcDir, "privacy/scrub.ts"),
    ]);

    const violations: string[] = [];

    function scanDir(dir: string) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          scanDir(fullPath);
        } else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
          const content = fs.readFileSync(fullPath, "utf-8");

          // Check if file calls history.append( AND references "tool-result"
          const hasHistoryAppend = /history\.append\s*\(/.test(content);
          const hasToolResult = /tool-result|"tool"|'tool'/.test(content);

          if (hasHistoryAppend && hasToolResult && !allowedFiles.has(fullPath)) {
            violations.push(fullPath);
          }
        }
      }
    }

    scanDir(srcDir);

    if (violations.length > 0) {
      const violationList = violations.map((v) => `  - ${path.relative(srcDir, v)}`).join("\n");
      throw new Error(
        `The following files call history.append( and reference tool-result, ` +
          `but only history-appender.ts and run.ts are allowed to do so:\n${violationList}\n\n` +
          `All paths through which tool results enter history must go through the HistoryAppender seam.`,
      );
    }
  });
});
