import { describe, expect, it } from "vitest";
import { parseBlocks, parseInline, safeHref } from "./markdown";

describe("parseInline", () => {
  it("keeps plain text whole", () => expect(parseInline("hello there")).toEqual([{ t: "text", v: "hello there" }]));

  it("parses code, bold, italic and strike", () => {
    expect(parseInline("run `bun i` **now** *please* ~~not~~")).toEqual([
      { t: "text", v: "run " },
      { t: "code", v: "bun i" },
      { t: "text", v: " " },
      { t: "strong", c: [{ t: "text", v: "now" }] },
      { t: "text", v: " " },
      { t: "em", c: [{ t: "text", v: "please" }] },
      { t: "text", v: " " },
      { t: "del", c: [{ t: "text", v: "not" }] },
    ]);
  });

  it("does not italicize snake_case or multiplication", () => {
    expect(parseInline("my_var_name and 2*3*4")).toEqual([{ t: "text", v: "my_var_name and 2*3*4" }]);
  });

  it("parses markdown, Slack and bare links", () => {
    expect(parseInline("[docs](https://x.dev/a)")).toEqual([
      { t: "link", href: "https://x.dev/a", c: [{ t: "text", v: "docs" }] },
    ]);
    expect(parseInline("<https://x.dev|site>")).toEqual([
      { t: "link", href: "https://x.dev", c: [{ t: "text", v: "site" }] },
    ]);
    expect(parseInline("see https://x.dev/p.")).toEqual([
      { t: "text", v: "see " },
      { t: "link", href: "https://x.dev/p", c: [{ t: "text", v: "https://x.dev/p" }] },
      { t: "text", v: "." },
    ]);
  });

  it("refuses javascript: links", () => {
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("https://ok.dev")).toBe("https://ok.dev");
    expect(parseInline("[x](javascript:void)").some((n) => n.t === "link")).toBe(false);
  });
});

describe("parseBlocks", () => {
  it("splits paragraphs on blank lines and keeps line breaks", () => {
    const b = parseBlocks("one\ntwo\n\nthree");
    expect(b).toHaveLength(2);
    expect(b[0]).toEqual({ t: "p", lines: [[{ t: "text", v: "one" }], [{ t: "text", v: "two" }]] });
  });

  it("reads bullet and numbered lists", () => {
    const b = parseBlocks("- a\n* b\n• c\n\n3. x\n4) y");
    expect(b[0]).toMatchObject({ t: "ul", items: [[{ v: "a" }], [{ v: "b" }], [{ v: "c" }]] });
    expect(b[1]).toMatchObject({ t: "ol", start: 3 });
  });

  it("reads fenced code verbatim", () => {
    const b = parseBlocks("```ts\nconst a = **1**;\n```\nafter");
    expect(b[0]).toEqual({ t: "code", lang: "ts", v: "const a = **1**;" });
    expect(b[1]?.t).toBe("p");
  });

  it("reads headings and quotes", () => {
    const b = parseBlocks("## Plan\n> quoted\n> more");
    expect(b[0]?.t).toBe("h");
    expect(b[1]).toMatchObject({ t: "quote" });
  });

  it("survives an unclosed fence", () => {
    expect(parseBlocks("```\nopen")).toEqual([{ t: "code", lang: "", v: "open" }]);
  });
});
