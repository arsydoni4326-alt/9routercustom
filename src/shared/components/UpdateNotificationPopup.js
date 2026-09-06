"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import { UPDATER_CONFIG } from "@/shared/constants/config";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import Button from "./Button";

/**
 * Popup notification shown when a newer build is available on the custom fork
 * repo (github.com/arsydoni4326-alt/9routercustom). It is pushed to the
 * dashboard via SSE (/api/notifications/stream) whenever an incoming task
 * triggers the server-side check and an update is found.
 */
export default function UpdateNotificationPopup({ updateInfo, onClose }) {
  const [shutdownCountdown, setShutdownCountdown] = useState(0);
  const [isDisconnected, setIsDisconnected] = useState(false);
  const { copied, copy } = useCopyToClipboard(2000);

  const INSTALL_CMD = UPDATER_CONFIG.installCmdLatest;
  const isCountingDown = shutdownCountdown > 0;

  // Copy + countdown + shutdown (same flow as the old sidebar update panel).
  const handleCopyAndShutdown = async () => {
    try { await navigator.clipboard.writeText(INSTALL_CMD); } catch { /* clipboard blocked */ }
    copy(INSTALL_CMD);
    let remaining = UPDATER_CONFIG.shutdownCountdownSec;
    setShutdownCountdown(remaining);
    const timer = setInterval(() => {
      remaining -= 1;
      setShutdownCountdown(remaining);
      if (remaining <= 0) {
        clearInterval(timer);
        fetch("/api/version/shutdown", { method: "POST" }).catch(() => {});
        setIsDisconnected(true);
      }
    }, 1000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-6 fade-in">
      {isDisconnected ? (
        <div className="text-center p-8 w-full max-w-lg rounded-xl bg-neutral-900/95 border border-white/10 text-white">
          <div className="flex items-center justify-center size-16 rounded-full bg-red-500/20 text-red-500 mx-auto mb-4">
            <span className="material-symbols-outlined text-[32px]">power_off</span>
          </div>
          <h2 className="text-xl font-semibold text-white mb-2">Server Disconnected</h2>
          <p className="text-text-muted mb-6">The proxy server has been stopped.</p>
          <Button variant="secondary" onClick={() => globalThis.location.reload()}>
            Reload Page
          </Button>
        </div>
      ) : (
        <div className="w-full max-w-lg rounded-xl bg-neutral-900/95 border border-white/10 p-6 text-white shadow-[var(--shadow-elev)] fade-in">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex items-center justify-center size-11 rounded-full bg-amber-500/20 text-amber-400">
              <span className="material-symbols-outlined text-[24px]">content_copy</span>
            </div>
            <div>
              <h2 className="text-lg font-semibold">Update 9Router{updateInfo?.latestVersion ? ` to v${updateInfo.latestVersion}` : ""}</h2>
              <p className="text-xs text-white/60">
                {isCountingDown
                  ? `Command copied. Server will stop in ${shutdownCountdown}s...`
                  : "A new build is available on the custom repo. Click the button below to copy the install command and shutdown."}
              </p>
            </div>
          </div>

          <p className="text-sm text-white/80 mb-2">Install command:</p>
          <div className="w-full px-3 py-2 rounded bg-white/5 mb-4">
            <code className="text-xs font-mono text-amber-400 break-all">{INSTALL_CMD}</code>
          </div>

          <ol className="text-xs text-white/70 space-y-1 list-decimal list-inside mb-4">
            <li>Click <strong>Copy & Shutdown</strong> below.</li>
            <li>Paste the command into your terminal and press Enter.</li>
            <li>Run <code className="px-1 rounded bg-white/10 text-green-400">9router</code> again after install.</li>
          </ol>

          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose} disabled={isCountingDown}>
              Later
            </Button>
            <Button variant="primary" fullWidth onClick={handleCopyAndShutdown} disabled={isCountingDown}>
              {copied ? "✓ Copied — shutting down..." : isCountingDown ? `Shutting down in ${shutdownCountdown}s` : "Copy & Shutdown"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

UpdateNotificationPopup.propTypes = {
  updateInfo: PropTypes.shape({
    currentVersion: PropTypes.string,
    latestVersion: PropTypes.string,
    hasUpdate: PropTypes.bool,
    source: PropTypes.string,
  }).isRequired,
  onClose: PropTypes.func.isRequired,
};