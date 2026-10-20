// คัดลอก "ชื่อ + รูปสินค้า" จาก jlc-product-info มาเก็บในรีโปนี้ (โฟลเดอร์ catalog/) ให้คนที่ clone รีโปไปเห็นชื่อและรูปได้
// โดยไม่ต้องมี jlc-product-info
//
// ⚠️ รีโปเป็น Public: คัดเฉพาะฟิลด์ที่อยู่ใน allowlist ด้านล่าง (ชื่อ แบรนด์ สารสกัด ขนาด รูป)
//    ราคา แต้ม สิทธิ์ โน้ตภายใน บาร์โค้ด เลขจดแจ้ง คำเคลม/การตลาด จะไม่ถูกคัดลอก แม้แคตาล็อกจะเพิ่มฟิลด์ใหม่ในอนาคต
//
//   npm run sync-products   →  catalog/catalog.json + catalog/media/** + catalog/extra/*
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseImageName } from "../app/lib/extra-images.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.resolve(process.env.PRODUCT_INFO_DIR || path.join(REPO, "..", "jlc-product-info"));
const OUT = path.join(REPO, "catalog");

const src = JSON.parse(fs.readFileSync(path.join(SOURCE, "data", "build", "catalog.internal.json"), "utf8"));

const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj[k] !== undefined && obj[k] !== "").map((k) => [k, obj[k]]));
const BRAND_KEYS = ["id", "name_th", "name_en", "accent_color", "sort"];
const THEME_KEYS = ["id", "label_th", "label_en", "sort"];
const PRODUCT_KEYS = ["id", "brand_id", "name_th", "name_en", "nickname_th", "themes", "image", "status", "sort"];
const SKU_KEYS = ["sku", "name_full_th", "nickname_th", "variant_label", "size_value", "size_unit", "pack_qty", "image", "status"];

const products = src.products.map((p) => ({ ...pick(p, PRODUCT_KEYS), skus: (p.skus ?? []).map((s) => pick(s, SKU_KEYS)) }));
const slim = {
  _note: "สร้างจาก jlc-product-info ด้วย npm run sync-products — มีแค่ชื่อ แบรนด์ สารสกัด ขนาด และรูป (ไม่มีราคา แต้ม หรือโน้ตภายใน) อย่าแก้ไฟล์นี้เอง",
  generated_at: src.generated_at,
  brands: src.brands.map((b) => pick(b, BRAND_KEYS)),
  lists: { theme: (src.lists?.theme ?? []).map((t) => pick(t, THEME_KEYS)) },
  products,
};

// images referenced by the slim catalog only (no brand KV / presenter photos / e-commerce galleries)
const refs = new Set();
for (const p of products) {
  for (const img of [p.image, ...p.skus.map((s) => s.image)]) if (img) for (const v of Object.values(img)) refs.add(v);
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
let copied = 0;
const missing = [];
for (const rel of refs) {
  // catalog paths look like "media/julas-herb/L3-8G-320.webp" (relative to web/public)
  const from = path.join(SOURCE, "web", "public", rel);
  if (!fs.existsSync(from)) {
    missing.push(rel);
    continue;
  }
  const to = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  copied++;
}
const extras = fs.readdirSync(SOURCE).filter((f) => parseImageName(f));
fs.mkdirSync(path.join(OUT, "extra"), { recursive: true });
for (const f of extras) fs.copyFileSync(path.join(SOURCE, f), path.join(OUT, "extra", f));

fs.writeFileSync(path.join(OUT, "catalog.json"), JSON.stringify(slim, null, 1) + "\n");
console.log(`catalog/catalog.json: ${products.length} สินค้า, ${products.reduce((n, p) => n + p.skus.length, 0)} SKU`);
console.log(`catalog/media: ${copied} รูป${missing.length ? ` (หาไม่เจอ ${missing.length}: ${missing.slice(0, 3).join(", ")}…)` : ""}`);
console.log(`catalog/extra: ${extras.length} รูปเพิ่มเติม`);
