// รูปสินค้าเพิ่มเติมที่วางไว้ในโฟลเดอร์ jlc-product-info แต่ยังไม่ได้เข้าแคตาล็อก
// ตั้งชื่อไฟล์ให้มีรหัสในวงเล็บ เช่น "เซรั่มขิงดำ - หลอด (JH707-40g).jpg" หรือ "เจลดาวเรือง - ซอง (JHK1).jpg"
// - มีขนาดในวงเล็บ → ใช้กับ SKU ขนาดนั้น
// - ไม่มีขนาด แต่ชื่อมีคำว่า "ซอง" → ใช้กับ SKU ขนาดเล็กสุดของรหัสนั้น · "หลอด"/"ขวด"/"กระปุก" → ใช้กับขนาดที่ใหญ่กว่า
// - ไม่มีทั้งสองอย่าง → ใช้กับทุกขนาดของรหัสนั้น
// - ต่อท้าย x6 ได้ (กล่อง 6 ซอง) เช่น "(JH707x6)" หรือ "(JH708-6Gx6)" ใช้กับ SKU ซองเดี่ยว
// - ถ้ามีทั้งรูปซองเดี่ยวและรูปกล่อง (ชื่อมี "กล่อง" หรือ x6) จะใช้รูปซองเดี่ยวก่อน
// รูปในแคตาล็อกมาก่อนเสมอ รูปเหล่านี้ใช้เติมเฉพาะ SKU ที่ยังไม่มีรูป
import fs from "node:fs";
import { keyOf, splitSku } from "./match-catalog.mjs";

const IMAGE_RE = /\.(jpe?g|png|webp)$/i;

/** "เซรั่มขิงดำ - หลอด (JH707-40g).jpg" → { code: "JH707", size: {40,g}, kind: "tube" } */
export function parseImageName(file) {
  if (!IMAGE_RE.test(file)) return null;
  const m = /\(([A-Za-z]+[A-Za-z0-9]*(?:-[0-9.]+\s*(?:g|ml))?(?:x\d+)?)\)[^()]*$/i.exec(file);
  if (!m) return null;
  // "(JH707x6)" / "(JH708-6Gx6)" = box of 6: the photo still shows the single sachet, so drop the pack count
  const { code, size } = splitSku(m[1].replace(/\s+/g, "").replace(/x\d+$/i, ""));
  const kind = /ซอง/.test(file) ? "sachet" : /หลอด|ขวด|กระปุก/.test(file) ? "big" : "any";
  const box = /กล่อง/.test(file) || /x\d+$/i.test(m[1]); // box / pack photo: used only when there is no single-piece photo
  return { file, code, size, kind, box };
}

/**
 * Scan `dir` (not recursive) and assign images to catalog SKUs that have none.
 * @returns {{ bySku: Map<string, {sm,lg}>, byProduct: Map<string, {sm,lg}> }}
 */
export function scanExtraImages(dir, index) {
  const bySku = new Map();
  const byProduct = new Map();
  let files = [];
  try {
    files = fs.readdirSync(dir);
  } catch {
    return { bySku, byProduct };
  }
  const found = files.map(parseImageName).filter(Boolean);
  // explicit size first, then sachet/tube hints, then generic; within each, a single-piece photo beats a box photo
  const rank = (f) => (f.size ? 0 : f.kind !== "any" ? 1 : 2) * 2 + (f.box ? 1 : 0);
  found.sort((a, b) => rank(a) - rank(b));
  for (const f of found) {
    const family = (index.byCode.get(keyOf(f.code)) ?? []).filter((e) => e.pack === 1 && e.size);
    if (!family.length) continue;
    const smallest = Math.min(...family.map((e) => e.size.value));
    const targets = family.filter((e) =>
      f.size ? e.size.unit === f.size.unit && e.size.value === f.size.value : f.kind === "sachet" ? e.size.value === smallest : f.kind === "big" ? e.size.value > smallest : true,
    );
    const src = "extra/" + encodeURIComponent(f.file);
    const img = { sm: src, lg: src };
    for (const e of targets) {
      if (e.sku.image || bySku.has(e.sku.sku)) continue;
      bySku.set(e.sku.sku, img);
    }
    const pid = family[0].product.id;
    if (!byProduct.has(pid) && !family[0].product.image) byProduct.set(pid, img);
  }
  return { bySku, byProduct };
}
