#!/usr/bin/env node

// Deprecated: prefer `local-board install` (see src/install.js). This file is
// retained as a thin back-compat shim for existing docs/scripts that invoke
// `node install.mjs` directly; it forwards to the same installer module.

import { runInstall } from "./src/install.js";

process.exitCode = runInstall(process.argv.slice(2), {});
