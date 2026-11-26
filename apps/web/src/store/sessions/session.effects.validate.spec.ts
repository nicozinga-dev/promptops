import { TestBed } from '@angular/core/testing';
import { Actions } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { Subject, of } from 'rxjs';
import { SessionEffects } from './session.effects';
import { updateSessionSuccess } from './session.actions';
import { SessionService } from '../../app/views/admin-core/sessions/services/session.service';
import { PromptInjectionService } from '../../app/views/admin-core/sessions/services/prompt-injection.service';
import { SubAgentStashService } from '../../app/views/admin-core/sessions/services/sub-agent-stash.service';
import { TodoStoreService } from '../../app/views/admin-core/sessions/services/todo-store.service';
import { DesktopSessionApiService } from '../../app/views/admin-core/sessions/services/desktop-session-api.service';
import { SessionHistoryService } from '../../app/views/admin-core/sessions/services/session-history.service';
import { WorkspaceApiService } from '../../app/views/admin-core/sessions/services/workspace-api.service';
import { SidebarFoldersService } from '../../app/views/admin-core/sessions/services/sidebar-folders.service';
import { PtyDimsRegistry } from '../../app/views/admin-core/sessions/services/pty-dims-registry.service';
import { SwalService } from '../../app/core/services/swal.service';

/** The "missing folder" check looks at the local disk: remote folders must never be flagged. */
describe('SessionEffects validateSessionPaths', () => {
  let validate: jasmine.Spy;
  let dispatch: jasmine.Spy;
  let effects: SessionEffects;

  const session = (id: string, localPath: string) => ({
    id, name: id, provider: 'claude-code-cli', status: 'idle', createdAt: '', pendingInteractionCount: 0,
    deviceWorkspace: { id: '', localPath, status: 'configured' },
  });

  beforeEach(() => {
    validate = jasmine.createSpy('validateWorkspacePath').and.resolveTo({ valid: false });
    dispatch = jasmine.createSpy('dispatch');
    const stub = {} as any;
    TestBed.configureTestingModule({
      providers: [
        SessionEffects,
        { provide: Actions, useValue: new Actions(new Subject<any>()) },
        { provide: Store, useValue: { select: () => of([]), dispatch } },
        { provide: SessionService, useValue: { validateWorkspacePath: validate, isDesktop: true } },
        { provide: TranslateService, useValue: { instant: (k: string) => k } },
        ...[DesktopSessionApiService, SessionHistoryService, PromptInjectionService, SubAgentStashService,
          TodoStoreService, WorkspaceApiService, SidebarFoldersService, PtyDimsRegistry, SwalService]
          .map((provide) => ({ provide, useValue: stub })),
      ],
    });
    effects = TestBed.inject(SessionEffects);
  });

  it('skips ssh:// and cmd:// sessions', async () => {
    await (effects as any).validateSessionPaths([session('a', 'ssh://conn/home/u/app'), session('b', 'cmd:///srv/app')]);
    expect(validate).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('still flags a missing local folder', async () => {
    await (effects as any).validateSessionPaths([session('c', '/home/u/gone')]);
    expect(validate).toHaveBeenCalledOnceWith('/home/u/gone');
    expect(dispatch).toHaveBeenCalledTimes(1);
    const action = dispatch.calls.mostRecent().args[0];
    expect(action.type).toBe(updateSessionSuccess.type);
    expect(action.session.deviceWorkspace.status).toBe('invalid_path');
  });
});
