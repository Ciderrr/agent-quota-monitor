// 发布辅助：为 GitHub Release 生成 updater 清单 latest.json。
// 用法: node scripts/gen-latest-json.mjs ["release notes"]
// 依据 tauri.conf.json 的版本号与 nsis 产物的 .sig 签名文件，生成 Tauri updater
// 静态清单（assets 需与安装包一同上传到 GitHub Release）。
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const conf = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
const v = conf.version;
const exeName = `Agent.Quota.Monitor_${v}_x64-setup.exe`; // 资产命名（点号风格）
const localSig = `src-tauri/target/release/bundle/nsis/Agent Quota Monitor_${v}_x64-setup.exe.sig`;
if (!existsSync(localSig)) {
  console.error(`missing signature: ${localSig}\n先执行带签名的构建: TAURI_SIGNING_PRIVATE_KEY=... npm run tauri build`);
  process.exit(1);
}
const sig = readFileSync(localSig, "utf8").trim();
const url = `https://github.com/Ciderrr/agent-quota-monitor/releases/download/v${v}/${exeName}`;
const manifest = {
  version: v,
  notes: process.argv[2] || `Agent Quota Monitor v${v}`,
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": { signature: sig, url },
  },
};
writeFileSync("latest.json", JSON.stringify(manifest, null, 2) + "\n");
console.log(`wrote latest.json (v${v}, ${url})`);
