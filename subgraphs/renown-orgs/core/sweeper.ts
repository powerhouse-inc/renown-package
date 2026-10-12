/** The slice of the store the sweeper needs. */
export interface SweepStore {
  claimJob: (name: string, now: Date, everyMs: number) => Promise<{ previous: Date | null } | null>;
  releaseJob: (name: string, claimedAt: Date, previous: Date | null) => Promise<void>;
}

export const SWEEP_INTERVAL_MS = 60_000;

export interface SweepJob {
  name: string;
  /** Minimum time between two runs. */
  everyMs: number;
  run(now: Date): Promise<void>;
}

/**
 * The sweeper: each tick (one interval per replica) claims every job whose
 * interval has passed — atomically in org_jobs, so exactly one replica runs
 * it — and runs it. A failed run gives its claim back and is retried on the
 * next tick. Ticks never overlap within a process.
 */
export function createSweeper(deps: {
  jobs: readonly SweepJob[];
  store: () => SweepStore;
  now: () => Date;
  log?: (message: string) => void;
}): { tick(): Promise<string[]> } {
  const log = deps.log ?? ((message: string) => console.error(message));
  let running = false;
  return {
    async tick() {
      if (running) return [];
      running = true;
      const ran: string[] = [];
      try {
        const store = deps.store();
        for (const job of deps.jobs) {
          const now = deps.now();
          const claim = await store.claimJob(job.name, now, job.everyMs);
          if (!claim) continue;
          try {
            await job.run(now);
            ran.push(job.name);
          } catch (error) {
            log(`[renown-orgs] sweep job ${job.name} failed: ${error instanceof Error ? error.message : String(error)}`);
            await store.releaseJob(job.name, now, claim.previous);
          }
        }
      } catch (error) {
        log(`[renown-orgs] sweep failed: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        running = false;
      }
      return ran;
    },
  };
}
