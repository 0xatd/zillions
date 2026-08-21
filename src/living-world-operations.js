export const TUTORIAL_STEPS = Object.freeze([
  { key: 'movement', label: 'Move through Greenfall' }, { key: 'town', label: 'Use Greenfall Crossing' },
  { key: 'recruitment', label: 'Recruit your first company unit' }, { key: 'trade', label: 'Buy or sell supplies' },
  { key: 'battle', label: 'Resolve your first encounter' },
]);
export function tutorialStatus(progress = {}) {
  const steps = TUTORIAL_STEPS.map((step) => ({ ...step, complete: progress[`${step.key}_complete`] === true }));
  const completed = steps.filter((step) => step.complete).length;
  return { steps, completed, total: steps.length, complete: completed === steps.length, enteredWorld: Boolean(progress.entered_world_at) };
}
const ageSeconds = (value, now) => value ? Math.max(0, (now - new Date(value).getTime()) / 1000) : Infinity;
export function summarizeWorldOperations(snapshot = {}, now = Date.now()) {
  const leases = snapshot.leases || [], commands = snapshot.commands || [], tutorials = snapshot.tutorials || [], runtimeHealth = snapshot.runtimeHealth || [];
  const staleLeases = leases.filter((lease) => ageSeconds(lease.heartbeat_at, now) > 45 || new Date(lease.lease_until).getTime() <= now);
  const stuckCommands = commands.filter((command) => !command.completed_at && ageSeconds(command.created_at, now) > 60);
  const runtimeFailures = runtimeHealth.filter((row) => row.success === false || row.threshold_breached === true);
  const completed = tutorials.filter((progress) => tutorialStatus(progress).complete).length;
  const entered = tutorials.filter((progress) => progress.entered_world_at).length;
  return { status: staleLeases.length || stuckCommands.length || runtimeFailures.length ? 'degraded' : 'healthy', activeRegions: leases.length - staleLeases.length,
    staleLeases: staleLeases.map((lease) => ({ regionId: lease.region_id, workerId: lease.worker_id })),
    stuckCommands: stuckCommands.map((command) => ({ shardId: command.shard_id, requestId: command.request_id, type: command.command_type })),
    runtimeFailures: runtimeFailures.slice(0, 100).map((row) => ({ regionId: row.region_id, tick: Number(row.world_tick), workerId: row.worker_id, error: row.error_code || null, lag: Number(row.worker_lag) || 0, backlog: Number(row.command_backlog) || 0, saturated: row.action_saturated === true, thresholdBreached: row.threshold_breached === true, recordedAt: row.recorded_at })),
    tutorial: { started: tutorials.length, completed, entered, completionRate: tutorials.length ? Math.round(completed * 1000 / tutorials.length) / 10 : 0, entryRate: completed ? Math.round(entered * 1000 / completed) / 10 : 0 },
    counts: { openEncounters: Number(snapshot.openEncounters) || 0, activeSieges: Number(snapshot.activeSieges) || 0, recentEvents: Number(snapshot.recentEvents) || 0 } };
}
