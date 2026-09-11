#!/usr/bin/env node
/**
 * Wire the claude-mem <-> OfficeCLI bridge into a project.
 *
 * All the real work lives here rather than in install.sh / install.ps1, so the
 * Windows and POSIX paths cannot drift apart — those two are thin launchers.
 *
 * What it does, all idempotent:
 *   1. installs the officecli-slides-memory skill into <target>/.claude/skills,
 *      with the integration's absolute path substituted in
 *   2. merges claude-mem's mcp-search server into <target>/.mcp.json, keeping
 *      any servers already there
 *   3. imports the context pack into the local memory database
 *   4. runs the end-to-end check and reports
 *
 * Usage:
 *   node install.mjs [--target PATH] [--project NAME] [--no-import] [--no-check]
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INTEGRATION_ROOT = path.resolve(HERE, '..');
const REPO_ROOT = path.resolve(INTEGRATION_ROOT, '..', '..');
const SKILL_NAME = 'officecli-slides-memory';

function parseArgs(argv) {
  const args = {
    target: process.cwd(),
    project: 'officecli',
    doImport: true,
    doCheck: true,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--target') args.target = path.resolve(argv[++i]);
    else if (a === '--project') args.project = argv[++i];
    else if (a === '--no-import') args.doImport = false;
    else if (a === '--no-check') args.doCheck = false;
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  return args;
}

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
};

function installSkill(target) {
  const source = path.join(INTEGRATION_ROOT, 'skills', SKILL_NAME, 'SKILL.md');
  if (!fs.existsSync(source)) throw new Error(`skill source missing: ${source}`);

  const destDir = path.join(target, '.claude', 'skills', SKILL_NAME);
  fs.mkdirSync(destDir, { recursive: true });

  // Substitute the placeholder for this machine's real path. The committed
  // copy keeps the placeholder so the repo stays machine-independent; the
  // installed copy carries paths the agent can run without further lookup.
  const body = fs
    .readFileSync(source, 'utf-8')
    .split('<CLAUDE_MEM_OFFICECLI>')
    .join(INTEGRATION_ROOT);

  const dest = path.join(destDir, 'SKILL.md');
  fs.writeFileSync(dest, body);
  return dest;
}

function mergeMcp(target) {
  const pluginMcpPath = path.join(REPO_ROOT, 'plugin', '.mcp.json');
  const pluginMcp = readJson(pluginMcpPath);
  if (!pluginMcp?.mcpServers) {
    return { ok: false, detail: `could not read ${pluginMcpPath}` };
  }

  const destPath = path.join(target, '.mcp.json');
  const existing = readJson(destPath) || {};
  const before = JSON.stringify(existing);

  existing.mcpServers = { ...(existing.mcpServers || {}) };
  for (const [name, config] of Object.entries(pluginMcp.mcpServers)) {
    // Reuse claude-mem's own server definition verbatim: it carries the plugin
    // root resolver, and a hand-written copy would rot the moment that moves.
    existing.mcpServers[name] = config;
  }

  const after = JSON.stringify(existing, null, 2);
  if (before === JSON.stringify(existing)) {
    return { ok: true, detail: `${destPath} already current`, path: destPath };
  }
  fs.writeFileSync(destPath, after + '\n');
  return {
    ok: true,
    detail: `${destPath} (servers: ${Object.keys(existing.mcpServers).join(', ')})`,
    path: destPath,
  };
}

function run(scriptName, extraArgs) {
  const script = path.join(HERE, scriptName);
  const res = spawnSync(process.execPath, [script, ...extraArgs], {
    stdio: 'inherit',
    env: process.env,
  });
  return res.status ?? 1;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('usage: install.mjs [--target PATH] [--project NAME] [--no-import] [--no-check]');
    return 0;
  }

  if (!fs.existsSync(args.target)) {
    console.error(`target project not found: ${args.target}`);
    return 1;
  }

  console.log(`claude-mem <-> OfficeCLI bridge`);
  console.log(`  integration: ${INTEGRATION_ROOT}`);
  console.log(`  target:      ${args.target}`);
  console.log(`  project:     ${args.project}\n`);

  const skillPath = installSkill(args.target);
  console.log(`skill installed: ${skillPath}`);

  const mcp = mergeMcp(args.target);
  console.log(`${mcp.ok ? 'mcp wired' : 'mcp SKIPPED'}: ${mcp.detail}`);

  let importStatus = 0;
  if (args.doImport) {
    console.log('\nimporting context pack...');
    importStatus = run('import-context.mjs', ['--project', args.project]);
    if (importStatus !== 0) {
      console.error(
        '\nContext import did not complete. The most common cause is the worker being down;\n' +
          'open a Claude Code session to start it, then re-run:\n' +
          `  node ${path.join(HERE, 'import-context.mjs')} --project ${args.project}`
      );
    }
  }

  let checkStatus = 0;
  if (args.doCheck) {
    console.log('\nverifying...\n');
    checkStatus = run('check.mjs', ['--project', args.project, '--target', args.target]);
  }

  // The install itself succeeded if the files landed; import/check failures are
  // reported honestly through the exit code rather than being swallowed.
  return importStatus !== 0 || checkStatus !== 0 ? 1 : 0;
}

try {
  process.exit(main());
} catch (error) {
  console.error(error?.message || error);
  process.exit(1);
}
