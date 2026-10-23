import { updateErrorMessage, updateErrorNeedsPerson } from "./update-errors.mjs";

/** electron-updater's GitHub provider gives the release body (HTML); a multi-release feed gives [{ version, note }]. */
export function releaseNotesText(notes) {
  const text = typeof notes === "string"
    ? notes
    : Array.isArray(notes)
      ? notes.map((entry) => (typeof entry?.note === "string" ? entry.note : "")).filter(Boolean).join("\n")
      : "";
  const trimmed = text.trim();
  return trimmed ? trimmed.slice(0, 8000) : undefined;
}

// `elevatedInstall` (Ubuntu .deb, electron/elevated-install.mjs) resolves { ok } or { ok: false, reason, detail }; `relaunch` reopens the app after it.
// Anything but a closed prompt or a checksum failure falls back to `handOffInstall`.
export function createUpdaterCoordinator(
  updater,
  setState,
  { handOffInstall = null, elevatedInstall = null, relaunch = null, nativeStaging = false } = {},
) {
  let checkOperation = null;
  let downloadedFiles = null;
  let downloadOperation = null;
  let installOperation = null;
  let nativeStagingStarted = false;
  let nativeReady = false;
  // Squirrel has no cancellation or attempt ID: a retry could consume a failed attempt's late ready event.
  let recoveryRequired = false;
  // A staged update, hand-off or failed action stays until the person acts; hourly checks must not replace it.
  let actionOwnsState = false;
  const routedErrors = new WeakSet();

  const routeError = (manual, error) => {
    if (recoveryRequired) return;
    const shown = manual || updateErrorNeedsPerson(error);
    actionOwnsState = shown;
    if (error instanceof Error) routedErrors.add(error);
    if (downloadOperation) {
      downloadOperation.failed = true;
      clearTimeout(downloadOperation.timer);
    }
    if (checkOperation) checkOperation.failed = true;
    if (installOperation) {
      installOperation.failed = true;
      clearTimeout(installOperation.timer);
      installOperation = null;
    }
    if (nativeStagingStarted) {
      recoveryRequired = true;
      nativeReady = false;
      setState({
        status: "error",
        retryable: false,
        message: `${updateErrorMessage(error)} Quit and reopen OpenMausBot before trying the update again.`,
      });
      return;
    }
    if (!shown) {
      setState({ status: "idle" });
      return;
    }
    setState({ status: "error", message: updateErrorMessage(error) });
  };

  function handleRejectedOperation(manual, error) {
    if (error instanceof Error && routedErrors.has(error)) return;
    routeError(manual, error);
  }

  function checkOwnsState() {
    return !recoveryRequired && !actionOwnsState && !installOperation && !downloadOperation && !checkOperation?.supersededByDownload;
  }

  updater.on("checking-for-update", () => {
    if (checkOwnsState()) setState({ status: "checking" });
  });
  updater.on("update-available", (info) => {
    if (checkOwnsState()) {
      download(Boolean(checkOperation?.manual), {
        version: info?.version,
        releaseNotes: releaseNotesText(info?.releaseNotes),
        percent: undefined,
        message: undefined,
      });
    }
  });
  updater.on("update-not-available", () => {
    if (checkOwnsState()) setState({ status: "idle" });
  });
  // macOS native staging (quitAndInstall) reports failure only through this event; quitAndInstall returns void.
  updater.on("error", (error) => {
    // Shared error events do not identify their operation.
    if (checkOperation?.supersededByDownload && !installOperation) return;
    const manual = Boolean(installOperation || downloadOperation?.manual || checkOperation?.manual || nativeStagingStarted);
    routeError(manual, error);
  });
  updater.on("download-progress", (progress) => {
    if (recoveryRequired || installOperation || nativeStagingStarted) return;
    setState({ status: "downloading", percent: Math.round(progress?.percent ?? 0) });
  });
  updater.on("update-downloaded", (info) => {
    if (recoveryRequired || installOperation) return;
      // On macOS electron-updater emits this before Squirrel.Mac finishes staging; the vendor patch resolves downloadUpdate on the native ready event.
    if (downloadOperation) {
      downloadOperation.downloadedInfo = info;
      if (nativeStaging && !nativeStagingStarted) {
        nativeStagingStarted = true;
        setState({ status: "preparing", version: info?.version, message: undefined });
        downloadOperation.timer = setTimeout(() => {
          updater.logger?.warn?.("Native update preparation exceeded the five-minute deadline; restart is required before retrying.");
          routeError(true, new Error("Preparing the update took too long."));
        }, 5 * 60 * 1000);
        downloadOperation.timer.unref?.();
      }
      return;
    }
    if (nativeStaging) return;
    actionOwnsState = true;
    setState({ status: "downloaded", version: info?.version });
  });

  function check(manual = false) {
    if (manual && downloadOperation) downloadOperation.manual = true;
    if (recoveryRequired || installOperation || (nativeStaging && (downloadOperation || nativeStagingStarted)) || (!manual && actionOwnsState)) return Promise.resolve();
    if (checkOperation) {
      if (manual) checkOperation.manual = true;
      return checkOperation.promise;
    }

    if (manual) actionOwnsState = false;
    const operation = { manual, supersededByDownload: Boolean(downloadOperation), failed: false, promise: null };
    checkOperation = operation;
    try {
      operation.promise = Promise.resolve(updater.checkForUpdates())
        .catch((error) => {
          if (!operation.supersededByDownload) handleRejectedOperation(operation.manual, error);
        })
        .finally(() => {
          if (checkOperation === operation) checkOperation = null;
        });
    } catch (error) {
      if (!operation.supersededByDownload) handleRejectedOperation(operation.manual, error);
      checkOperation = null;
      operation.promise = Promise.resolve();
    }
    return operation.promise;
  }

  function download(manual, starting) {
    if (recoveryRequired || installOperation || nativeStagingStarted) return;
    if (checkOperation) checkOperation.supersededByDownload = true;

    const operation = { downloadedInfo: null, failed: false, manual, timer: null };
    downloadOperation = operation;
      // Own the state before the request: the first progress event can be seconds away, and no percent reads as "starting".
    setState({ status: "downloading", ...starting });
    try {
      void Promise.resolve(updater.downloadUpdate())
        .then((result) => {
          if (!operation.failed) {
            downloadedFiles = Array.isArray(result) ? result.filter((file) => typeof file === "string") : null;
          }
          if (!operation.failed && operation.downloadedInfo) {
            nativeReady = nativeStaging;
            actionOwnsState = true;
            setState({ status: "downloaded", version: operation.downloadedInfo?.version });
          }
        })
        .catch((error) => handleRejectedOperation(operation.manual, error))
        .finally(() => {
          clearTimeout(operation.timer);
          if (downloadOperation === operation) downloadOperation = null;
        });
    } catch (error) {
      handleRejectedOperation(operation.manual, error);
      downloadOperation = null;
    }
  }

  function install() {
    if (recoveryRequired || installOperation || downloadOperation || (nativeStaging && !nativeReady)) return;
    actionOwnsState = true;
    if (elevatedInstall) {
      elevate();
      return;
    }
    if (handOffInstall) {
      handOff();
      return;
    }
    const operation = { failed: false, timer: null };
    installOperation = operation;
    setState({ status: "installing" });
    try {
      updater.quitAndInstall(true, true);
    } catch (error) {
      routeError(true, error);
      return;
    }
    watchSlowRestart(operation);
  }

  // quitAndInstall is void and cannot be canceled: a Retry here would arm another native quit callback.
  function watchSlowRestart(operation) {
    if (installOperation !== operation) return;
    operation.timer = setTimeout(() => {
      if (installOperation !== operation) return;
      updater.logger?.warn?.("Update restart handoff exceeded two minutes; keeping installation locked to prevent overlapping retries.");
      setState({ status: "installing", message: "Restart is taking longer than expected. Quit and reopen OpenMausBot to finish the update." });
    }, 2 * 60 * 1000);
    operation.timer.unref?.();
  }

  function elevate() {
    const operation = { failed: false, timer: null };
    installOperation = operation;
    setState({ status: "installing", message: "Installing the update. Enter your password if asked." });
    Promise.resolve()
      .then(() => elevatedInstall(downloadedFiles, { sha512: updater.downloadedUpdateHelper?.downloadedFileInfo?.sha512 }))
      .then((result) => {
        if (installOperation !== operation) return;
        if (result?.ok) {
          setState({ status: "installing", message: undefined });
          try {
            relaunch?.();
          } catch (error) {
            routeError(true, error);
            return;
          }
          watchSlowRestart(operation);
          return;
        }
        installOperation = null;
        updater.logger?.warn?.(`Elevated install did not finish (${result?.reason}): ${result?.detail}`);
        if (result?.reason === "declined") {
          setState({ status: "downloaded", message: undefined });
          return;
        }
        if (result?.reason === "checksum" || !handOffInstall) {
          routeError(true, new Error(result?.detail || "The update could not be installed."));
          return;
        }
        handOff(result?.detail);
      })
      .catch((error) => {
        if (installOperation !== operation) return;
        routeError(true, error);
      });
  }

  // `note` says why the automatic install did not run, when that is why.
  function handOff(note) {
    const operation = { failed: false, timer: null };
    installOperation = operation;
    setState({ status: "installing", message: undefined });
    Promise.resolve()
      .then(() => handOffInstall(downloadedFiles))
      .then((patch) => {
        if (installOperation !== operation) return;
        installOperation = null;
        setState({ status: "handed-off", message: note, ...patch });
      })
      .catch((error) => {
        if (installOperation !== operation) return;
        routeError(true, error);
      });
  }

  return { check, install };
}
