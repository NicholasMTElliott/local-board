import { rm } from "node:fs/promises";

// Recursive removal of a temp fixture directory can race a background
// writer (notably git's auto-gc/object-packing, which fixtures disable but
// cannot rule out entirely on every platform/filesystem): a directory can
// be re-populated between fs.rm's readdir and rmdir, throwing ENOTEMPTY (or
// EBUSY/EPERM) even though the test itself already passed. `maxRetries` /
// `retryDelay` tell Node's fs.rm to retry exactly that errno set with a
// linear backoff, absorbing the race instead of failing teardown.
export async function removeFixtureDir(dir) {
  await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
