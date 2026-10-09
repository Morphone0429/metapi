import { getAccountsSnapshot } from "./accountsOverviewService.js";
import { deleteExpiredAdminSnapshots } from "./adminSnapshotStore.js";
import {
  getDashboardInsightsSnapshot,
  getDashboardSummarySnapshot,
} from "./dashboardSnapshotService.js";
import { getSiteStatsSnapshot } from "./siteStatsSnapshotService.js";
import { runUsageAggregationProjectionPass } from "./usageAggregationService.js";

const ADMIN_SNAPSHOT_WARM_INTERVAL_MS = Number(process.env.ADMIN_SNAPSHOT_WARM_INTERVAL_MS || 20_000);
// 低 IO 模式：ADMIN_SNAPSHOT_WARM_ENABLED=false 时完全不启动预热调度器
// （控制台首访会慢一点，但节省每 20s 一次的全量快照重写 ≈ 200GB/天 磁盘写入）
const ADMIN_SNAPSHOT_WARM_ENABLED = String(process.env.ADMIN_SNAPSHOT_WARM_ENABLED ?? "true") !== "false";
const ADMIN_SNAPSHOT_PRUNE_EVERY_PASSES = 6;

type SnapshotWarmTarget = {
  name: string;
  refresh: () => Promise<unknown>;
};

let adminSnapshotWarmTimer: ReturnType<typeof setInterval> | null = null;
let adminSnapshotWarmInFlight: Promise<void> | null = null;
let completedWarmPassCount = 0;

const snapshotWarmTargets: SnapshotWarmTarget[] = [
  {
    name: "dashboard-summary",
    refresh: () => getDashboardSummarySnapshot({ forceRefresh: true }),
  },
  {
    name: "accounts-snapshot",
    refresh: () => getAccountsSnapshot({ forceRefresh: true }),
  },
  {
    name: "site-stats",
    refresh: () => getSiteStatsSnapshot({ days: 7, forceRefresh: true }),
  },
  {
    name: "dashboard-insights",
    refresh: () => getDashboardInsightsSnapshot({ forceRefresh: true }),
  },
];

async function runAdminSnapshotWarmPass() {
  await runUsageAggregationProjectionPass();
  const settled = await Promise.allSettled(
    snapshotWarmTargets.map(async (target) => {
      await target.refresh();
      return target.name;
    }),
  );

  for (const result of settled) {
    if (result.status === "rejected") {
      console.warn(
        `[AdminSnapshotWarm] Failed to refresh snapshot: ${
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason || "unknown error")
        }`,
      );
    }
  }

  completedWarmPassCount += 1;
  if (completedWarmPassCount % ADMIN_SNAPSHOT_PRUNE_EVERY_PASSES === 0) {
    await deleteExpiredAdminSnapshots();
  }
}

export async function warmAdminSnapshotsOnce(): Promise<void> {
  if (adminSnapshotWarmInFlight) {
    return adminSnapshotWarmInFlight;
  }

  adminSnapshotWarmInFlight = runAdminSnapshotWarmPass().finally(() => {
    adminSnapshotWarmInFlight = null;
  });
  return adminSnapshotWarmInFlight;
}

export function startAdminSnapshotWarmScheduler() {
  if (adminSnapshotWarmTimer) return;
  if (!ADMIN_SNAPSHOT_WARM_ENABLED) {
    console.log("[AdminSnapshotWarm] disabled via ADMIN_SNAPSHOT_WARM_ENABLED=false");
    return;
  }
  void warmAdminSnapshotsOnce();
  adminSnapshotWarmTimer = setInterval(() => {
    void warmAdminSnapshotsOnce();
  }, ADMIN_SNAPSHOT_WARM_INTERVAL_MS);
}

export async function stopAdminSnapshotWarmScheduler() {
  if (adminSnapshotWarmTimer) {
    clearInterval(adminSnapshotWarmTimer);
    adminSnapshotWarmTimer = null;
  }
  if (adminSnapshotWarmInFlight) {
    await adminSnapshotWarmInFlight;
  }
}

export async function __resetAdminSnapshotWarmSchedulerForTests() {
  await stopAdminSnapshotWarmScheduler();
  completedWarmPassCount = 0;
}
