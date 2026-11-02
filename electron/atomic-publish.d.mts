/**
 * Publishes the candidate file at `targetPath` without replacing an existing
 * file, by hard link, or on android (where the app sandbox denies hard link
 * creation in its own data directory) by an exists check plus rename.
 * Returns true when this caller published; false when the target already exists.
 */
export declare function publishCandidate(candidatePath: string, targetPath: string): boolean;
