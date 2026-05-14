#!/usr/bin/env node
/**
 * @tino/cli — Tino assistant CLI
 *
 * Commands:
 *   tino init     Bootstrap a new tino deployment
 *   tino deploy   Build, push, and deploy to ECS
 *   tino console  Open the ECS exec console
 */

const [, , command, ...args] = process.argv;

switch (command) {
  case 'init': {
    const { init } = await import('./commands/init.js');
    await init(args);
    break;
  }
  case 'deploy': {
    const { deploy } = await import('./commands/deploy.js');
    await deploy(args);
    break;
  }
  case 'console': {
    const { openConsole } = await import('./commands/console.js');
    await openConsole(args);
    break;
  }
  default: {
    console.log('Usage: tino <command>');
    console.log('');
    console.log('Commands:');
    console.log('  init      Bootstrap a new tino deployment');
    console.log('  deploy    Build, push, and deploy to ECS');
    console.log('  console   Open the ECS exec console');
    process.exit(command ? 1 : 0);
  }
}
