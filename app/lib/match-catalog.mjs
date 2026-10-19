// จับคู่ SKU ในไฟล์ CN กับแคตาล็อกของ jlc-product-info (data/build/catalog.internal.json) — อ่านอย่างเดียว
// ลำดับ: sku-map.json (แก้ด้วยมือ) → SKU ตรงกัน → รหัสหลัก+ขนาด → รหัสหลักอย่างเดียว (ระดับสินค้า) → จับไม่ได้
import fs from "node:fs";

/** Comparison key: upper-case letters, digits and dots only. "L9-8G" → "L98G", " t5a-2.5g" → "T5A2.5G". */
export const keyOf = (s) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9.]/g, "");

const SIZE_RE = /(\d+(?:\.\d+)?)\s*(G|GM|กรัม|ML|มล\.?|C)\b/gi;

/** "8G" / "วอเตอร์เมลอน 30 กรัม" → { value: 30, unit: "g" }. Takes the last size in the text. */
export function sizeOf(textValue) {
  const t = String(textValue ?? "");
  let last = null;
  for (const m of t.matchAll(SIZE_RE)) last = m;
  if (!last) {
    // Thai unit right after a number has no word boundary: "40กรัม"
    const th = /(\d+(?:\.\d+)?)\s*(กรัม|มล)/.exec(t);
    if (!th) return null;
    last = th;
  }
  const u = last[2].toUpperCase();
  const unit = u === "ML" || u.startsWith("มล") ? "ml" : u === "C" ? "c" : "g";
  return { value: Number(last[1]), unit };
}

/** "L9-8G" → { code: "L9", size: {8,g} } · "JHK6" → { code: "JHK6", size: null } · "TB-JHM1-120G" → { code: "TB-JHM1", ... } */
export function splitSku(sku) {
  const s = String(sku ?? "").toUpperCase();
  const m = /^(.*?)-(\d+(?:\.\d+)?)(G|ML|C)(X\d+)?$/.exec(s);
  if (m) return { code: m[1], size: { value: Number(m[2]), unit: m[3] === "ML" ? "ml" : m[3] === "C" ? "c" : "g" }, pack: m[4] ? Number(m[4].slice(1)) : 1 };
  return { code: s, size: null, pack: 1 };
}

const sameSize = (a, b) => a && b && a.unit === b.unit && Math.abs(a.value - b.value) < 1e-9;

// ---- name similarity (character bigrams; Thai names are spelled inconsistently, e.g. วอเตอร์ / วอร์เตอร์) ----
const normName = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/จุฬาเฮิร์บ|julas?'?s? herb/g, "")
    .replace(/(\d+(?:\.\d+)?)\s*(g|gm|กรัม|ml|มล\.?)/g, "")
    .replace(/spf\s*\d+\+?|pa\+*|เอสพีเอฟ\s*\d+\+?/g, "")
    .replace(/[\s\-–&+().,/]/g, "");
function bigrams(s) {
  const out = new Map();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
}
/** Dice coefficient on character bigrams, 0..1. */
export function similarity(a, b) {
  const x = normName(a);
  const y = normName(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const A = bigrams(x);
  const B = bigrams(y);
  let hit = 0;
  for (const [g, n] of A) hit += Math.min(n, B.get(g) ?? 0);
  const total = x.length - 1 + (y.length - 1);
  return total > 0 ? (2 * hit) / total : 0;
}
const productNames = (p) => [p.name_th, p.nickname_th, ...(p.skus ?? []).flatMap((s) => [s.name_full_th, s.nickname_th])].filter(Boolean);
const nameScore = (name, p) => Math.max(0, ...productNames(p).map((n) => similarity(name, n)));

/**
 * Load the catalog. Never throws: a missing catalog gives { ok: false } and the dashboard falls back to Excel names.
 */
export function loadCatalog(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return { ok: true, file, generatedAt: data.generated_at ?? "", brands: data.brands ?? [], products: data.products ?? [], themes: data.lists?.theme ?? [] };
  } catch (e) {
    return { ok: false, file, error: e.code === "ENOENT" ? "ไม่พบไฟล์แคตาล็อก" : String(e.message ?? e), brands: [], products: [], themes: [] };
  }
}

