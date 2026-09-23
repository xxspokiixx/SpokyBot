// Decides what first run looks like for whoever opened the app. The desktop
// app's own window is the owner of its own server and gets the welcome flow
// exactly as before, without waiting on anything new. A browser asks its
// server who it is first: a hosted workspace's admin gets the hosted beats,
// and anyone who cannot save the workspace config (a member) gets a quiet
// note instead of a tour they could never finish.
import { useEffect, useState } from "react";
import { emailGateDone } from "@/lib/analytics";
import { LOCAL_VIEWER, welcomeDue, welcomeViewer, type BeatId, type WelcomeViewer } from "@/lib/onboarding";
import { api, useStore } from "@/state/store";
import { SharedWorkspaceHint } from "./SharedWorkspaceHint";
import { WelcomeFlow } from "./WelcomeFlow";

/** Null while a browser's answer is on its way. A desktop window knows at
 * once: its own server's owner, or a remote client, which never gets a
 * first-run surface anyway. A failed answer keeps the old behaviour. */
export function useWelcomeViewer(): WelcomeViewer | null {
  const desktop = Boolean(window.ogb);
  const [viewer, setViewer] = useState<WelcomeViewer | null>(desktop ? LOCAL_VIEWER : null);
  useEffect(() => {
    if (desktop) return;
    let active = true;
    void api("/api/auth/session", { timeoutMs: 10_000 })
      .then((session) => {
        if (active) setViewer(welcomeViewer(session));
      })
      .catch(() => {
        if (active) setViewer(LOCAL_VIEWER);
      });
    return () => {
      active = false;
    };
  }, [desktop]);
  return viewer;
}

/** Opens the welcome flow on a fresh workspace (the server's onboarding
 * record says so) or on request from Settings. The decision waits for the
 * config to arrive, so a returning user never sees the tour flash. */
export function WelcomeGate({ viewer }: { viewer: WelcomeViewer | null }) {
  const { state, dispatch } = useStore();
  const [dismissed, setDismissed] = useState(false);
  // Set when the engines beat's organisation row opened Settings, so closing
  // Settings brings the person back to that beat rather than the greeting.
  const [resumeAt, setResumeAt] = useState<BeatId | undefined>(undefined);
  const remoteClient = window.ogb?.remoteClient?.active === true;
  if (!viewer) return null;
  if (!viewer.canSave) {
    return remoteClient ? null : (
      <SharedWorkspaceHint
        replay={state.welcomeOpen}
        onClose={() => {
          if (state.welcomeOpen) dispatch({ type: "toggleWelcome", open: false });
        }}
      />
    );
  }
  const due =
    !dismissed &&
    welcomeDue(state.config, {
      remoteClient,
      legacyDone: emailGateDone(),
      hosted: viewer.hosted,
      canSave: viewer.canSave,
    });
  // Explicit desktop connection Settings need no local provider onboarding.
  // Organisation remains optional; closing Settings resumes the normal tour.
  if (state.appSettingsOpen && ["desktopWorkspaces", "organization"].includes(state.appSettingsSection)) return null;
  if (!state.welcomeOpen && !due) return null;
  const bot = state.bots.find((b) => !b.hidden) ?? null;
  const replay = state.welcomeOpen && !due;
  return (
    <WelcomeFlow
      bot={bot}
      replay={replay}
      hosted={viewer.hosted}
      initialBeat={resumeAt}
      onOpenOrganisation={() => {
        setResumeAt("engines");
        dispatch({ type: "toggleAppSettings", open: true, section: "organization" });
      }}
      onDone={() => {
        setDismissed(true);
        dispatch({ type: "toggleWelcome", open: false });
        // the first real finish hands over to the guided tour; a replay does not
        if (!replay) dispatch({ type: "toggleTour", open: true });
      }}
    />
  );
}
