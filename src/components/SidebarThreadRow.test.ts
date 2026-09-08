import { describe, expect, it } from "vitest";
import { visibleSidebarThreads } from "./SidebarThreadRow";

describe("sidebar thread visibility", () => {
  const tasks = Array.from({ length: 10 }, (_, index) => ({ threadId: String(index), title: `Thread ${index}`, ...(index > 7 ? { projectId: "research" } : {}) }));
  it("keeps the active and attention-needed threads visible beyond the six recent rows", () => {
    const rows = tasks.map((task) => ({ ...task, busy: task.threadId === "7", unread: task.threadId === "9" }));
    expect(visibleSidebarThreads(rows, "8").map((task) => task.threadId)).toEqual(["0", "1", "2", "3", "4", "5", "7", "8", "9"]);
    expect(visibleSidebarThreads(rows, "8", "", [], true)).toEqual(rows);
  });
  it("searches folder names and historical thread titles without the recent-row limit", () => {
    expect(visibleSidebarThreads(tasks, "0", " RESEARCH ", [{ id: "research", name: "Research" }]).map((task) => task.threadId)).toEqual(["8", "9"]);
    expect(visibleSidebarThreads(tasks, "0", "thread 9").map((task) => task.threadId)).toEqual(["9"]);
    expect(visibleSidebarThreads(tasks, "0", "missing")).toEqual([]);
  });
});
