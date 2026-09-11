/**
 * Minimal client for the local claude-mem worker.
 *
 * The worker's HTTP surface has no request authentication — its only defence
 * is the loopback bind (see src/services/worker/http/middleware.ts). So every
 * call here goes to 127.0.0.1 explicitly and never to a configurable host: if
 * an operator has opened CLAUDE_MEM_WORKER_HOST for Observation TV, the remote
 * guard denies mutations anyway, and pointing this client at that opened bind
 * would only produce confusing 403s.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const CLAUDE_MEM_HOME = process.env.CLAUDE_MEM_HOME || path.join(os.homedir(), '.claude-mem');

export function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(path.join(CLAUDE_MEM_HOME, 'settings.json'), 'utf-8'));
  } catch {
    return {};
  }
}

/**
 * Port resolution, in the same order claude-mem's own hooks and the
 * cloud-sync skill use it. The uid fallback matters on Windows, where
 * process.getuid is undefined: claude-mem substitutes 77, giving 37777.
 * Diverging from that here would silently talk to the wrong port.
 */
export function resolveWorkerPort() {
  const fromEnv = process.env.CLAUDE_MEM_WORKER_PORT;
  if (fromEnv) return Number(fromEnv);
  const fromSettings = readSettings().CLAUDE_MEM_WORKER_PORT;
  if (fromSettings) return Number(fromSettings);
  const uid = typeof process.getuid === 'function' ? process.getuid() : 77;
  return 37700 + (uid % 100);
}

export function workerBase(port = resolveWorkerPort()) {
  return `http://127.0.0.1:${port}`;
}

async function request(method, route, { body, timeoutMs = 15000, port } = {}) {
  const url = `${workerBase(port)}${route}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      signal: controller.signal,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { /* non-JSON body kept as text */ }
    return { ok: res.ok, status: res.status, body: parsed, text };
  } catch (error) {
    // A refused connection is the normal "worker not running" case and should
    // read as such rather than as an unexplained fetch failure.
    const cause = error?.cause?.code || error?.code || error?.name;
    return { ok: false, status: 0, body: null, text: '', error: String(cause || error) };
  } finally {
    clearTimeout(timer);
  }
}

export const workerGet = (route, opts) => request('GET', route, opts);
export const workerPost = (route, body, opts) => request('POST', route, { ...opts, body });

/** True once the worker answers its health route. */
export async function workerHealthy(opts) {
  const res = await workerGet('/health', { timeoutMs: 4000, ...opts });
  return res.ok;
}

/** Save one memory. Returns the worker's {success, id, title, project}. */
export function saveMemory({ text, title, project, metadata }, opts) {
  const payload = { text };
  if (title) payload.title = title;
  if (project) payload.project = project;
  if (metadata) payload.metadata = metadata;
  return workerPost('/api/memory/save', payload, opts);
}

/**
 * `query` is the field SearchManager destructures off the request (see
 * SearchManager.search); `q` is sent alongside only because it is free and
 * keeps this working if the alias is ever the documented one.
 */
export function searchMemory(query, { project, limit = 10, ...opts } = {}) {
  const params = new URLSearchParams({ query, q: query, limit: String(limit) });
  if (project) params.set('project', project);
  return workerGet(`/api/search?${params}`, opts);
}
