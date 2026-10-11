import { describe, expect, it } from "vitest";
import { detectEmergency } from "../src/safety/rules.js";

describe("detectEmergency", () => {
  it.each([
    "I fell in the kitchen",
    "I have fallen and can't get up",
    "having chest pain",
    "I can't breathe",
    "please call 911",
    "help me",
  ])("flags %j", (text) => {
    expect(detectEmergency(text).emergency).toBe(true);
  });

  it.each([
    "Can you book me a ride to Dr. Patel tomorrow?",
    "The leaves fall in autumn",
    "Thanks, see you Tuesday",
  ])("does not flag %j", (text) => {
    expect(detectEmergency(text).emergency).toBe(false);
  });
});
