// GET /api/updates/check: whether a newer release exists, and how this install is updated. Read-only, so client sessions may ask.
import { serverVersion } from "../environment.js";
import { SERVER_ROOT } from "../proxy-paths.js";
import { createUpdateChecker, installKind } from "../update-check.js";
import { PASS } from "./table.js";
export function createUpdateCheckRoutes(deps) {
    return async ({ res, path, method, json }) => {
        if (path !== "/api/updates/check" || method !== "GET")
            return PASS;
        try {
            return json(res, 200, await deps.check());
        }
        catch (error) {
            return json(res, 502, { error: `Could not check for updates: ${error instanceof Error ? error.message : String(error)}` });
        }
    };
}
export function serverUpdateChecker(where) {
    return createUpdateChecker({ current: serverVersion(), install: installKind({ ...where, serverRoot: SERVER_ROOT }) });
}
