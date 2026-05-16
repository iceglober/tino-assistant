#!/usr/bin/env node
/**
 * @tino/cli — Tino assistant CLI
 *
 * Commands:
 *   tino init     Bootstrap a new tino deployment
 *   tino deploy   Build, push, and deploy to ECS
 */

import { binary, run, subcommands } from "cmd-ts";
import { deploy } from "./commands/deploy.js";
import { init } from "./commands/init.js";

const app = subcommands({
  name: "tino",
  cmds: {
    init,
    deploy,
  },
});

run(binary(app), process.argv);
