import { describe, expect, it } from "vitest";
import { pilotEntries } from "./workspaceTestFixtures";
import { filterPilotEntries, formatAuditAction, getWorkspaceMetrics, pageFromHash, pageHash, STATUS_LABELS } from "./workspaceModel";

describe("workspace model", () => {
  it("counts entries once, persisted result rows, pending entries, and visible audit events", () => {
    expect(getWorkspaceMetrics(pilotEntries)).toEqual({
      entries: 3,
      results: 1,
      pending: 2,
      events: 2,
    });
  });

  it("filters by exact persisted value text and state without dropping pending entries that have a result", () => {
    expect(filterPilotEntries(pilotEntries, "00010.1200", "pendente").map(({ id }) => id)).toEqual(["entry-001"]);
    expect(filterPilotEntries(pilotEntries, "ENTRY-003", "validada").map(({ id }) => id)).toEqual(["entry-003"]);
    expect(filterPilotEntries(pilotEntries, "", "pendente").map(({ id }) => id)).toEqual([
      "entry-001",
      "entry-002",
    ]);
    expect(STATUS_LABELS.pendente).toBe("Pendente");
  });

  it("accepts only workspace hashes and maps each page back to a stable hash", () => {
    expect(pageFromHash("#entries")).toBe("entries");
    expect(pageFromHash("#history")).toBe("history");
    expect(pageFromHash("#overview")).toBe("overview");
    expect(pageFromHash("#admin")).toBe("overview");
    expect(pageHash("history")).toBe("#history");
  });

  it("humanizes the known submission event and preserves unknown persisted actions", () => {
    expect(formatAuditAction("demo.entry.submitted")).toBe("Entrada enviada");
    expect(formatAuditAction("future.event.persisted")).toBe("future.event.persisted");
  });
});
