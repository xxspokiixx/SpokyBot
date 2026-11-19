/** The phone tools a step of the phone server's batch tool can run; a batch may run only where all of them may. */
export const PHONE_STEP_TOOLS = ["open_app", "tap_text", "tap", "swipe", "type_text", "press", "read_screen"] as const;

export type PhoneStepTool = (typeof PHONE_STEP_TOOLS)[number];

/** A step of `batch`, as the model writes it: the tool's own fields plus `action`. `wait` gives content time to load. */
export type PhoneStep =
  | { action: PhoneStepTool; [field: string]: unknown }
  | { action: "wait"; seconds: number };

export type PhoneStepAction = PhoneStepTool | "wait";

export const MAX_STEPS = 12;
export const MAX_WAIT_SECONDS = 10;
