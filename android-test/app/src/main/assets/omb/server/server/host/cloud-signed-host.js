import { createCloudHealth } from "../cloud-health.js";
import { createCloudSignedRoutes } from "../routes/cloud-signed.js";
export function createCloudSignedHost(deps) {
    const cloudHealth = deps.cloudHome ? createCloudHealth({ ...deps.health, box: deps.box }) : null;
    const cloudSigned = deps.cloudHome && cloudHealth
        ? createCloudSignedRoutes({ secret: deps.cloudHome.bootstrapSecret, sessions: deps.sessions, team: deps.cloudHome.team, health: cloudHealth, power: deps.power, box: deps.box,
            ...(deps.cloudHome.team && deps.teamAdmin ? { teamAdmin: deps.teamAdmin } : {}),
            ...(deps.cloudHome.team && deps.memberLeft ? { memberLeft: deps.memberLeft } : {}) })
        : null;
    return { cloudHealth, cloudSigned };
}
