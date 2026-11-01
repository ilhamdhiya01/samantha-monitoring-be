import { canStop, getActionBlocker } from './action-policy';

const base = {
  enabled: true,
  hasClient: true,
  protectedProjects: ['samantha-monitoring-be'],
  project: 'goodenglish-be',
  status: 'running' as const,
};

describe('action-policy', () => {
  it('allows actions when enabled, connected and not protected', () => {
    expect(getActionBlocker(base)).toBeNull();
    expect(getActionBlocker({ ...base, project: null })).toBeNull();
  });

  it('blocks when disabled or without an action proxy', () => {
    expect(getActionBlocker({ ...base, enabled: false })).toMatch(
      /ACTIONS_ENABLED/,
    );
    expect(getActionBlocker({ ...base, hasClient: false })).toMatch(
      /DOCKER_ACTION_HOST/,
    );
  });

  it("protects the monitor's own compose project", () => {
    expect(
      getActionBlocker({ ...base, project: 'samantha-monitoring-be' }),
    ).toMatch(/monitor/);
  });

  it('knows which states can be stopped', () => {
    expect(canStop('running')).toBe(true);
    expect(canStop('restarting')).toBe(true);
    expect(canStop('exited')).toBe(false);
  });
});
