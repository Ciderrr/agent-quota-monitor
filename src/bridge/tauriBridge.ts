// TauriBridge —— 真实壳数据面：invoke ↔ Rust core，事件订阅快照更新。
// 凭证值仅经此直通 native（keyring），不留存在 JS 层。
import { invoke } from "@tauri-apps/api/core";
import type { PlatformBridge } from "./bridgeTypes";
import type { ProviderMeta, ProviderSnapshot } from "../types/provider";
import type { HistorySeries } from "../mock/engine";

export const TauriBridge: PlatformBridge = {
  async listProviders() {
    return invoke<ProviderMeta[]>("list_providers");
  },
  async getSnapshots() {
    return invoke<ProviderSnapshot[]>("get_snapshots");
  },
  async getSnapshot(id) {
    const all = await this.getSnapshots();
    return all.find((s) => s.providerId === id);
  },
  async getHistory() {
    return invoke<HistorySeries[]>("get_history");
  },
  async getQuotaHistory(providerId, days, account) {
    return invoke<HistorySeries[]>("get_quota_history", { providerId, days, account: account ?? null });
  },
  async refreshNow(id) {
    await invoke("refresh_now", { id: id ?? null });
  },
  async setProviderEnabled(id, on) {
    await invoke("set_provider_enabled", { id, enabled: on });
  },
  async connectWithCredential(id, secret, account) {
    return invoke<{ ok: boolean; message?: string }>("connect_with_credential", {
      id,
      secret,
      family: id === "zcode" ? "zai" : null,
      account: account ?? null,
    });
  },
  async markConnected() {
    // mock-only：真实壳无此概念
  },
  async setScenario() {
    // mock-only
  },
};
