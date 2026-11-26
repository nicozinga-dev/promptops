import { TestBed, fakeAsync, flushMicrotasks, tick, discardPeriodicTasks } from '@angular/core/testing';
import { SessionAssetsService } from './session-assets.service';
import { DockerService } from './docker.service';
import { RemoteBridgeService } from './remote-bridge.service';
import { SubAgentReviewService } from './sub-agent-review.service';

/** Late answers and failing polls in the per-session panels. */
describe('session panels: stale answers and polls', () => {
  afterEach(() => delete (window as any).promptops);

  function deferred<T>() {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => (resolve = r));
    return { promise, resolve };
  }

  it('assets: the previous session\'s late list never replaces the current one', async () => {
    const a = deferred<any>();
    (window as any).promptops = {
      listAssets: (cwd: string) => (cwd === '/a' ? a.promise : Promise.resolve({ ok: true, assets: [{ name: 'b.png' }] })),
    };
    const svc = TestBed.inject(SessionAssetsService);
    const first = svc.loadAssets('/a');
    await svc.loadAssets('/b');
    a.resolve({ ok: true, assets: [{ name: 'a.png' }] });
    await first;
    expect(svc.assets().map((x) => x.name)).toEqual(['b.png']);
    expect(svc.loading()).toBeFalse();
  });

  it('assets: a failed delete is reported instead of looking done', async () => {
    (window as any).promptops = { deleteAsset: async () => ({ ok: false, error: 'locked' }) };
    const svc = TestBed.inject(SessionAssetsService);
    svc.assets.set([{ name: 'x.png' } as any]);
    await expectAsync(svc.deleteAsset('/a', 'x.png')).toBeRejectedWithError('locked');
    expect(svc.assets().length).toBe(1);
  });

  it('docker: the previous folder\'s late answer is dropped', async () => {
    const a = deferred<any>();
    (window as any).promptops = {
      dockerPs: (cwd: string) => (cwd === '/a' ? a.promise : Promise.resolve({ ok: true, containers: [{ name: 'b' }], allContainers: [] })),
    };
    const svc = TestBed.inject(DockerService);
    const first = svc.loadContainers('/a');
    await svc.loadContainers('/b');
    a.resolve({ ok: true, containers: [{ name: 'a' }], allContainers: [] });
    await first;
    expect(svc.containers().map((c: any) => c.name)).toEqual(['b']);
  });

  it('remote bridge keeps polling the new session when the old collect is still running', fakeAsync(() => {
    const calls: string[] = [];
    const slow = deferred<any>();
    (window as any).promptops = {
      remoteBridgeSetup: async () => ({ ok: true }),
      remoteOutboxCollect: (cwd: string) => { calls.push(cwd); return cwd === 'ssh://a' ? slow.promise : Promise.resolve({ ok: true, files: [] }); },
    };
    const bridge = TestBed.inject(RemoteBridgeService);
    bridge.watch('ssh://a');
    tick(0);
    bridge.watch('ssh://b');
    tick(0);
    slow.resolve({ ok: true, files: [] });
    flushMicrotasks();
    tick(1000);
    expect(calls).toContain('ssh://b');
    bridge.stop();
    discardPeriodicTasks();
  }));

  it('assets: remote calls carry the active session id only for its own folder', async () => {
    const calls: Array<[string, string | null]> = [];
    (window as any).promptops = {
      listAssets: async (cwd: string, sessionId: string | null) => { calls.push([cwd, sessionId]); return { ok: true, assets: [] }; },
    };
    const svc = TestBed.inject(SessionAssetsService);
    svc.setActiveSession('prod', 'cmd:///app');
    await svc.loadAssets('cmd:///app');
    await svc.loadAssets('cmd:///other');
    svc.setActiveSession(null, null);
    await svc.loadAssets('cmd:///app');
    expect(calls).toEqual([['cmd:///app', 'prod'], ['cmd:///other', null], ['cmd:///app', null]]);
  });

  it('remote bridge sets up and polls each session on a shared folder with its own id', fakeAsync(() => {
    const setups: Array<string | null> = [];
    const collects: Array<string | null> = [];
    (window as any).promptops = {
      remoteBridgeSetup: async (_cwd: string, sessionId: string | null) => { setups.push(sessionId); return { ok: true }; },
      remoteOutboxCollect: async (_cwd: string, _open: boolean, sessionId: string | null) => { collects.push(sessionId); return { ok: true, files: [] }; },
    };
    const bridge = TestBed.inject(RemoteBridgeService);
    bridge.watch('cmd:///app', 'staging');
    tick(0);
    bridge.watch('cmd:///app', 'prod');
    tick(0);
    bridge.watch('cmd:///app', 'staging');
    tick(0);
    expect(setups).toEqual(['staging', 'prod']);
    expect(collects).toEqual(['staging', 'prod', 'staging']);
    bridge.stop();
    discardPeriodicTasks();
  }));

  it('review history poll stops after repeated failures', fakeAsync(() => {
    let calls = 0;
    (window as any).promptops = {
      listSubAgentReviews: async () => {
        calls++;
        return calls === 1 ? { ok: true, runs: [{ id: 'r1', status: 'running', subAgentId: 'sa' }] } : { ok: false };
      },
    };
    const svc = TestBed.inject(SubAgentReviewService);
    void svc.hydrateTask('sa');
    flushMicrotasks();
    tick(10_000);
    flushMicrotasks();
    const after = calls;
    tick(10_000);
    flushMicrotasks();
    expect(calls).toBe(after);
    expect(after).toBeLessThanOrEqual(7);
  }));
});
