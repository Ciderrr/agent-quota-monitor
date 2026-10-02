// MockBridge —— 浏览器原型数据面（Gate C）；包装 MockProviderEngine。
import type { PlatformBridge } from "./bridgeTypes";
import type { ProviderMeta } from "../types/provider";
import { PROVIDERS } from "../types/provider";
import { engine, type Scenario } from "../mock/engine";

export const MockBridge: PlatformBridge = {
  async listProviders(): Promise<ProviderMeta[]> {
    return PROVIDERS;
  },
  async getSnapshots() {
    return engine.getSnapshots();
  },
  async getSnapshot(id) {
    return engine.getSnapshot(id);
  },
  async getHistory() {
    return engine.getHistory();
  },
  async getQuotaHistory(_providerId, _days) {
    // 浏览器原型不伪造额度历史：返回空 → 历史页如实显示「数据积累中」
    return [];
  },
  async refreshNow(id) {
    engine.refreshNow(id);
  },
  async setProviderEnabled(id, on) {
    engine.setEnabled(id, on);
  },
  async connectWithCredential(_id, _secret) {
    // Mock：绝不存储 secret；真实实现 = IPC → keyring → test connection
    return { ok: true };
  },
  async markConnected(id) {
    engine.markConnected(id);
  },
  async setScenario(s) {
    engine.setScenario(s as Scenario);
  },
};
