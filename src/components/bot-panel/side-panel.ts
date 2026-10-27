import { cn } from "@/lib/cn";

/** A chat's side panel. Simple mode's is 320 wide on the chat's own ground; Advanced keeps its wider sidebar tone. */
export const sidePanelCls = (overlay: boolean, simple = false) => cn(
  "animate-sheet-in md:animate-panel-in absolute inset-0 z-40 flex h-full min-w-0 flex-col border-l border-hairline/40 outline-none focus-visible:outline-none",
  simple ? "bg-app" : "bg-panel",
  overlay
    ? cn("md:inset-auto md:right-0 md:top-0 md:bottom-0 md:shadow-2xl", simple ? "md:w-[320px]" : "md:w-[min(420px,42vw)]")
    : cn("md:static md:z-auto md:shrink-0", simple ? "md:w-[320px]" : "md:w-[min(420px,42vw)]"),
);
