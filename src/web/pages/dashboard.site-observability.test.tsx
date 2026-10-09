import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, create, type ReactTestInstance } from 'react-test-renderer';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../components/Toast.js';
import Dashboard from './Dashboard.js';
import { installDashboardSnapshotCompat } from './testApiCompat.js';

const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    getDashboard: vi.fn(),
    getDashboardSnapshot: vi.fn(),
    getDashboardInsights: vi.fn(),
    getSiteSnapshot: vi.fn(),
    getSiteDistribution: vi.fn(),
    getSiteTrend: vi.fn(),
    getSites: vi.fn(),
  },
}));

vi.mock('../api.js', () => ({
  api: apiMock,
}));

function collectText(node: ReactTestInstance): string {
  return (node.children || []).map((child) => {
    if (typeof child === 'string') return child;
    return collectText(child);
  }).join('');
}

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('Dashboard site observability panel', () => {
  const originalDocument = globalThis.document;

  beforeEach(() => {
    vi.clearAllMocks();
    installDashboardSnapshotCompat(apiMock);
    apiMock.getDashboard.mockResolvedValue({
      totalBalance: 0,
      totalUsed: 0,
      todaySpend: 0,
      todayReward: 0,
      activeAccounts: 0,
      totalAccounts: 0,
      todayCheckin: { success: 0, total: 0 },
      proxy24h: { success: 0, total: 0, totalTokens: 0 },
      performance: { windowSeconds: 60, requestsPerMinute: 0, tokensPerMinute: 0 },
      siteAvailability: [{
        siteId: 1,
        siteName: 'Demo Site',
        siteUrl: 'https://example.com',
        platform: 'new-api',
        totalRequests: 8,
        successCount: 6,
        failedCount: 2,
        availabilityPercent: 75,
        averageLatencyMs: 320,
        buckets: Array.from({ length: 24 }, (_, index) => ({
          startUtc: new Date(Date.UTC(2026, 2, 11, index, 0, 0)).toISOString(),
          label: `2026-03-11 ${String(index).padStart(2, '0')}:00:00`,
          totalRequests: index < 8 ? 1 : 0,
          successCount: index < 6 ? 1 : 0,
          failedCount: index >= 6 && index < 8 ? 1 : 0,
          availabilityPercent: index < 6 ? 100 : index < 8 ? 0 : null,
          averageLatencyMs: index < 8 ? 320 : null,
        })),
      }],
      modelAnalysis: null,
    });
    apiMock.getSiteDistribution.mockResolvedValue({ distribution: [] });
    apiMock.getSiteTrend.mockResolvedValue({ trend: [] });
    apiMock.getSites.mockResolvedValue([]);
    globalThis.document = {
      visibilityState: 'visible',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      getElementById: vi.fn(() => null),
    } as unknown as Document;
  });

  afterEach(() => {
    globalThis.document = originalDocument;
    vi.clearAllMocks();
  });

  it('renders site availability strips and summary metrics', async () => {
    let root!: WebTestRenderer;

    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/']}>
            <ToastProvider>
              <Dashboard />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      const panel = root!.root.find((node) => (
        typeof node.props.className === 'string'
        && node.props.className.includes('site-observability-panel')
      ));

      const cells = panel.findAll((node) => (
        node.type === 'a'
        && typeof node.props.className === 'string'
        && node.props.className.includes('site-availability-cell')
      ));

      const logLink = panel.find((node) => (
        node.type === 'a'
        && typeof node.props.className === 'string'
        && node.props.className.includes('site-observability-log-link')
      ));

      expect(collectText(panel)).toContain('站点可用性观测');
      expect(collectText(panel)).toContain('Demo Site');
      expect(collectText(panel)).toContain('75%');
      expect(collectText(panel)).toContain('320ms');
      expect(logLink.props.title).toBe('查看日志');
      expect(cells).toHaveLength(24);
      expect(String(cells[0]?.props.title || '')).toContain('可用性 100%');
      expect(String(cells[7]?.props.title || '')).toContain('可用性 0%');
      expect(String(cells[0]?.props['data-tooltip'] || '')).toContain('时间：');
      expect(String(cells[0]?.props['data-tooltip'] || '')).toContain('可用性：100%');
      expect(String(cells[0]?.props['data-tooltip'] || '')).toContain('成功/失败：1/0');
      expect(String(logLink.props.href || logLink.props.to || '')).toContain('/logs?siteId=1');
    } finally {
      root?.unmount();
    }
  });

  it('sorts active sites by availability percent by default and falls back to request count after switching', async () => {
    // node 测试环境下无 localStorage，用内存 Map stub 验证持久化
    const localStorageState = new Map<string, string>();
    const originalLocalStorage = globalThis.localStorage;
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: vi.fn((key: string) => (localStorageState.has(key) ? localStorageState.get(key)! : null)),
        setItem: vi.fn((key: string, value: string) => {
          localStorageState.set(String(key), String(value));
        }),
        removeItem: vi.fn((key: string) => {
          localStorageState.delete(String(key));
        }),
      },
      configurable: true,
      writable: true,
    });

    installDashboardSnapshotCompat(apiMock);
    apiMock.getDashboard.mockResolvedValue({
      totalBalance: 0,
      totalUsed: 0,
      todaySpend: 0,
      todayReward: 0,
      activeAccounts: 0,
      totalAccounts: 0,
      todayCheckin: { success: 0, total: 0 },
      proxy24h: { success: 0, total: 0, totalTokens: 0 },
      performance: { windowSeconds: 60, requestsPerMinute: 0, tokensPerMinute: 0 },
      siteAvailability: [
        // 请求最多但可用性最低：按可用性时应排最后，按请求次数时应排第一
        {
          siteId: 1,
          siteName: 'Busy Broken',
          platform: 'new-api',
          totalRequests: 100,
          successCount: 10,
          failedCount: 90,
          availabilityPercent: 10,
          averageLatencyMs: 300,
          buckets: [],
        },
        // 可用性最高但请求较少：按可用性时应排第一
        {
          siteId: 2,
          siteName: 'Reliable Small',
          platform: 'new-api',
          totalRequests: 20,
          successCount: 20,
          failedCount: 0,
          availabilityPercent: 100,
          averageLatencyMs: 200,
          buckets: [],
        },
        // 可用性居中
        {
          siteId: 3,
          siteName: 'Middle Site',
          platform: 'new-api',
          totalRequests: 50,
          successCount: 40,
          failedCount: 10,
          availabilityPercent: 80,
          averageLatencyMs: 250,
          buckets: [],
        },
        // 无可用性数据：按可用性时应排在有效百分比之后
        {
          siteId: 4,
          siteName: 'No Data Site',
          platform: 'new-api',
          totalRequests: 30,
          successCount: 30,
          failedCount: 0,
          availabilityPercent: null,
          averageLatencyMs: null,
          buckets: [],
        },
      ],
      modelAnalysis: null,
    });

    let root!: WebTestRenderer;

    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/']}>
            <ToastProvider>
              <Dashboard />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      const readSiteOrder = (): string[] => {
        const panel = root!.root.find((node) => (
          typeof node.props.className === 'string'
          && node.props.className.includes('site-observability-panel')
        ));
        return panel
          .findAll((node) => (
            typeof node.props.className === 'string'
            && node.props.className.includes('site-observability-site-name')
          ))
          .map((node) => collectText(node));
      };

      const subtitle = () => {
        const panel = root!.root.find((node) => (
          typeof node.props.className === 'string'
          && node.props.className.includes('site-observability-subtitle')
        ));
        return collectText(panel);
      };

      // 默认按可用性百分比降序，null 排在有效百分比之后
      expect(readSiteOrder()).toEqual([
        'Reliable Small',
        'Middle Site',
        'Busy Broken',
        'No Data Site',
      ]);
      expect(subtitle()).toContain('按可用性排序');

      // 切换回按请求次数排序后恢复原有顺序
      const select = root!.root.find((node) => (
        node.type === 'select'
        && node.props.className === 'site-observability-sort-select'
      ));

      await act(async () => {
        select.props.onChange({ target: { value: 'requests' } });
        await Promise.resolve();
      });

      expect(readSiteOrder()).toEqual([
        'Busy Broken',
        'Middle Site',
        'No Data Site',
        'Reliable Small',
      ]);
      expect(subtitle()).toContain('按使用量排序');
      expect(globalThis.localStorage?.getItem('metapi.dashboard.siteSortMode')).toBe('requests');
    } finally {
      root?.unmount();
      if (originalLocalStorage === undefined) {
        delete (globalThis as { localStorage?: unknown }).localStorage;
      } else {
        Object.defineProperty(globalThis, 'localStorage', {
          value: originalLocalStorage,
          configurable: true,
          writable: true,
        });
      }
    }
  });

  it('restores persisted sort mode from localStorage on remount', async () => {
    // 预先写入已保存的排序偏好，验证重挂载后恢复为按请求次数
    const localStorageState = new Map<string, string>([
      ['metapi.dashboard.siteSortMode', 'requests'],
    ]);
    const originalLocalStorage = globalThis.localStorage;
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: vi.fn((key: string) => (localStorageState.has(key) ? localStorageState.get(key)! : null)),
        setItem: vi.fn((key: string, value: string) => {
          localStorageState.set(String(key), String(value));
        }),
        removeItem: vi.fn((key: string) => {
          localStorageState.delete(String(key));
        }),
      },
      configurable: true,
      writable: true,
    });

    installDashboardSnapshotCompat(apiMock);
    apiMock.getDashboard.mockResolvedValue({
      totalBalance: 0,
      totalUsed: 0,
      todaySpend: 0,
      todayReward: 0,
      activeAccounts: 0,
      totalAccounts: 0,
      todayCheckin: { success: 0, total: 0 },
      proxy24h: { success: 0, total: 0, totalTokens: 0 },
      performance: { windowSeconds: 60, requestsPerMinute: 0, tokensPerMinute: 0 },
      siteAvailability: [
        {
          siteId: 1,
          siteName: 'Busy Broken',
          platform: 'new-api',
          totalRequests: 100,
          successCount: 10,
          failedCount: 90,
          availabilityPercent: 10,
          averageLatencyMs: 300,
          buckets: [],
        },
        {
          siteId: 2,
          siteName: 'Reliable Small',
          platform: 'new-api',
          totalRequests: 20,
          successCount: 20,
          failedCount: 0,
          availabilityPercent: 100,
          averageLatencyMs: 200,
          buckets: [],
        },
      ],
      modelAnalysis: null,
    });

    let root!: WebTestRenderer;

    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/']}>
            <ToastProvider>
              <Dashboard />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      const panel = root!.root.find((node) => (
        typeof node.props.className === 'string'
        && node.props.className.includes('site-observability-panel')
      ));

      // 已持久化「按请求次数」时，重挂载后直接恢复请求次数降序
      const siteNames = panel
        .findAll((node) => (
          typeof node.props.className === 'string'
          && node.props.className.includes('site-observability-site-name')
        ))
        .map((node) => collectText(node));
      expect(siteNames).toEqual(['Busy Broken', 'Reliable Small']);
      expect(collectText(panel)).toContain('按使用量排序');
    } finally {
      root?.unmount();
      if (originalLocalStorage === undefined) {
        delete (globalThis as { localStorage?: unknown }).localStorage;
      } else {
        Object.defineProperty(globalThis, 'localStorage', {
          value: originalLocalStorage,
          configurable: true,
          writable: true,
        });
      }
    }
  });
});
