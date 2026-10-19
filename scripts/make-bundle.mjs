// รวมไฟล์ข้อมูลที่ไม่ได้อยู่ในรีโป เป็นไฟล์ zip เดียว ส่งแยกให้คนที่จะใช้แดชบอร์ด
//   - คัดงานCN.xlsx
//   - product-info/  (เฉพาะส่วนที่แดชบอร์ดใช้จาก jlc-product-info: แคตาล็อก + รูปสินค้า + รูปเพิ่มเติมที่มีรหัสในวงเล็บ)
// คนรับแตก zip ลงในโฟลเดอร์ jlc-cn-stock แล้วดับเบิลคลิก "เปิด CN Dashboard.bat" ได้เลย
//
//   npm run bundle   →  bundle/CN-Dashboard-data-YYYY-MM-DD.zip
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseImageName } from "../app/lib/extra-images.mjs";
import { zipDirectory } from "./zip.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_INFO = path.resolve(process.env.PRODUCT_INFO_DIR || path.join(REPO, "..", "jlc-product-info"));
const XLSX = path.resolve(process.env.CN_XLSX || path.join(REPO, "คัดงานCN.xlsx"));

const d = new Date();
const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const OUT_DIR = path.join(REPO, "bundle");
const NAME = `CN-Dashboard-data-${stamp}`;
const STAGE = path.join(OUT_DIR, NAME);
const ZIP = path.join(OUT_DIR, `${NAME}.zip`);

function need(p, what) {
  if (!fs.existsSync(p)) {
    console.error(`ไม่พบ${what}: ${p}`);
    process.exit(1);
  }
}
need(XLSX, "ไฟล์ CN");
need(path.join(SOURCE_INFO, "data", "build", "catalog.internal.json"), "แคตาล็อกของ jlc-product-info");

fs.rmSync(STAGE, { recursive: true, force: true });
fs.rmSync(ZIP, { force: true });
const dest = (...p) => path.join(STAGE, ...p);
fs.mkdirSync(dest("product-info", "data", "build"), { recursive: true });

fs.copyFileSync(XLSX, dest(path.basename(XLSX)));
fs.copyFileSync(path.join(SOURCE_INFO, "data", "build", "catalog.internal.json"), dest("product-info", "data", "build", "catalog.internal.json"));
fs.cpSync(path.join(SOURCE_INFO, "web", "public", "media"), dest("product-info", "web", "public", "media"), { recursive: true });
const extras = fs.readdirSync(SOURCE_INFO).filter((f) => parseImageName(f));
for (const f of extras) fs.copyFileSync(path.join(SOURCE_INFO, f), dest("product-info", f));

fs.writeFileSync(
  dest("อ่านก่อน.txt"),
  [
    "ไฟล์ข้อมูลสำหรับ CN Dashboard (ข้อมูลบริษัท ห้ามอัปขึ้น GitHub หรือส่งต่อคนนอก)",
    `สร้างเมื่อ ${d.toLocaleString("th-TH")}`,
    "",
    "วิธีใช้",
    "1. ดาวน์โหลดโปรแกรมจาก https://github.com/jlc-group/jlc-cn-stock (ปุ่ม Code > Download ZIP หรือ git clone) แล้วแตกไฟล์",
    "2. คัดลอกทุกอย่างในโฟลเดอร์นี้ ไปวางในโฟลเดอร์ jlc-cn-stock ให้ได้แบบนี้",
    "     jlc-cn-stock\\คัดงานCN.xlsx",
    "     jlc-cn-stock\\product-info\\...",
    "     jlc-cn-stock\\เปิด CN Dashboard.bat",
    "3. ติดตั้ง Node.js จาก https://nodejs.org (ครั้งเดียว)",
    "4. ดับเบิลคลิก \"เปิด CN Dashboard.bat\"",
    "",
    "อัปเดตข้อมูลเดือนใหม่: วางไฟล์ คัดงานCN.xlsx ตัวใหม่ทับ แล้วกดปุ่มรีเฟรชบนหน้าเว็บ",
    "",
  ].join("\r\n"),
  "utf8",
);

zipDirectory(STAGE, ZIP);
const mb = (fs.statSync(ZIP).size / 1024 / 1024).toFixed(1);
console.log(`สร้างแล้ว: ${ZIP} (${mb} MB)`);
console.log(`โฟลเดอร์เดียวกันแบบไม่ zip: ${STAGE}`);
console.log(`รูปเพิ่มเติม ${extras.length} รูป`);
