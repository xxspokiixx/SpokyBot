// The agents catalog's read-only X research tools and the internal route behind each. Every call counts against the
// person's Cloud plan's X calls, so a bot is shown them only when switched on with the plan's relay credential held, and
// each route checks both again before it spends.
import type { ToolCallContext, ToolCallResult } from "./agents-call.ts";
import type { Json } from "./agents-client.ts";

const X_TOOL_ROUTES: Readonly<Record<string, string>> = { x_search: "search", x_user_posts: "user-posts", x_post: "post", x_profile: "profile" };
export const X_TOOL_NAMES: ReadonlySet<string> = new Set(Object.keys(X_TOOL_ROUTES));

export async function callXTool(name: string, args: Json, context: ToolCallContext): Promise<ToolCallResult> {
  const { ok, body } = await context.client.apiResponse(`/api/internal/x/${X_TOOL_ROUTES[name]}`, { method: "POST", body: JSON.stringify(args) });
  return ok ? { text: JSON.stringify(body) } : { text: String(body.error ?? "X research failed. Try again shortly."), isError: true };
}

export const X_TOOL_DEFINITIONS = [
  {
    name: "x_search",
    description:
      "Search posts on X (Twitter) without an X account; included with the user's MausBot Cloud plan. Each call counts against the plan's monthly X research calls, so write one well-filtered query instead of many broad ones. The query takes X operators: from:handle, to:handle, \"exact phrase\", since:YYYY-MM-DD, until:YYYY-MM-DD, min_faves:N, -filter:replies, lang:en, OR. Bare words are all required, so use a short phrase or OR between alternatives. Returns compact posts (link, author, time, text, likes, reposts, replies, quotes, views) and newestId. To monitor X, for example in a routine, keep newestId and pass it back as sinceId next time to get only newer posts. Read-only: you cannot post, like or reply.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: { type: "string", minLength: 1, maxLength: 512, description: "The X search query; operators allowed." },
        sort: { type: "string", enum: ["latest", "top"], description: "latest (default) or top." },
        limit: { type: "integer", minimum: 1, maximum: 50, description: "How many posts, 1-50. Default 20." },
        sinceId: { type: "string", pattern: "^\\d{1,25}$", description: "Only posts newer than this post id: a newestId from an earlier call." },
      },
      required: ["query"],
    },
  },
  {
    name: "x_user_posts",
    description:
      "Read an X account's recent posts, newest first (each call counts against the plan's monthly X research calls). Returns compact posts and newestId; pass newestId back as sinceId later to get only newer posts. Read-only.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        handle: { type: "string", minLength: 1, description: "The account: @handle, handle, or an x.com profile link." },
        limit: { type: "integer", minimum: 1, maximum: 50, description: "How many posts, 1-50. Default 20." },
        sinceId: { type: "string", pattern: "^\\d{1,25}$", description: "Only posts newer than this post id." },
        includeReplies: { type: "boolean", description: "Include the account's replies to others. Default false." },
      },
      required: ["handle"],
    },
  },
  {
    name: "x_post",
    description:
      "Read one X post from its link or id, and optionally the first page of up to 20 replies to it (each call counts against the plan's monthly X research calls). Read-only.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        post: { type: "string", minLength: 1, description: "An x.com or twitter.com post link, or the post id." },
        replies: { type: "boolean", description: "Also return replies to the post. Default false." },
      },
      required: ["post"],
    },
  },
  {
    name: "x_profile",
    description:
      "Look up an X account's profile: name, bio, followers, following, post count and verified status. Counts against the plan's monthly X research calls. Read-only.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        handle: { type: "string", minLength: 1, description: "The account: @handle, handle, or an x.com profile link." },
      },
      required: ["handle"],
    },
  },
];
