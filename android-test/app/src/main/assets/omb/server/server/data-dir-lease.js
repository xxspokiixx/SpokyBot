// Plain ESM so Electron's main process and the server enforce exactly the same lease protocol.
export { acquireDataDirLease, acquireDataDirLeaseForProcess, clearRecordsFromOtherMachines, DataDirLeaseError, describeDataDirLease, } from "../electron/data-dir-lease.mjs";
