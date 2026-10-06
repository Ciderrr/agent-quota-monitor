// PlatformBridge —— UI 与平台层的唯一边界（接口定义）。
// MockBridge（浏览器原型）与 TauriBridge（真实壳）实现同一接口，UI 组件零改动切换。
import type { ProviderMeta, ProviderSnapshot } from "../types/provider";
import type { HistorySeries, Scenario } from "../mock/engine";

export interface PlatformBridge {
  listProviders(): Promise<ProviderMeta[]>;
  getSnapshots(): Promise<ProviderSnapshot[]>;
  getSnapshot(id: string): Promise<ProviderSnapshot | undefined>;
  getHistory(): Promise<HistorySeries[]>;
  /** 额度百分比历史（真实壳：来自 snapshots 存档；mock 返回空）；account 缺省 main */
  getQuotaHistory(providerId: string, days: number, account?: string): Promise<HistorySeries[]>;
  /** id 可为 provider_id（刷新全部实例）或 "{provider}/{account}" 实例键（单账号） */
  refreshNow(id?: string): Promise<void>;
  setProviderEnabled(id: string, on: boolean): Promise<void>;
  /** 凭证值只在 native 侧留存；实现必须立即转交并丢弃；account 缺省 main */
  connectWithCredential(id: string, secret: string, account?: string): Promise<{ ok: boolean; message?: string }>;
  markConnected(id: string): Promise<void>; // mock-only
  setScenario(s: Scenario): Promise<void>; // mock-only
}
