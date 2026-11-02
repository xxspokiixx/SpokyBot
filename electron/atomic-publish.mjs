import { existsSync, linkSync, renameSync } from "node:fs";

// Android app sandboxes deny hardlink creation inside the app's own data
// directory (observed: Samsung SM-P610 and ZTE NX733J on Android 16 return
// EACCES from link(2)), so there the atomic link() publish degrades to an
// exists check plus rename. Callers re-read the target to decide conflicts
// exactly as they do after EEXIST, and the fallback only ever runs on android.
export function publishCandidate(candidatePath, targetPath) {
  try {
    linkSync(candidatePath, targetPath);
    return true;
  } catch (error) {
    if (error?.code === "EEXIST") return false;
    if (process.platform !== "android" || !["EACCES", "EPERM", "ENOSYS", "EOPNOTSUPP"].includes(error?.code)) {
      throw error;
    }
    if (existsSync(targetPath)) return false;
    try {
      renameSync(candidatePath, targetPath);
      return true;
    } catch (renameError) {
      if (renameError?.code === "EEXIST" || renameError?.code === "ENOTEMPTY") return false;
      throw renameError;
    }
  }
}
