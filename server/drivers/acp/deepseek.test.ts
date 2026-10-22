import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { removeTempDir } from "../../testing/cleanup.ts";
import {
  DEEPSEEK_MODELS,
  deepseekPickerId,
  deepseekSupport,
  deepseekWireValue,
  dshHome,
  hasDeepSeekKey,
} from "./deepseek.ts";

describe("DeepSeek model ids", () => {
  it("maps a picker id to dsh's JSON pair and back", () => {
    expect(deepseekWireValue("deepseek-official/deepseek-v4-pro")).toBe('["deepseek-official","deepseek-v4-pro"]');
    expect(deepseekPickerId('["deepseek-official","deepseek-v4-pro"]')).toBe("deepseek-official/deepseek-v4-pro");
  });

  it("splits on the first slash so gateway model ids keep their own slashes", () => {
    expect(deepseekWireValue("my-gateway/vendor/model-v2")).toBe('["my-gateway","vendor/model-v2"]');
    expect(deepseekPickerId('["my-gateway","vendor/model-v2"]')).toBe("my-gateway/vendor/model-v2");
  });

  it("passes an id without a provider through unchanged and rejects a non-pair", () => {
    expect(deepseekWireValue("deepseek-v4-pro")).toBe("deepseek-v4-pro");
    expect(deepseekPickerId("deepseek-v4-pro")).toBeNull();
    expect(deepseekPickerId('["only-one"]')).toBeNull();
    expect(deepseekPickerId('["a",1]')).toBeNull();
  });

  it("ships the three official models with V4-Flash as default", () => {
    expect(DEEPSEEK_MODELS.default).toBe("deepseek-official/deepseek-v4-flash");
    expect(DEEPSEEK_MODELS.options.map((o) => o.id)).toEqual([
      "deepseek-official/deepseek-v4-flash",
      "deepseek-official/deepseek-flash",
      "deepseek-official/deepseek-v4-pro",
    ]);
  });
});

describe("DeepSeek key detection", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    for (const d of dirs.splice(0)) await removeTempDir(d);
  });
  const home = () => {
    const d = mkdtempSync(join(tmpdir(), "omb-dsh-"));
    dirs.push(d);
    return d;
  };

  it("honours DSH_HOME over the default ~/.dsh", () => {
    expect(dshHome({ DSH_HOME: "/x/dsh", HOME: "/h" })).toBe("/x/dsh");
    expect(dshHome({ HOME: "/h" })).toBe(join("/h", ".dsh"));
  });

  it("is authenticated on DEEPSEEK_API_KEY in the env", () => {
    expect(hasDeepSeekKey({ DEEPSEEK_API_KEY: "sk-x", DSH_HOME: home() })).toBe(true);
    expect(hasDeepSeekKey({ DEEPSEEK_API_KEY: "  ", DSH_HOME: home() })).toBe(false);
  });

  it("reads a stored key from $DSH_HOME/.credentials.yaml", () => {
    const h = home();
    writeFileSync(join(h, ".credentials.yaml"), "DEEPSEEK_API_KEY: sk-stored\n");
    expect(hasDeepSeekKey({ DSH_HOME: h })).toBe(true);
  });

  it("treats an empty or commented credential as missing", () => {
    const h = home();
    writeFileSync(join(h, ".credentials.yaml"), "# DEEPSEEK_API_KEY: sk-old\nDEEPSEEK_API_KEY: \n");
    expect(hasDeepSeekKey({ DSH_HOME: h })).toBe(false);
  });

  it("accepts the harness-home .env fallback", () => {
    const h = home();
    writeFileSync(join(h, ".env"), "export DEEPSEEK_API_KEY=sk-env\n");
    expect(hasDeepSeekKey({ DSH_HOME: h })).toBe(true);
  });

  it("is not authenticated with no key anywhere", () => {
    const h = home();
    mkdirSync(join(h, "profiles"), { recursive: true });
    expect(hasDeepSeekKey({ DSH_HOME: h })).toBe(false);
  });
});

describe("DeepSeek ACP support", () => {
  it("spawns dsh in its ACP profile and selects model + variants over the wire", () => {
    expect(deepseekSupport.driverKind).toBe("deepseekAgent");
    expect(deepseekSupport.displayName).toBe("DeepSeek Harness");
    expect(deepseekSupport.defaultCli).toBe("dsh");
    expect(deepseekSupport.spawnArgs({ cli: "dsh", fullAuto: false }, {} as never)).toEqual(["--profile", "acp"]);
    expect(deepseekSupport.selectModel).toEqual({ configId: "model" });
    expect(deepseekSupport.modelVariants).toBe(true);
    expect(deepseekSupport.resumeMethod).toBe("resume");
    expect(deepseekSupport.resolveModelsOnCreate).toBe(false);
    expect(deepseekSupport.credentialEnv).toEqual(["DEEPSEEK_API_KEY"]);
    expect(deepseekSupport.authFailure).toBe("continue");
    expect(deepseekSupport.pickAuthMethod([], {})).toBeNull();
    expect(deepseekSupport.install?.command?.darwin).toBe("npm install -g @deepseek-ai/dsh");
    expect(deepseekSupport.install?.command?.win32).toBe("npm install -g @deepseek-ai/dsh");
    expect(deepseekSupport.install?.needsNode).toBe(true);
  });

  it("is authenticated exactly when a DeepSeek key is reachable", () => {
    expect(deepseekSupport.isAuthenticated({ DEEPSEEK_API_KEY: "sk-x", DSH_HOME: "/nonexistent/dsh" }, { cli: "dsh", fullAuto: false }, "deepseek")).toBe(true);
    expect(deepseekSupport.isAuthenticated({ DSH_HOME: "/nonexistent/dsh" }, { cli: "dsh", fullAuto: false }, "deepseek")).toBe(false);
  });

  it("resolves the turn model to the wire pair", () => {
    expect(deepseekSupport.resolveTurnModel?.("deepseek-official/deepseek-v4-pro", {})).toBe('["deepseek-official","deepseek-v4-pro"]');
    expect(deepseekSupport.resolveTurnModel?.(undefined, {})).toBeUndefined();
  });

  it("falls back to the catalog default when offered, else the session's current model", () => {
    const session = {
      configOptions: [{
        id: "model",
        currentValue: '["deepseek-official","deepseek-flash"]',
        options: [
          { group: "deepseek-official", options: [
            { value: '["deepseek-official","deepseek-flash"]' },
            { value: '["deepseek-official","deepseek-v4-flash"]' },
          ] },
        ],
      }],
    };
    expect(deepseekSupport.fallbackModel?.(session, "deepseek-official/deepseek-v4-flash")).toBe('["deepseek-official","deepseek-v4-flash"]');
    expect(deepseekSupport.fallbackModel?.(session, "deepseek-official/deepseek-v4-pro")).toBe('["deepseek-official","deepseek-flash"]');
    expect(deepseekSupport.fallbackModel?.({}, "deepseek-official/deepseek-v4-pro")).toBeNull();
  });

  it("puts the persona ahead of the prompt text", () => {
    expect(deepseekSupport.buildPromptText?.({ system: "You are Maus.", text: "hi" } as never)).toBe("You are Maus.\n\nhi");
    expect(deepseekSupport.buildPromptText?.({ system: "", text: "hi" } as never)).toBe("hi");
  });
});
