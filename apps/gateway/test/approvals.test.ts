import { describe, expect, it } from "vitest";
import { parseApprovalReply } from "../src/approvals/parse.js";

describe("parseApprovalReply", () => {
  it.each(["YES", "yes!", " ok ", "Go ahead", "👍"])("reads %j as yes", (t) => {
    expect(parseApprovalReply(t)).toBe("yes");
  });
  it.each(["no", "Nope.", "cancel", "don't"])("reads %j as no", (t) => {
    expect(parseApprovalReply(t)).toBe("no");
  });
  it.each(["maybe", "yes but later", "what time?"])("is unsure about %j", (t) => {
    expect(parseApprovalReply(t)).toBeUndefined();
  });
});
