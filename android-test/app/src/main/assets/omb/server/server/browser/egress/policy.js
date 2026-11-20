// What a bot's browser may connect to: every address a destination resolves to gets a class, and the host
// SpokyBot runs on decides which classes pass.
import { BlockList, isIP } from "node:net";
import { z } from "zod";
import { addressClass, listed, ownAddresses } from "../../../electron/egress-addresses.mjs";
export { addressClass, ownAddresses };
/** How a refusal reads in the page-health line. */
export const REFUSAL_TEXT = {
    omb: "SpokyBot's own service",
    "this-computer": "a service on this computer that no bot started",
    "local-network": "the local network",
    "link-local": "a link-local address",
    metadata: "the cloud metadata service",
    reserved: "a reserved address",
    rebinding: "a web address that points at this computer",
    reddit: "Reddit",
    "home-network": "the person's own computer or home network",
    port: "a port other than 80 and 443, which the person's computer does not open for bots",
};
const family = (address) => (isIP(address) === 6 ? "ipv6" : "ipv4");
/** Clash, Surge and other proxies in TUN + fake-IP mode answer every name from 198.18.0.0/15 and route it themselves. */
const FAKE_IP = new BlockList();
FAKE_IP.addSubnet("198.18.0.0", 15, "ipv4");
/** An address literal, or a name RFC 6761 and Chrome resolve to loopback themselves. */
export function namesThisMachine(host) {
    return isIP(host) !== 0 || /^(?:[^.]+\.)*localhost\.?$/i.test(host);
}
/** `browserEngine.egress` in config.json. */
export const browserEgressConfigSchema = z.object({
    /** Self-hosted servers only: local-network or this-computer destinations bots' browsers may reach, as
     * `10.0.0.5`, `192.168.1.0/24`, `10.0.0.5:8080`, `fd12::/48` or `[fd12::1]:443`. SpokyBot's own ports,
     * cloud metadata and link-local addresses stay closed. SpokyBot Cloud ignores it. */
    allow: z.array(z.string().trim().max(64).refine((entry) => parseAllowEntry(entry) !== null, {
        message: "must be an IP address or CIDR range, with an optional :port",
    })).max(64).optional(),
    /** Desktop only: false keeps bots' browsers off the local network (the default lets them reach it). */
    localNetwork: z.boolean().optional(),
});
export function parseAllowEntry(entry) {
    // A bare IPv6 address has colons of its own, so only its bracketed form takes a port.
    const match = /^\[([^\]]+)\](?:\/(\d{1,3}))?(?::(\d{1,5}))?$/.exec(entry)
        ?? (entry.split(":").length > 2 ? /^([^/]+)(?:\/(\d{1,3}))?()$/.exec(entry) : /^([^/:]+)(?:\/(\d{1,3}))?(?::(\d{1,5}))?$/.exec(entry));
    if (!match)
        return null;
    const [, network = "", prefixText, portText] = match;
    const kind = isIP(network);
    if (!kind)
        return null;
    const max = kind === 6 ? 128 : 32;
    const prefix = prefixText === undefined ? max : Number(prefixText);
    const port = portText ? Number(portText) : null;
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > max)
        return null;
    if (port !== null && (!Number.isInteger(port) || port < 1 || port > 65_535))
        return null;
    return { network, prefix, port };
}
export function allowList(entries) {
    const rules = (entries ?? []).flatMap((entry) => {
        const parsed = parseAllowEntry(entry);
        if (!parsed)
            return [];
        const list = new BlockList();
        list.addSubnet(parsed.network, parsed.prefix, family(parsed.network));
        return [{ list, port: parsed.port }];
    });
    return (raw, port) => {
        const address = raw.split("%", 1)[0];
        return rules.some((rule) => (rule.port === null || rule.port === port) && rule.list.check(address, family(address)));
    };
}
/**
 * Why a connection to `host:port`, resolved to `addresses`, is refused, or null when it may go ahead.
 * Every address must pass: the gate connects only to addresses checked here.
 */
export async function refusalFor(target, addresses, rules, own = ownAddresses()) {
    const { host, port } = target;
    for (const { address } of addresses) {
        let kind = addressClass(address, own);
        // On the desktop these come from the person's own proxy: the local network, unless this computer holds the address.
        if (kind === "reserved" && rules.host === "desktop" && listed(FAKE_IP, address)) {
            // The proxy picks the real destination, which may be this computer: never let it reach SpokyBot's own ports.
            if (rules.ownPort(port))
                return "omb";
            kind = listed(own, address) ? "this-machine" : "private";
        }
        if (kind === "public")
            continue;
        if (kind === "metadata" || kind === "link-local" || kind === "reserved")
            return kind;
        if (kind === "private") {
            const open = rules.host === "desktop" ? rules.localNetwork : rules.host === "server" && rules.allowed(address, port);
            if (open)
                continue;
            return "local-network";
        }
        if (rules.ownPort(port))
            return "omb";
        // Desktop dev servers are reached by name or address, never through a public name that points here.
        if (rules.host === "desktop") {
            if (namesThisMachine(host))
                continue;
            return "rebinding";
        }
        if (rules.host === "server" && rules.allowed(address, port))
            continue;
        if (await rules.botPort(port))
            continue;
        return "this-computer";
    }
    return null;
}
