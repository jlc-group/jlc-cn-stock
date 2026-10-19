// ทำไฟล์ zip ครบชุด ส่งให้คนที่จะใช้แดชบอร์ด: แตกไฟล์แล้วดับเบิลคลิก .bat ได้เลย ไม่ต้องโหลดจาก GitHub ไม่ต้องต่อเน็ต
//   CN-Dashboard/
//     เปิด CN Dashboard.bat, app/, data/, package.json …   ← โปรแกรม (ไฟล์เดียวกับในรีโป)
//     node_modules/                                         ← package ที่ใช้ (ไม่ต้อง npm install)
//     คัดงานCN.xlsx                                         ← ข้อมูล CN
//     product-info/                                         ← แคตาล็อก + รูปสินค้า + รูปเพิ่มเติม (จาก jlc-product-info)
//     อ่านก่อน.txt
//
//   npm run bundle   →  bundle/CN-Dashboard-ครบชุด-YYYY-MM-DD.zip
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseImageName } from "../app/lib/extra-images.mjs";
import { zipDirectory } from "./zip.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_INFO = path.resolve(process.env.PRODUCT_INFO_DIR || path.join(REPO, "..", "jlc-product-info"));
const XLSX = path.resolve(process.env.CN_XLSX || path.join(REPO, "คัดงานCN.xlsx"));

const d = new Date();
const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const OUT_DIR = path.join(REPO, "bundle");
const STAGE_ROOT = path.join(OUT_DIR, `stage-${stamp}`);
const APP_DIR = path.join(STAGE_ROOT, "CN-Dashboard"); // the one folder the recipient sees after unzipping
const ZIP = path.join(OUT_DIR, `CN-Dashboard-ครบชุด-${stamp}.zip`);

function need(p, what) {
  if (!fs.existsSync(p)) {
    console.error(`ไม่พบ${what}: ${p}`);
    process.exit(1);
  }
}
need(XLSX, "ไฟล์ CN");
need(path.join(SOURCE_INFO, "data", "build", "catalog.internal.json"), "แคตาล็อกของ jlc-product-info");
need(path.join(REPO, "node_modules", "xlsx"), " node_modules (สั่ง npm install ก่อน)");

fs.rmSync(STAGE_ROOT, { recursive: true, force: true });
fs.rmSync(ZIP, { force: true });
const dest = (...p) => path.join(APP_DIR, ...p);

// 1) program: exactly the files tracked in git (falls back to the known folders when git is unavailable)
const git = spawnSync("git", ["ls-files", "-z"], { cwd: REPO, encoding: "utf8" });
const tracked = git.status === 0 ? git.stdout.split("\0").filter(Boolean) : null;
if (tracked) {
  for (const f of tracked) {
    fs.mkdirSync(path.dirname(dest(f)), { recursive: true });
    fs.copyFileSync(path.join(REPO, f), dest(f));
  }
} else {
  for (const f of ["app", "data", "scripts", ".claude", "package.json", "package-lock.json", "README.md", "วิธีใช้.md", "เปิด CN Dashboard.bat"]) {
    if (fs.existsSync(path.join(REPO, f))) fs.cpSync(path.join(REPO, f), dest(f), { recursive: true });
  }
}
fs.cpSync(path.join(REPO, "node_modules"), dest("node_modules"), { recursive: true });

// 2) data
fs.copyFileSync(XLSX, dest(path.basename(XLSX)));
fs.mkdirSync(dest("product-info", "data", "build"), { recursive: true });
fs.copyFileSync(path.join(SOURCE_INFO, "data", "build", "catalog.internal.json"), dest("product-info", "data", "build", "catalog.internal.json"));
fs.cpSync(path.join(SOURCE_INFO, "web", "public", "media"), dest("product-info", "web", "public", "media"), { recursive: true });
const extras = fs.readdirSync(SOURCE_INFO).filter((f) => parseImageName(f));
for (const f of extras) fs.copyFileSync(path.join(SOURCE_INFO, f), dest("product-info", f));

fs.writeFileSync(
  dest("อ่านก่อน.txt"),
  [
    "CN Dashboard ครบชุด (มีข้อมูลบริษัท ห้ามอัปขึ้น GitHub หรือส่งต่อคนนอก)",
    `สร้างเมื่อ ${d.toLocaleString("th-TH")}`,
    "",
    "วิธีเปิด",
    "1. ติดตั้ง Node.js จาก https://nodejs.org (ครั้งเดียว ถ้าเครื่องมีแล้วข้ามได้)",
    "2. ดับเบิลคลิก \"เปิด CN Dashboard.bat\" ในโฟลเดอร์นี้ เบราว์เซอร์จะเปิดหน้าแดชบอร์ดให้เอง",
    "   (อย่าย้ายไฟล์ออกจากโฟลเดอร์นี้ ทุกอย่างต้องอยู่ด้วยกัน)",
    "",
    "อัปเดตข้อมูลเดือนใหม่: วางไฟล์ คัดงานCN.xlsx ตัวใหม่ทับในโฟลเดอร์นี้ แล้วกดปุ่มรีเฟรชบนหน้าเว็บ",
    "ถ้ารูปไม่ขึ้น: ปิดหน้าต่างสีดำของโปรแกรม แล้วดับเบิลคลิก .bat ใหม่",
    "",
  ].join("\r\n"),
  "utf8",
);

const count = zipDirectory(STAGE_ROOT, ZIP); // UTF-8 names, so Thai file names unzip correctly
fs.rmSync(STAGE_ROOT, { recursive: true, force: true });
const mb = (fs.statSync(ZIP).size / 1024 / 1024).toFixed(1);
console.log(`สร้างแล้ว: ${ZIP} (${mb} MB, ${count} ไฟล์, รูปเพิ่มเติม ${extras.length} รูป)`);
