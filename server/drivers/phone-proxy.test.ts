import { describe, expect, it } from "vitest";

import { holdMs, createPhoneClaim, findPackages, parseDevices, parseLaunchablePackages, parseSteps, parseUiNodes, swipeLine } from "./phone-proxy.ts";

describe("phone MCP parsing", () => {
  it("keeps physical USB devices distinguishable from network and emulator transports", () => {
    expect(parseDevices(`List of devices attached
USB123 device product:husky model:Pixel_8 usb:1-2 transport_id:4
emulator-5554 device product:sdk model:Emulator transport_id:6
192.0.2.4:5555 device product:remote model:Remote transport_id:7
`)).toEqual([
      { serial: "USB123", state: "device", connection: "usb", model: "Pixel 8" },
      { serial: "emulator-5554", state: "device", connection: "emulator", model: "Emulator" },
      { serial: "192.0.2.4:5555", state: "device", connection: "network", model: "Remote" },
    ]);
  });

  it("extracts unique launchable packages", () => {
    expect(parseLaunchablePackages(`2 activities found:
      com.ubercab/.presidio.RootActivity
      net.skyscanner.android.main/net.skyscanner.shell.SplashActivity
      com.ubercab/.presidio.RootActivity
    `)).toEqual(["com.ubercab", "net.skyscanner.android.main"]);
  });

  it("resolves common human app names before using package-name heuristics", () => {
    const packages = ["com.ubercab", "net.skyscanner.android.main", "com.example.other"];
    expect(findPackages("Uber", packages)).toEqual(["com.ubercab"]);
    expect(findPackages("Skyscanner", packages)).toEqual(["net.skyscanner.android.main"]);
  });

  it("turns Android UI XML into tap-ready visible nodes", () => {
    expect(parseUiNodes(`<?xml version="1.0"?><hierarchy><node text="Where to?" resource-id="com.ubercab:id/input" class="android.widget.TextView" content-desc="Destination" bounds="[12,100][400,180]" /></hierarchy>`)).toEqual([
      { text: "Where to?", description: "Destination", id: "com.ubercab:id/input", className: "android.widget.TextView", bounds: [12, 100, 400, 180] },
    ]);
  });
});

describe("a held tap and a measured swipe", () => {
  it("reads a hold as whole milliseconds, and absent as no hold", () => {
    expect(holdMs(undefined)).toBe(0);
    expect(holdMs(1000)).toBe(1000);
    for (const value of [0, -5, 1.5, 20_000, "soon", null]) expect(holdMs(value)).toBeNull();
  });

  it("moves half the screen through its centre when nothing is chosen", () => {
    expect(swipeLine("up", 1000, 2000, {})).toEqual([500, 1500, 500, 500, 260]);
    expect(swipeLine("right", 1000, 2000, { duration_ms: 600 })).toEqual([250, 1000, 750, 1000, 600]);
  });

  it("starts where it is told and travels the distance it is told", () => {
    expect(swipeLine("up", 1000, 2000, { x: 300, y: 1800, distance: 900, duration_ms: 400 })).toEqual([300, 1800, 300, 900, 400]);
    expect(swipeLine("left", 1000, 2000, { x: 800, y: 500, distance: 200 })).toEqual([800, 500, 600, 500, 260]);
  });

  it("refuses a direction, a start or a duration it cannot act on", () => {
    expect(() => swipeLine("diagonal", 1000, 2000, {})).toThrow("direction must be up, down, left or right");
    expect(() => swipeLine("up", 1000, 2000, { x: 5000 })).toThrow("must fall on the screen");
    expect(() => swipeLine("up", 1000, 2000, { distance: 0 })).toThrow("positive number of pixels");
    expect(() => swipeLine("up", 1000, 2000, { duration_ms: 5 })).toThrow("duration_ms must be a whole number");
  });

  it("refuses a swipe whose finger would leave the screen, naming the screen's size", () => {
    // Android's own GestureDescription throws on a point outside the display, so the end is checked here.
    expect(() => swipeLine("up", 2000, 2000, { x: 1000, y: 400, distance: 900 })).toThrow("ends off the screen; the screen is 2000 by 2000");
    expect(swipeLine("down", 2000, 2000, { x: 1000, y: 1000, distance: 500 })).toEqual([1000, 1000, 1000, 1500, 260]);
  });
});

