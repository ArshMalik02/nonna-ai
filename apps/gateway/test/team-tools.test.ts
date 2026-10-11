import { describe, expect, it } from "vitest";
import { isAutoApprovedTool } from "../src/omb/bridge.js";

describe("isAutoApprovedTool", () => {
  it("approves Nonna's own tools and handing work to the specialists", () => {
    expect(isAutoApprovedTool("mcp__nonna__darwin_search")).toBe(true);
    expect(isAutoApprovedTool("coordinate_bots")).toBe(true);
    expect(isAutoApprovedTool("mcp__openmausbot__coordinate_bots")).toBe(true);
  });

  it("leaves everything else for a person", () => {
    expect(isAutoApprovedTool("Bash")).toBe(false);
    expect(isAutoApprovedTool("mcp__other__darwin_search")).toBe(false);
    expect(isAutoApprovedTool("mcp__nonna_evil__create_task")).toBe(false);
    expect(isAutoApprovedTool("not_coordinate_bots")).toBe(false);
  });
});
