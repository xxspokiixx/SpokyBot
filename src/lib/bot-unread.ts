export function botShowsUnread(bot: {
  unread?: boolean;
  tasks?: ReadonlyArray<{ unread?: boolean; routineRunId?: string; archivedAt?: number }> | null;
}): boolean {
  if (!bot.tasks?.length) return Boolean(bot.unread);
  return bot.tasks.some((task) => Boolean(task.unread) && !task.routineRunId && task.archivedAt === undefined);
}

export function titleWithUnread(name: string, count: number): string {
  return count > 0 ? `(${count}) ${name}` : name;
}

export function showBrowserUnread(count: number, name: string): void {
  document.title = titleWithUnread(name, count);
  // Chromium and Safari badge an installed web app's icon from this; other browsers lack the API.
  const badge = count > 0 ? navigator.setAppBadge?.(count) : navigator.clearAppBadge?.();
  void badge?.catch(() => {});
}
