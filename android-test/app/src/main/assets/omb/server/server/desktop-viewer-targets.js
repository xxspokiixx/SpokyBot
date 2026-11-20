import { viewerTargetId } from "../shared/desktop-viewer.js";
import { androidProotStatus } from "./container-computer.js";
import { desktopViewerUrl } from "./routes/desktop-viewer.js";
import { SHARED_LOCAL_VM_TARGET } from "./container-computer.js";
/** Native owner windows keep the existing direct viewer and cookie isolation. */
export function localVmViewerStatus(status, auth) {
    return auth.kind === "loopback" ? status : {
        ...status,
        viewer_url: status.viewer_url ? desktopViewerUrl(viewerTargetId({ key: status.target_key })) : "",
    };
}
export function localDesktopTarget(target, deps) {
    return {
        key: target.key,
        async resolve() {
            // The phone's "this computer" is the proot'ed Linux rootfs, not a container runtime: its desktop is
            // the one the shared target names, and no other Local VM target exists there.
            const status = process.platform === "android" && target.key === SHARED_LOCAL_VM_TARGET.key
                ? await androidProotStatus()
                : await deps.status(target);
            if (!status.managed || !status.imageMatches || status.network !== "loopback" || status.container !== "running"
                || !status.viewer_url) {
                throw Object.assign(new Error("Local VM unavailable"), { status: 409 });
            }
            return {
                port: status.viewer_port ?? 0,
                // The RFB port, when the desktop serves one: the app then speaks RFB itself and the
                // WebSocket bridge in between (python under proot, which drops whole framebuffer
                // updates) is not in the path at all.
                rfbPort: status.rfb_port ?? null,
                password: new URLSearchParams(new URL(status.viewer_url).hash.slice(1)).get("password"),
                touch: () => deps.touch(target),
            };
        },
    };
}
