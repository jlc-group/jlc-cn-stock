// ทำไฟล์ zip ครบชุด ส่งให้คนที่จะใช้แดชบอร์ด: แตกไฟล์แล้วดับเบิลคลิก .bat ได้เลย ไม่ต้องโหลดจาก GitHub ไม่ต้องต่อเน็ต
//   CN-Dashboard/
//     เปิด CN Dashboard.bat, start-linux.sh, อ่านก่อน.txt   ← สิ่งที่ผู้ใช้ต้องเห็น
//     คัดงานCN.xlsx                                         ← ข้อมูล CN
//     app/, data/, package.json                             ← โปรแกรม (ไม่มีไฟล์ทดสอบ / สคริปต์นักพัฒนา / README)
//     catalog/, photos/                                     ← ชื่อ + รูปสินค้า
//     node_modules/                                         ← เฉพาะไฟล์ที่ใช้ตอนรันจริง (ไม่ต้อง npm install)
// สร้างใหม่ทุกครั้งจะลบ zip เก่าในโฟลเดอร์ bundle/ ให้เอง
//
//   npm run bundle   →  bundle/CN-Dashboard-YYYY-MM-DD.zip
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { zipDirectory } from "./zip.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const XLSX = path.resolve(process.env.CN_XLSX || path.join(REPO, "คัดงานCN.xlsx"));

const d = new Date();
const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const OUT_DIR = path.join(REPO, "bundle");
const STAGE_ROOT = path.join(OUT_DIR, `stage-${stamp}`);
const APP_DIR = path.join(STAGE_ROOT, "CN-Dashboard"); // the one folder the recipient sees after unzipping
// English-only name: easy to type on Linux, and safe to delete on every system
const ZIP = path.join(OUT_DIR, `CN-Dashboard-${stamp}.zip`);

function need(p, what) {
  if (!fs.existsSync(p)) {
    console.error(`ไม่พบ${what}: ${p}`);
    process.exit(1);
  }
}
need(XLSX, "ไฟล์ CN");
need(path.join(REPO, "catalog", "catalog.json"), "ชื่อและรูปสินค้า (สั่ง npm run sync-products ก่อน)");
need(path.join(REPO, "node_modules", "xlsx"), " node_modules (สั่ง npm install ก่อน)");

// keep only the newest bundle: remove earlier zips and leftover staging folders
fs.mkdirSync(OUT_DIR, { recursive: true });
for (const f of fs.readdirSync(OUT_DIR)) {
  if (/^CN-Dashboard-.*\.zip$/.test(f) || f.startsWith("stage-")) fs.rmSync(path.join(OUT_DIR, f), { recursive: true, force: true });
}
const dest = (...p) => path.join(APP_DIR, ...p);

// 1) program: the files tracked in git, minus what only developers need
const DEV_ONLY = /^(\.claude\/|scripts\/|\.git|README\.md$|วิธีใช้\.md$|package-lock\.json$)|\.test\.mjs$/;
const git = spawnSync("git", ["ls-files", "-z"], { cwd: REPO, encoding: "utf8" });
const tracked = git.status === 0 ? git.stdout.split("\0").filter((f) => f && !DEV_ONLY.test(f)) : null;
if (tracked) {
  for (const f of tracked) {
    fs.mkdirSync(path.dirname(dest(f)), { recursive: true });
    fs.copyFileSync(path.join(REPO, f), dest(f));
  }
} else {
  for (const f of ["app", "data", "package.json", "เปิด CN Dashboard.bat", "start-linux.sh"]) {
    if (fs.existsSync(path.join(REPO, f))) fs.cpSync(path.join(REPO, f), dest(f), { recursive: true, filter: (p) => !p.endsWith(".test.mjs") });
  }
}
// also when not committed yet
fs.cpSync(path.join(REPO, "catalog"), dest("catalog"), { recursive: true });
if (fs.existsSync(path.join(REPO, "photos"))) fs.cpSync(path.join(REPO, "photos"), dest("photos"), { recursive: true });

// node_modules: only what runs. xlsx.js loads just dist/cpexcel.js; the page uses font weights 400/600/700.
const runtimeFiles = ["xlsx/package.json", "xlsx/xlsx.js", "xlsx/dist/cpexcel.js", "xlsx/LICENSE"];
for (const fam of ["sarabun", "inter"]) {
  runtimeFiles.push(`@fontsource/${fam}/LICENSE`);
  for (const w of [400, 600, 700]) {
    runtimeFiles.push(`@fontsource/${fam}/${w}.css`);
    for (const f of fs.readdirSync(path.join(REPO, "node_modules", "@fontsource", fam, "files"))) {
      if (f.endsWith(`-${w}-normal.woff2`)) runtimeFiles.push(`@fontsource/${fam}/files/${f}`);
    }
  }
}
for (const f of runtimeFiles) {
  const from = path.join(REPO, "node_modules", f);
  if (!fs.existsSync(from)) continue;
  fs.mkdirSync(path.dirname(dest("node_modules", f)), { recursive: true });
  fs.copyFileSync(from, dest("node_modules", f));
}

// 2) data
fs.copyFileSync(XLSX, dest(path.basename(XLSX)));

fs.writeFileSync(
  dest("อ่านก่อน.txt"),
  [
    "CN Dashboard ครบชุด (มีข้อมูลบริษัท ห้ามอัปขึ้น GitHub หรือส่งต่อคนนอก)",
    `สร้างเมื่อ ${d.toLocaleString("th-TH")}`,
    "",
    "วิธีเปิด",
    "1. ติดตั้ง Node.js จาก https://nodejs.org (ครั้งเดียว ถ้าเครื่องมีแล้วข้ามได้)",
    "2. Windows: ดับเบิลคลิก \"เปิด CN Dashboard.bat\" ในโฟลเดอร์นี้ เบราว์เซอร์จะเปิดหน้าแดชบอร์ดให้เอง",
    "   Linux / macOS: เปิด Terminal ในโฟลเดอร์นี้ แล้วพิมพ์  bash start-linux.sh",
    "   แล้วเปิด http://localhost:5230 ในเบราว์เซอร์ (ถ้าเบราว์เซอร์ไม่เปิดเอง)",
    "   (อย่าย้ายไฟล์ออกจากโฟลเดอร์นี้ ทุกอย่างต้องอยู่ด้วยกัน)",
    "",
    "อัปเดตข้อมูลเดือนใหม่: วางไฟล์ คัดงานCN.xlsx ตัวใหม่ทับในโฟลเดอร์นี้ แล้วกดปุ่มรีเฟรชบนหน้าเว็บ",
    "ถ้ารูปไม่ขึ้น: ปิดหน้าต่างโปรแกรม (หน้าต่างสีดำ / Terminal) แล้วเปิดใหม่",
    "",
  ].join("\r\n"),
  "utf8",
);

const count = zipDirectory(STAGE_ROOT, ZIP); // UTF-8 names, so Thai file names unzip correctly
fs.rmSync(STAGE_ROOT, { recursive: true, force: true });
const mb = (fs.statSync(ZIP).size / 1024 / 1024).toFixed(1);
console.log(`สร้างแล้ว: ${ZIP} (${mb} MB, ${count} ไฟล์)`);
