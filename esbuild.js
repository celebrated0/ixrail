// Bundles the extension host, MCP stdio server, HTTP bridge, and mock merchant
// into out/. Referenced by the "build"/"watch" npm scripts in package.json.
//
// This file is a standard esbuild entry-point config. It does not contain
// AgentPay's wallet, policy, or settlement logic — see src/ for that.
const esbuild = require('esbuild');

const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions[]} */
const builds = [
  {
    entryPoints: ['src/extension.ts'],
    outfile: 'out/extension.js',
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    sourcemap: true,
    external: ['vscode'],
    logLevel: 'info'
  },
  {
    entryPoints: ['src/mcp/server.ts'],
    outfile: 'out/mcp/server.js',
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    sourcemap: true,
    logLevel: 'info'
  },
  {
    entryPoints: ['src/mcp/httpBridge.ts'],
    outfile: 'out/mcp/httpBridge.js',
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    sourcemap: true,
    logLevel: 'info'
  },
  {
    entryPoints: ['src/mock-merchant/server.ts'],
    outfile: 'out/mock-merchant/server.js',
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    sourcemap: true,
    logLevel: 'info'
  }
];

async function run() {
  if (watch) {
    const contexts = await Promise.all(builds.map((opts) => esbuild.context(opts)));
    await Promise.all(contexts.map((ctx) => ctx.watch()));
    console.log('esbuild watching for changes...');
  } else {
    await Promise.all(builds.map((opts) => esbuild.build(opts)));
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
