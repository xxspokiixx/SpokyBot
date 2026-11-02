// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ConfigStatus } from "@/state/store";

const fixture = vi.hoisted(() => ({ config: {} as Partial<ConfigStatus>, dispatch: vi.fn(), api: vi.fn(), upload: vi.fn() }));
vi.mock("@/state/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/state/store")>()),
  api: fixture.api,
  useStore: () => ({ state: { config: fixture.config }, dispatch: fixture.dispatch }),
}));
vi.mock("./AboutMeSettings", () => ({ AboutMeSettings: () => null }));
vi.mock("@/lib/composer-attachments", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/composer-attachments")>()),
  imageAttachmentFromFile: fixture.upload,
}));

const { ProfileFields, profilePhotoFileProblem, profilePhotoSizeProblem } = await import("./ProfileSettings");
const { InitialsAvatar } = await import("./Avatar");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
const photo = "/api/attachments/5f0c2b1e-8a43-4c1d-9e7a-2b6f1d3c4e5a.webp";

beforeEach(() => {
  fixture.dispatch.mockReset();
  fixture.api.mockReset();
  fixture.upload.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("the profile photo", () => {
  it("takes only a PNG, JPEG, GIF or WebP of at most 10 MB", () => {
    expect(profilePhotoFileProblem({ type: "image/jpeg", size: 2_000_000 })).toBeNull();
    expect(profilePhotoFileProblem({ type: "image/webp; charset=binary", size: 10 * 1024 * 1024 })).toBeNull();
    expect(profilePhotoFileProblem({ type: "image/svg+xml", size: 900 })).toBe("settings.profile.avatar.invalidType");
    expect(profilePhotoFileProblem({ type: "image/heic", size: 900 })).toBe("settings.profile.avatar.invalidType");
    expect(profilePhotoFileProblem({ type: "image/png", size: 10 * 1024 * 1024 + 1 })).toBe("settings.profile.avatar.tooLarge");
  });

  it("refuses a picture too small to crop or too large to decode", () => {
    expect(profilePhotoSizeProblem(64, 64)).toBeNull();
    expect(profilePhotoSizeProblem(8192, 300)).toBeNull();
    expect(profilePhotoSizeProblem(63, 400)).toBe("settings.profile.avatar.tooSmall");
    expect(profilePhotoSizeProblem(400, 8193)).toBe("settings.profile.avatar.tooLargeDimensions");
  });

  it("shows the saved photo and removes it with an empty address", async () => {
    fixture.config = { profile: { name: "Ada", email: "", avatarUrl: photo } };
    fixture.api.mockResolvedValue({ profile: { name: "Ada", email: "" } });
    await act(async () => root.render(createElement(ProfileFields)));
    expect(host.querySelector(`img[src="${photo}"]`)).not.toBeNull();
    const remove = [...host.querySelectorAll("button")].find((button) => button.textContent === "Remove photo")!;
    await act(async () => remove.click());
    expect(fixture.api).toHaveBeenCalledWith("/api/config", { method: "PUT", body: JSON.stringify({ profile: { avatarUrl: "" } }) });
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "profileSaved", profile: { avatarUrl: undefined } });
  });

  it("stores the cropped photo in local attachments before saving its profile address", async () => {
    fixture.config = { profile: { name: "Ada", email: "" } };
    fixture.upload.mockResolvedValue({ path: `/data/attachments/${photo.split("/").at(-1)}` });
    fixture.api.mockResolvedValue({ profile: { name: "Ada", email: "", avatarUrl: photo } });
    vi.stubGlobal("Image", class {
      naturalWidth = 128;
      naturalHeight = 128;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) { queueMicrotask(() => this.onload?.()); }
    });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:profile-photo");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
    Object.defineProperty(HTMLCanvasElement.prototype, "toBlob", {
      configurable: true,
      value: (callback: BlobCallback) => callback(new Blob(["webp"], { type: "image/webp" })),
    });
    try {
      await act(async () => root.render(createElement(ProfileFields)));
      const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
      Object.defineProperty(input, "files", { configurable: true, value: [new File(["source"], "portrait.png", { type: "image/png" })] });
      await act(async () => {
        input.dispatchEvent(new Event("change", { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(host.textContent).toContain("Adjust your photo");
      await act(async () => {
        [...host.querySelectorAll("button")].find((button) => button.textContent === "Save photo")!.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(fixture.upload).toHaveBeenCalledWith(expect.objectContaining({ type: "image/webp" }));
      expect(fixture.api).toHaveBeenCalledWith("/api/config", { method: "PUT", body: JSON.stringify({ profile: { avatarUrl: photo } }) });
      expect(fixture.dispatch).toHaveBeenCalledWith({ type: "profileSaved", profile: { avatarUrl: photo } });
      expect(host.querySelector('[role="alert"]')).toBeNull();
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });

  it("never sends the photo with a name or email save, so a stale copy cannot overwrite a newer one", async () => {
    fixture.config = { profile: { name: "Ada", email: "", avatarUrl: photo } };
    const sent: unknown[] = [];
    vi.stubGlobal("fetch", (_path: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)));
      return Promise.resolve(new Response(JSON.stringify({ profile: { name: "Ada", email: "" } })));
    });
    try {
      await act(async () => root.render(createElement(ProfileFields)));
      const name = host.querySelector<HTMLInputElement>('input[aria-label="Your name"]')!;
      await act(async () => name.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
      expect(sent).toEqual([{ profile: { name: "Ada", email: "" } }]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("saves only the signed-in person's own profile on a team, never the server's, and keeps their sign-in address", async () => {
    fixture.config = { team: { id: "team-acme-1", name: "Acme" }, profile: { name: "Bob", email: "bob@acme.test", avatarUrl: photo } };
    fixture.api.mockResolvedValue({ name: "Bob Builder", email: "bob@acme.test", aboutMe: "" });
    const fetched = vi.fn();
    vi.stubGlobal("fetch", fetched);
    try {
      await act(async () => root.render(createElement(ProfileFields)));
      const email = host.querySelector<HTMLInputElement>('input[type="email"]')!;
      expect(email.readOnly).toBe(true);
      expect(email.value).toBe("bob@acme.test");
      const name = host.querySelector<HTMLInputElement>('input[aria-label="Your name"]')!;
      await act(async () => name.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
      expect(fixture.api).toHaveBeenCalledWith("/api/me", { method: "PUT", body: JSON.stringify({ name: "Bob" }), timeoutMs: 10_000 });
      expect(fixture.dispatch).toHaveBeenCalledWith({ type: "profileSaved", profile: { name: "Bob Builder", email: "bob@acme.test" } });
      const remove = [...host.querySelectorAll("button")].find((button) => button.textContent === "Remove photo")!;
      await act(async () => remove.click());
      expect(fixture.api).toHaveBeenLastCalledWith("/api/me", { method: "PUT", body: JSON.stringify({ avatarUrl: "" }), timeoutMs: 10_000 });
      expect(fetched).not.toHaveBeenCalled();
      expect(fixture.api.mock.calls.map(([path]) => path)).not.toContain("/api/config");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("falls back to the initials in the sidebar when the stored picture is gone", async () => {
    await act(async () => root.render(createElement(InitialsAvatar, { initials: "AL", avatarUrl: photo })));
    const image = host.querySelector("img")!;
    expect(image.getAttribute("src")).toBe(photo);
    await act(async () => image.dispatchEvent(new Event("error")));
    expect(host.querySelector("img")).toBeNull();
    expect(host.textContent).toBe("AL");
  });
});
