// 生成开发用最小 ICO（32×32 BGRA，深蓝底白色方块）；发布前替换正式图标。
import { writeFileSync, mkdirSync } from "node:fs";
mkdirSync("src-tauri/icons", { recursive: true });

const W = 32, H = 32;
const px = Buffer.alloc(W * H * 4);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    const inRing = x >= 6 && x < 26 && y >= 6 && y < 26;
    const inHole = x >= 12 && x < 20 && y >= 12 && y < 20;
    // BGRA：深蓝底 + 白色圆环
    if (inRing && !inHole) { px[i] = 0xF2; px[i + 1] = 0xF2; px[i + 2] = 0xF2; px[i + 3] = 0xFF; }
    else { px[i] = 0x8E; px[i + 1] = 0x3B; px[i + 2] = 0x2B; px[i + 3] = 0xFF; }
  }
}
const andMask = Buffer.alloc(W * H / 8); // 不透明
const header = Buffer.alloc(40);
header.writeUInt32LE(40, 0); header.writeInt32LE(W, 4); header.writeInt32LE(H * 2, 8);
header.writeUInt16LE(1, 12); header.writeUInt16LE(32, 14);
const dir = Buffer.alloc(6);
dir.writeUInt16LE(0, 0); dir.writeUInt16LE(1, 2); dir.writeUInt16LE(1, 4);
const imgSize = 40 + px.length + andMask.length;
const entry = Buffer.alloc(16);
entry.writeUInt8(W, 0); entry.writeUInt8(H, 1); entry.writeUInt8(0, 2); entry.writeUInt8(0, 3);
entry.writeUInt16LE(1, 4); entry.writeUInt16LE(32, 6);
entry.writeUInt32LE(imgSize, 8);
entry.writeUInt32LE(6 + 16, 12);
const out = Buffer.concat([dir.subarray(0, 6), entry, header, px, andMask]);
writeFileSync("src-tauri/icons/icon.ico", out);
console.log("icon.ico written:", out.length, "bytes");
