import { describe, expect, it } from "vitest";
import { announcesAction } from "./openai-chat.ts";

describe("announcesAction", () => {
  it.each([
    "I'm working in the Cua Local VM and will launch XFCE Terminal first.",
    "I am in the Local VM and will open the browser first.",
    "I'm in the VM and I will check the files.",
    "I’m in the VM and will launch XFCE Terminal first.",
    "I'll open the browser.",
    "Opening the page now:",
  ])("recognizes a short action announcement: %s", text => {
    expect(announcesAction(text)).toBe(true);
  });

  it.each([
    "",
    "I'm working in the Cua Local VM.",
    "I'm done and will be available tomorrow.",
    "I'm waiting and will need your approval first.",
    "I'm in the VM. The user will launch XFCE Terminal first.",
    "The instructions say I will launch XFCE Terminal first.",
    "I'm in the VM and will launch XFCE Terminal first. Is that okay?",
    "The terminal is open and the task is complete.",
    `I'm in the VM and will launch the terminal. ${"x".repeat(400)}`,
  ])("leaves final replies, questions and long replies alone: %s", text => {
    expect(announcesAction(text)).toBe(false);
  });
});
