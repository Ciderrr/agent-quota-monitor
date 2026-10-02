import { isTauri } from "./shell";
import { MockBridge } from "./mockBridge";
import { TauriBridge } from "./tauriBridge";

export { isTauri };
export type { PlatformBridge } from "./bridgeTypes";
export const bridge = isTauri ? TauriBridge : MockBridge;
