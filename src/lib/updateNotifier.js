/**
 * Update Notifier — server-side check for 9Router updates.
 *
 * Unlike the stock build (which checks the public npm registry), the "latest
 * version" here comes from the *latest git tag* published on the custom fork
 * repository this build is based on:
 *
 *   https://github.com/arsydoni4326-alt/9routercustom.git
 *
 * The GitHub tags API is the source of truth (tags are returned newest-first,
 * e.g. `v0.5.66-arsydoni4326-alt`), so a new tag pushed to the repo is what
 * triggers the update notification — not proxy traffic.
 *
 * A lightweight server-side poller checks for the latest incoming tag every
 * `checkIntervalMs`; the same throttled check also runs when the dashboard
 * opens. When a newer tag is found, an "update" event is broadcast to connected
 * dashboard clients via the SSE stream at `/api/notifications/stream`, which
 * renders the update popup.
 */

import { EventEmitter } from "events";
import pkg from "../../package.json" with { type: "json" };

export const UPDATE_NOTIFIER_CONFIG = {
  repoUrl: "https://github.com/arsydoni4326-alt/9routercustom.git",
  tagsApiUrl: "https://api.github.com/repos/arsydoni4326-alt/9routercustom/tags",
  fetchTimeoutMs: 4000,
  // Poll interval for the latest incoming tag; also the minimum gap between
  // network checks so GitHub is never hit more often than this.
  checkIntervalMs: 15 * 60 * 1000,
};

// Survive hot reload; one emitter + state per process (same pattern as statsEmitter).
if (!global.__updateNotifierEmitter) {
  global.__updateNotifierEmitter = new EventEmitter();
  global.__updateNotifierEmitter.setMaxListeners(50);
}
if (!global.__updateNotifierState) {
  global.__updateNotifierState = { latestVersion: null, lastCheckAt: 0, checking: false };
}

const emitter = global.__updateNotifierEmitter;
const state = global.__updateNotifierState;

// Tags may carry a suffix (e.g. "0.5.66-arsydoni4326-alt"); only the leading
// numeric part of each dot-segment participates in the comparison.
function parseVersionPart(part) {
  const m = String(part).match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

function compareVersions(a, b) {
  const pa = String(a).replace(/^v/, "").split(".").map(parseVersionPart);
  const pb = String(b).replace(/^v/, "").split(".").map(parseVersionPart);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

// Tags API returns tags newest-first; the first entry is the latest incoming tag.
async function fetchLatestTag() {
  try {
    const res = await fetch(UPDATE_NOTIFIER_CONFIG.tagsApiUrl, {
      headers: { Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(UPDATE_NOTIFIER_CONFIG.fetchTimeoutMs),
    });
    if (!res.ok) return null;
    const tags = await res.json();
    const name = Array.isArray(tags) && tags[0]?.name;
    return typeof name === "string" ? name.replace(/^v/, "") : null;
  } catch {
    return null;
  }
}

function buildUpdateInfo(latestVersion) {
  const currentVersion = pkg.version;
  const hasUpdate = latestVersion ? compareVersions(latestVersion, currentVersion) > 0 : false;
  return { currentVersion, latestVersion, hasUpdate, source: UPDATE_NOTIFIER_CONFIG.repoUrl };
}

// Periodic poller: keeps checking for the latest incoming tag on the fork repo
// even when no dashboard is open and there is no proxy traffic. `force: true`
// bypasses the cooldown; the interval itself spaces out the GitHub calls.
if (!global.__updateNotifierTimerStarted) {
  global.__updateNotifierTimerStarted = true;
  const timer = setInterval(() => {
    checkForUpdate({ force: true }).catch(() => {});
  }, UPDATE_NOTIFIER_CONFIG.checkIntervalMs);
  timer.unref?.();
}

/**
 * Check the fork repo for the latest incoming tag.
 *
 * - Throttled: within `checkIntervalMs` of the last network check the cached
 *   result is returned (no GitHub request). The internal poller passes
 *   `force: true` and relies on its own interval instead.
 * - Concurrent calls collapse onto the in-flight check.
 * - When a newer tag is found, emits "update" so the SSE stream can push the
 *   popup to every open dashboard.
 *
 * Safe to call fire-and-forget (any rejection is caught).
 */
export async function checkForUpdate({ force = false } = {}) {
  if (state.checking) return getUpdateInfo();

  const now = Date.now();
  if (!force && now - state.lastCheckAt < UPDATE_NOTIFIER_CONFIG.checkIntervalMs) {
    return getUpdateInfo();
  }

  state.checking = true;
  try {
    const latestTag = await fetchLatestTag();
    state.lastCheckAt = now;
    if (latestTag) state.latestVersion = latestTag;
    const info = buildUpdateInfo(state.latestVersion);
    if (info.hasUpdate) emitter.emit("update", info);
    return info;
  } catch {
    return getUpdateInfo();
  } finally {
    state.checking = false;
  }
}

/** Cached last-known update info (never performs a network request). */
export function getUpdateInfo() {
  return buildUpdateInfo(state.latestVersion);
}

/** Subscribe to "update available" broadcasts. Returns an unsubscribe fn. */
export function onUpdateAvailable(listener) {
  emitter.on("update", listener);
  return () => emitter.off("update", listener);
}