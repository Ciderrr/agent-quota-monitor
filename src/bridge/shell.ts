// 运行环境检测：Tauri（真实壳）vs 浏览器（Gate C 原型）
export const isTauri: boolean = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
