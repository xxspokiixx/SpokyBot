import { main } from "./cli.js";
import { exitAfterFlush } from "./exit.js";
// The sentinel, run from here, reads the server's own lines back in every language it writes them in.
import "./server-line-packs.js";
main().then(exitAfterFlush, (error) => {
    console.error(error instanceof Error ? error.message : String(error));
    exitAfterFlush(1);
});
