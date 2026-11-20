// Plain ESM so Electron's main process and the server enforce exactly the same lease protocol.
export {
  acquireDataDirLease,
  acquireDataDirLeaseForProcess,
  clearRecordsFromOtherMachines,
  DataDirLeaseError,
  describeDataDirLease,
} from "../electron/data-dir-lease.mjs";

/** What `describeDataDirLease` finds without refusing to start: who holds the folder, or why it cannot tell. */
export type DataDirLeaseHolder =
  | { state: "none"; path: string }
  | { state: "invalid"; path: string }
  | { state: "alive" | "dead" | "other-machine"; path: string; pid: number; host: string; createdAt: string };

export type {
  DataDirLease,
  DelegatedDataDirLease,
  OwnedDataDirLease,
} from "../electron/data-dir-lease.mjs";
