import type { ProviderSnapshot } from "../contracts.ts";

/** What a Claude instance's turns bill: `claude -p` runs on an ANTHROPIC_API_KEY in its environment ahead of any login,
 * billed per token (2.1.303), as it does on the CLI's own API-key sign-in. */
export function claudeBilling(env: NodeJS.ProcessEnv, account: ProviderSnapshot["account"]): Pick<ProviderSnapshot, "account" | "billing"> {
  return env.ANTHROPIC_API_KEY || account?.method === "api-key"
    ? { account: { ...account, method: "api-key" }, billing: "metered" }
    : { billing: "subscription" };
}
