import { main } from "./cli.js";
import { exitAfterFlush } from "./exit.js";
main().then(exitAfterFlush, (error) => {
    console.error(error instanceof Error ? error.message : String(error));
    exitAfterFlush(1);
});
