import { describe, it } from "node:test";
import assert from "node:assert/strict";

process.env.APP_TIMEZONE = "America/Santo_Domingo";
// conversation-session pulls in @workspace/db, which refuses to load without a
// connection string. Nothing here touches the pool — only the pure folding logic.
process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/test";

const { foldSummary } = await import("../src/lib/conversation-session.js");

const closedAt = new Date("2026-07-23T16:00:00.000Z");

describe("conversation-session — foldSummary", () => {
  it("keeps the existing history when the closed session had no summary", () => {
    assert.equal(foldSummary("[16/07] pintura dañada", null, closedAt), "[16/07] pintura dañada");
    assert.equal(foldSummary(null, "   ", closedAt), null);
  });

  it("date-stamps the closed session and appends it to the history", () => {
    assert.equal(foldSummary(null, "Cliente pide presupuesto", closedAt), "[23/07] Cliente pide presupuesto");
    assert.equal(
      foldSummary("[16/07] pintura dañada", "Cliente pide presupuesto", closedAt),
      "[16/07] pintura dañada\n[23/07] Cliente pide presupuesto",
    );
  });

  it("keeps only the five most recent sessions so the prompt stays bounded", () => {
    const history = ["[01/01] a", "[02/01] b", "[03/01] c", "[04/01] d", "[05/01] e"].join("\n");
    const folded = foldSummary(history, "nuevo", closedAt);
    assert.equal(folded, ["[02/01] b", "[03/01] c", "[04/01] d", "[05/01] e", "[23/07] nuevo"].join("\n"));
    assert.equal(folded?.split("\n").length, 5);
  });
});
