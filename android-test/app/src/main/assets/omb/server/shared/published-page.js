/** The SpokyBot pages Worker's page ids: one DNS label of lowercase letters and digits. */
export const PAGE_ID = /^[a-z0-9]{20,63}$/;
/** What a page's files may be, as the pages Worker serves them (openmaus-cloud pages-worker/src/files.ts refuses the rest). */
export const PAGE_FILE_EXTENSIONS = new Set([
    "html", "htm", "css", "js", "mjs", "json", "txt", "csv", "md", "parquet", "arrow",
    "svg", "png", "jpg", "jpeg", "gif", "webp", "avif", "ico", "woff", "woff2", "ttf", "otf",
]);
export const PAGE_MAX_BYTES = 5 * 1024 * 1024;
export const PAGE_MAX_FILES = 200;
