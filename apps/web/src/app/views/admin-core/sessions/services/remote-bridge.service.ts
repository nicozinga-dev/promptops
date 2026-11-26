import { Injectable, inject } from '@angular/core';
import { SessionAssetsService } from './session-assets.service';

/**
 * File bridge for remote sessions (cwd `cmd://` / `ssh://`).
 *
 * - Setup (once per session and cwd, per app launch): installs the `promptops-remote`
 *   MCP server on the host → the remote agent knows it is remote and has
 *   `send_to_local`, which puts files in `.promptops-assets/out/`.
 * - Polls the outbox while the session is the active one: Rust
 *   downloads the files to Downloads/PromptOps/<folder>/, opens them and
 *   moves them to `out/sent/` on the host.
 */
@Injectable({ providedIn: 'root' })
export class RemoteBridgeService {
  private assets = inject(SessionAssetsService);

  private static readonly POLL_MS = 4000;
  private static readonly MAX_BACKOFF_MS = 60000;

  private cwd: string | null = null;
  private sessionId: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private busy = false;
  private failures = 0;
  private readonly setupDone = new Set<string>();

  static isRemote(cwd: string | null | undefined): cwd is string {
    return !!cwd && (cwd.startsWith('cmd://') || cwd.startsWith('ssh://'));
  }

  private get api(): any {
    return (window as any).promptops;
  }

  /** Follows the active session: starts/stops polling when the session or its cwd changes. */
  watch(cwd: string | null | undefined, sessionId: string | null = null): void {
    const next = RemoteBridgeService.isRemote(cwd) && this.api?.remoteOutboxCollect ? cwd : null;
    if (next === this.cwd && sessionId === this.sessionId) return;
    this.stop();
    this.cwd = next;
    if (!next) return;
    this.sessionId = sessionId;
    void this.setup(next, sessionId);
    this.schedule(0);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.cwd = null;
    this.sessionId = null;
    this.failures = 0;
  }

  private async setup(cwd: string, sessionId: string | null): Promise<void> {
    // Per session: two sessions on the same folder may live on different hosts.
    const key = `${sessionId ?? ''}\n${cwd}`;
    if (this.setupDone.has(key)) return;
    this.setupDone.add(key);
    try {
      const res = await this.api.remoteBridgeSetup(cwd, sessionId);
      if (!res?.ok) {
        this.setupDone.delete(key);
        console.warn('[RemoteBridge] setup failed:', res?.error);
      }
    } catch (e) {
      this.setupDone.delete(key);
      console.warn('[RemoteBridge] setup failed:', e);
    }
  }

  private schedule(delay: number): void {
    this.timer = setTimeout(() => void this.tick(), delay);
  }

  private async tick(): Promise<void> {
    const cwd = this.cwd;
    const sessionId = this.sessionId;
    if (!cwd) return;
    // The previous session's collect is still running: try again shortly.
    // Returning without a reschedule stopped polling for good, because that
    // collect does not reschedule once the session has changed.
    if (this.busy) { this.schedule(300); return; }
    this.busy = true;
    try {
      const res = await this.api.remoteOutboxCollect(cwd, true, sessionId);
      if (res?.files?.length) void this.assets.loadAssets(cwd);
      this.failures = res?.ok ? 0 : this.failures + 1;
      if (!res?.ok) console.warn('[RemoteBridge] outbox:', res?.error);
    } catch (e) {
      this.failures++;
      console.warn('[RemoteBridge] outbox:', e);
    } finally {
      this.busy = false;
    }
    if (this.cwd !== cwd || this.sessionId !== sessionId) return;
    // Host unreachable (session in standby, network down): slow down.
    const delay = Math.min(RemoteBridgeService.POLL_MS * 2 ** this.failures, RemoteBridgeService.MAX_BACKOFF_MS);
    this.schedule(delay);
  }
}

/** For text coming from the host (file names, errors) shown via html. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
