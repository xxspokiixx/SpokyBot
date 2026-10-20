/** A bot on My Cloud links to `/?connect=<id>` for a connection that needs the person there: an MCP server's sign-in
 * opens the MCP servers, where its Sign in is; HighLevel opens the apps. It only opens the page; it never signs in by
 * itself. Null for any other address. */
export function takeConnectRequest(href: string): { rest: string; surface: "mcp" | "apps" } | null {
  const url = new URL(href);
  const id = url.searchParams.get("connect");
  if (id === null) return null;
  url.searchParams.delete("connect");
  return { rest: `${url.pathname}${url.search}${url.hash}`, surface: /^mcp:[a-z][a-z0-9_-]{0,31}$/u.test(id) ? "mcp" : "apps" };
}