describe("a batch's steps", () => {
  it("takes a list of steps, each with a known action", () => {
    expect(parseSteps([{ action: "tap_text", text: "Search" }, { action: "wait", seconds: 2 }])).toHaveLength(2);
    // A model that sends the list as JSON text is read the same way.
    expect(parseSteps('[{"action":"press","key":"back"}]')).toHaveLength(1);
  });

  it("refuses an empty list, an unknown action and a wild wait before doing anything", () => {
    expect(() => parseSteps([])).toThrow("non-empty list");
    expect(() => parseSteps([{ action: "launch_missiles" }])).toThrow("step 1 has no known action");
    expect(() => parseSteps([{ action: "wait", seconds: 60 }])).toThrow("seconds must be 0 to 10");
    expect(() => parseSteps(Array.from({ length: 13 }, () => ({ action: "read_screen" })))).toThrow("at most 12 steps");
    for (const thrown of [(() => parseSteps([])), (() => parseSteps([{ action: "nope" }]))]) expect(thrown).toThrow("No step was performed");
  });
});

describe("phone MCP lazy claim gate", () => {
  const harnessEnv = { OMB_HARNESS_URL: "http://127.0.0.1:8799", OMB_PHONE_TOKEN: "tok" };
  const stub = (handler: (request: Request) => Promise<{ ok: boolean; status: number }>) => {
    const calls: Request[] = [];
    const fetchImpl = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const request = new Request(input, init);
      calls.push(request);
      return handler(request);
    }) as typeof fetch;
    return { calls, fetchImpl };
  };

  it("proceeds without a harness when the proxy runs standalone", async () => {
    const { calls, fetchImpl } = stub(async () => ({ ok: true, status: 200 }));
    const ensure = createPhoneClaim({}, fetchImpl);
    await expect(ensure()).resolves.toEqual({ ok: true });
    expect(calls).toHaveLength(0);
  });

  it("claims lazily and revalidates ownership on every call", async () => {
    const { calls, fetchImpl } = stub(async () => ({ ok: true, status: 200 }));
    const ensure = createPhoneClaim(harnessEnv, fetchImpl);
    expect(calls).toHaveLength(0);
    await expect(ensure()).resolves.toEqual({ ok: true });
    await expect(ensure()).resolves.toEqual({ ok: true });
    expect(calls).toHaveLength(2);
    expect(calls[0].headers.get("authorization")).toBe("Bearer tok");
  });

  it.each([401, 403, 409])("rejects a previously successful caller after ownership is lost (%s)", async (status) => {
    let active = true;
    const { calls, fetchImpl } = stub(async () => active ? { ok: true, status: 200 } : { ok: false, status });
    const ensure = createPhoneClaim(harnessEnv, fetchImpl);
    await expect(ensure()).resolves.toEqual({ ok: true });
    active = false;
    await expect(ensure()).resolves.toMatchObject({ ok: false });
    expect(calls).toHaveLength(2);
  });

  it("returns the blocked text on conflict and retries on a later call", async () => {
    let busy = true;
    const { calls, fetchImpl } = stub(async () => (busy ? { ok: false, status: 409 } : { ok: true, status: 200 }));
    const ensure = createPhoneClaim(harnessEnv, fetchImpl);
    const first = await ensure();
    expect(first).toEqual({ ok: false, message: "Another thread is using the phone. This call was not performed. Pause phone work until that thread finishes, then read the screen again before acting." });
    busy = false;
    await expect(ensure()).resolves.toEqual({ ok: true });
    expect(calls).toHaveLength(2);
  });

  it("names the ended turn when the capability is gone and stays honest on transport failure", async () => {
    let reject = false;
    const { fetchImpl } = stub(async () => (reject
      ? Promise.reject(new Error("fetch failed"))
      : Promise.resolve({ ok: false, status: 401 })));
    const ensure = createPhoneClaim(harnessEnv, fetchImpl);
    await expect(ensure()).resolves.toEqual({ ok: false, message: "This turn no longer has phone access. Start a new turn to use the phone." });
    reject = true;
    await expect(ensure()).resolves.toMatchObject({ ok: false, message: expect.stringContaining("could not be reached") });
  });
});
