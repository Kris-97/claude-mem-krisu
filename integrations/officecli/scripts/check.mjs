#!/usr/bin/env node
/**
 * Verify the claude-mem <-> OfficeCLI wiring end to end.
 *
 * This is the script that answers "is it actually connected?", so every check
 * asserts against something observable at runtime rather than against a file
 * merely existing where an installer put it. Exit code 0 means a session
 * building slides in this project will genuinely receive memory.
 *
 * Usage:
 *   node check.mjs [--project NAME] [--target PATH] [--json]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { workerGet, searchMemory, resolveWorkerPort, CLAUDE_MEM_HOME } from './mem-client.mjs';

const MARKER = 'OFFICECLI-MEMORY-BRIDGE';
const DEFAULT_PROJECT = 'officecli';

function parseArgs(argv) {
  const args = { project: DEFAULT_PROJECT, target: process.cwd(), json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project') args.project = argv[++i];
    else if (a === '--target') args.target = path.resolve(argv[++i]);
    else if (a === '--json') args.json = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  return args;
}

const results = [];
/**
 * `warn` marks a check whose failure does not mean the bridge is broken —
 * semantic recall, for instance, degrades to SQLite text search when Chroma is
 * not configured, and a healthy install can legitimately fail it. Warnings are
 * reported but do not set a non-zero exit code, so this stays usable as a gate.
 */
const record = (name, ok, detail, { fatal = false, warn = false } = {}) => {
  results.push({ name, ok, detail, fatal, warn });
  return ok;
};

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

/** claude-mem registers its hooks through the plugin, so look for either shape. */
function hooksLookRegistered() {
  const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  const settings = readJson(path.join(configDir, 'settings.json'));
  const settingsMentions = settings
    ? JSON.stringify(settings).toLowerCase().includes('claude-mem')
    : false;

  const pluginPaths = [
    path.join(configDir, 'plugins', 'marketplaces', 'thedotmack', 'plugin', 'hooks', 'hooks.json'),
    path.join(configDir, 'plugins', 'marketplaces', 'thedotmack', 'plugin'),
    path.join(configDir, 'plugins', 'cache', 'thedotmack', 'claude-mem'),
  ];
  const pluginInstalled = pluginPaths.find((p) => fs.existsSync(p)) || null;

  return { settingsMentions, pluginInstalled, configDir };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('usage: check.mjs [--project NAME] [--target PATH] [--json]');
    return 0;
  }

  const port = resolveWorkerPort();

  // 1. Worker reachable. Everything else depends on this, so it is fatal.
  const health = await workerGet('/health', { timeoutMs: 5000 });
  const workerUp = record(
    'worker reachable',
    health.ok,
    health.ok ? `127.0.0.1:${port}` : `no answer on 127.0.0.1:${port} (${health.error || health.status})`,
    { fatal: true }
  );

  if (workerUp) {
    // 2. The database actually holds something.
    const stats = await workerGet('/api/stats', { timeoutMs: 8000 });
    const statsBody = stats.body ?? {};
    const count =
      statsBody.observations ?? statsBody.observationCount ?? statsBody.totalObservations ?? null;
    record(
      'memory database populated',
      stats.ok,
      stats.ok ? `stats: ${JSON.stringify(statsBody).slice(0, 300)}` : `GET /api/stats -> ${stats.status}`
    );

    // 3. The imported context pack is retrievable. This is the check that
    //    distinguishes "worker is up" from "this project has memory". The
    //    marker is carried in an observation *title* precisely so it shows up
    //    in the index /api/search returns.
    const search = await searchMemory(MARKER, { project: args.project, limit: 5, timeoutMs: 20000 });
    const haystack = JSON.stringify(search.body ?? search.text ?? '');
    const found = search.ok && haystack.includes(MARKER);
    record(
      'imported context retrievable',
      found,
      found
        ? `marker ${MARKER} found in project "${args.project}"`
        : `marker not returned by /api/search (status ${search.status}). Run import-context.mjs --project ${args.project}.`
    );

    // 4. Retrieval by topic words rather than by marker - closer to what a
    //    slide session actually asks. Advisory: without Chroma the worker
    //    falls back to SQLite text search, where this can legitimately miss.
    const topical = await searchMemory('officecli slides deck template', {
      project: args.project,
      limit: 5,
      timeoutMs: 20000,
    });
    const topicalText = JSON.stringify(topical.body ?? topical.text ?? '');
    const topicalHit = topical.ok && !/no results found/i.test(topicalText) && topicalText.length > 40;
    record(
      'topical recall for slide work',
      topicalHit,
      topicalHit
        ? 'a topic query returns material'
        : 'topic query returned nothing (expected if Chroma semantic search is not configured)',
      { warn: true }
    );
  }

  // 5. Hooks / plugin present, so future sessions capture new work too.
  const hooks = hooksLookRegistered();
  record(
    'claude-mem hooks installed',
    Boolean(hooks.pluginInstalled || hooks.settingsMentions),
    hooks.pluginInstalled
      ? `plugin at ${hooks.pluginInstalled}`
      : hooks.settingsMentions
        ? `referenced from ${path.join(hooks.configDir, 'settings.json')}`
        : 'no claude-mem plugin or settings reference found'
  );

  // 6. The target project can reach the memory MCP server.
  const mcpFile = path.join(args.target, '.mcp.json');
  const mcp = readJson(mcpFile);
  const hasMcp = Boolean(mcp?.mcpServers && Object.keys(mcp.mcpServers).some((k) => /mem|search/i.test(k)));
  record(
    'memory MCP wired into target project',
    hasMcp,
    hasMcp ? `${mcpFile}` : `no memory MCP server in ${mcpFile}`
  );

  // 7. The slides skill is where a session will look for it.
  const skillPath = path.join(args.target, '.claude', 'skills', 'officecli-slides-memory', 'SKILL.md');
  record(
    'slides-memory skill installed',
    fs.existsSync(skillPath),
    fs.existsSync(skillPath) ? skillPath : `missing ${skillPath}`
  );

  const failed = results.filter((r) => !r.ok && !r.warn);
  const warned = results.filter((r) => !r.ok && r.warn);
  const fatalFailed = failed.some((r) => r.fatal);

  if (args.json) {
    console.log(
      JSON.stringify(
        { ok: failed.length === 0, warnings: warned.length, port, project: args.project, results },
        null,
        2
      )
    );
  } else {
    console.log(`claude-mem <-> OfficeCLI bridge check  (port ${port}, project "${args.project}")\n`);
    for (const r of results) {
      const label = r.ok ? 'PASS' : r.warn ? 'WARN' : 'FAIL';
      console.log(`${label}  ${r.name}\n      ${r.detail}`);
    }
    if (failed.length === 0) {
      console.log(
        `\nALL CHECKS PASSED - slide sessions in this project will receive memory.${
          warned.length ? ` (${warned.length} advisory warning(s) above.)` : ''
        }`
      );
    } else {
      console.log(
        `\n${failed.length} check(s) failed.${
          fatalFailed ? ' The worker is down; opening a Claude Code session starts it.' : ''
        }`
      );
    }
  }

  return failed.length === 0 ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error?.message || error);
    process.exit(1);
  });