export function loadSkuMap(file) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    const map = new Map();
    for (const [k, v] of Object.entries(raw.map ?? raw)) {
      if (k.startsWith("_")) continue;
      map.set(keyOf(k), typeof v === "string" ? { sku: v } : v);
    }
    return map;
  } catch {
    return new Map();
  }
}

/** Build lookup tables once per catalog. */
export function buildIndex(catalog) {
  const bySku = new Map(); // keyOf(sku) → { product, sku }
  const byCode = new Map(); // keyOf(code) → [{ product, sku, size, pack }]
  const brands = new Map(catalog.brands.map((b) => [b.id, b]));
  for (const product of catalog.products) {
    for (const sku of product.skus ?? []) {
      const entry = { product, sku, ...splitSku(sku.sku) };
      bySku.set(keyOf(sku.sku), entry);
      const codes = new Set([entry.code]);
      if (entry.code.includes("-")) codes.add(entry.code.split("-").pop()); // TB-JHM1 → JHM1
      for (const c of codes) {
        const k = keyOf(c);
        if (!byCode.has(k)) byCode.set(k, []);
        byCode.get(k).push(entry);
      }
    }
  }
  return { bySku, byCode, brands, products: catalog.products };
}

/**
 * Match one cleaned row ({ sku, skuRaw, nameRaw }) to the catalog.
 * @returns {{ type: "map"|"exact"|"size"|"product"|"none", product?, sku?, note?: string }}
 */
export function matchRow(row, index, skuMap = new Map()) {
  const full = keyOf(row.skuRaw);
  const base = keyOf(row.sku);
  const manual = skuMap.get(full) ?? skuMap.get(base);
  if (manual) {
    const hit = index.bySku.get(keyOf(manual.sku));
    if (hit) return { type: "map", product: hit.product, sku: hit.sku, note: manual.note ?? "" };
  }
  const exact = index.bySku.get(base);
  if (exact) return { type: "exact", product: exact.product, sku: exact.sku };

  const { code, size: skuSize } = splitSku(row.sku);
  const size = skuSize ?? sizeOf(row.nameRaw);
  const family = index.byCode.get(keyOf(code)) ?? [];
  if (size) {
    const hit = family.find((e) => e.pack === 1 && sameSize(e.size, size));
    if (hit) return { type: "size", product: hit.product, sku: hit.sku };
  }
  const products = [...new Set(family.map((e) => e.product))];
  if (products.length === 1) {
    const sizeTxt = size ? `${size.value}${size.unit === "ml" ? "ML" : "G"}` : "";
    return {
      type: "product",
      product: products[0],
      sku: null,
      note: sizeTxt ? `ขนาด ${sizeTxt} ไม่มีในแคตาล็อก (มี ${family.filter((e) => e.pack === 1).map((e) => e.sku.sku).join(", ")})` : "ไม่ระบุขนาด",
    };
  }
  return { type: "none" };
}

/** Best catalog product for a name, for "อาจเป็น…" hints and SKU/name mismatch checks. */
export function bestByName(name, index) {
  let best = null;
  for (const p of index.products) {
    const score = nameScore(name, p);
    if (!best || score > best.score) best = { product: p, score };
  }
  return best;
}

/**
 * Flag when the Excel name clearly belongs to another product than the one its SKU points to.
 * SKU still wins for grouping; this only raises a check for the team.
 */
export function nameMismatch(row, product, index) {
  if (!row.nameRaw || !product) return null;
  const own = nameScore(row.nameRaw, product);
  const best = bestByName(row.nameRaw, index);
  if (best && best.product !== product && best.score >= 0.6 && best.score - own >= 0.15) {
    return { own, other: best.product, otherScore: best.score };
  }
  return null;
}

/** Image for a match: SKU image first, then the product image. Paths are relative to product-info web/public. */
export const imageOf = (product, sku) => sku?.image ?? product?.image ?? null;
