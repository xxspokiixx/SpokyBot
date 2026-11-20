import { describe, expect, it } from "vitest";

import { createPhoneHold } from "../phone-hold.ts";
import type { RequestAuth } from "../request-auth.ts";
import { createPhoneHoldRoutes, PHONE_HOLD_PATH } from "./phone-hold.ts";

async function call(hold: ReturnType<typeof createPhoneHold>, init: { method: string; admin?: boolean; body?: unknown }) {
  const written: { status: number; body: unknown }[] = [];
  const out = await createPhoneHoldRoutes({ hold, isAdmin: (auth) => auth.scopes.includes("admin") })({
    req: {} as never,
    res: { setHeader: () => {}, headersSent: false, writableEnded: false } as never,
    url: new URL(`http://127.0.0.1${PHONE_HOLD_PATH}`),
    path: PHONE_HOLD_PATH,
    method: init.method,
    auth: { kind: "loopback", scopes: init.admin ? ["admin"] : [] } as unknown as RequestAuth,
    json: ((_res: unknown, status: number, body: unknown) => { written.push({ status, body }); return undefined; }) as never,
    readBody: (async () => init.body ?? null) as never,
  });
  return out === undefined || written.length ? written[0] ?? null : null;
}

describe("the phone hold route", () => {
  it("leaves other paths alone", async () => {
    const out = await createPhoneHoldRoutes({ hold: createPhoneHold(), isAdmin: () => true })({
      req: {} as never, res: {} as never, url: new URL("http://x/other"), path: "/other", method: "GET", auth: {} as never, json: (() => {}) as never, readBody: (async () => null) as never,
    });
    expect(out).not.toBeUndefined();
  });

  it("refuses a member: pausing every bot's phone work is an admin's", async () => {
    expect(await call(createPhoneHold(), { method: "GET", admin: false })).toMatchObject({ status: 403 });
  });

  it("takes the phone, says so, and hands it back", async () => {
    const hold = createPhoneHold();
    expect((await call(hold, { method: "PUT", admin: true, body: { held: true } }))!.body).toEqual({ held: true });
    expect(hold.held).toBe(true);
    expect((await call(hold, { method: "GET", admin: true }))!.body).toEqual({ held: true });
    expect((await call(hold, { method: "PUT", admin: true, body: { held: false } }))!.body).toEqual({ held: false });
    expect(hold.held).toBe(false);
  });

  it("restarts the idle time for input without taking or releasing", async () => {
    const hold = createPhoneHold();
    hold.take();
    expect((await call(hold, { method: "PUT", admin: true, body: { used: true } }))!.body).toEqual({ held: true });
    expect(hold.held).toBe(true);
  });

  it("changes nothing for a body that asks for nothing", async () => {
    const hold = createPhoneHold();
    expect((await call(hold, { method: "PUT", admin: true, body: {} }))!.status).toBe(400);
    expect(hold.held).toBe(false);
  });

  it("answers 405 for a method it does not take", async () => {
    expect((await call(createPhoneHold(), { method: "DELETE", admin: true }))!.status).toBe(405);
  });
});
