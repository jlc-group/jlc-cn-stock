// รวมข้อมูลจากไฟล์ CN + แคตาล็อก เป็น JSON ชุดเดียวที่หน้าแดชบอร์ดใช้ (GET /api/data)
import fs from "node:fs";
import path from "node:path";
import { GRADES, readCnFile } from "./parse-cn.mjs";
import { buildIndex, bestByName, imageOf, keyOf, loadCatalog, loadSkuMap, matchRow, nameMismatch, sizeOf, splitSku } from "./match-catalog.mjs";
import { scanExtraImages } from "./extra-images.mjs";

const NO_FAMILY = { id: "-", label: "ไม่ทราบสารสกัด", labelEn: "", sort: 10000 };

/** data/extracts.json: { merge: { gluta: "red-orange" }, labels: { "red-orange": "ส้มแดง / กลูต้า" } } */
function loadExtracts(file) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    return { merge: raw.merge ?? {}, labels: raw.labels ?? {} };
  } catch {
    return { merge: {}, labels: {} };
  }
}

const withSize = (name, size) => (size ? `${name} ${size.value} ${size.unit === "ml" ? "มล." : size.unit === "c" ? "แคปซูล" : "กรัม"}` : name);

const MATCH_LABEL = {
  map: "จับคู่จาก sku-map.json",
  exact: "SKU ตรงกับแคตาล็อก",
  size: "จับคู่จากรหัสหลัก + ขนาด",
  product: "รหัสตรงกับสินค้าในแคตาล็อก แต่ไม่มีขนาดนี้",
  none: "จับคู่ไม่ได้",
};

/**
 * @param {{ xlsx: string, catalogFile: string, skuMapFile: string, extraImageDir?: string, extractsFile?: string }} paths
 */
export function buildData({ xlsx, catalogFile, skuMapFile, extraImageDir, extractsFile }) {
  const parsed = readCnFile(xlsx);
  const catalog = loadCatalog(catalogFile);
  const index = buildIndex(catalog);
  const skuMap = loadSkuMap(skuMapFile);
  const extra = extraImageDir ? scanExtraImages(extraImageDir, index) : { bySku: new Map(), byProduct: new Map() };
  // catalog SKU image → extra photo for that SKU → catalog product image → extra photo for that product
  const skuImage = (sku) => sku?.image ?? (sku && extra.bySku.get(sku.sku)) ?? null;
  // Product-level match (size not in catalog, e.g. JHK1-6G): use the photo of the catalog SKU closest in size,
  // so a 6G sachet shows the sachet photo, not the 40G tube.
  const nearestImage = (product, size) => {
    if (!product || !size) return null;
    const near = (product.skus ?? [])
      .map((s) => ({ s, sz: splitSku(s.sku) }))
      .filter((x) => x.sz.pack === 1 && x.sz.size && x.sz.size.unit === size.unit && skuImage(x.s))
      .sort((a, b) => Math.abs(a.sz.size.value - size.value) - Math.abs(b.sz.size.value - size.value))[0];
    return near ? skuImage(near.s) : null;
  };
  const pickImage = (product, sku, size) =>
    skuImage(sku) ?? (sku ? null : nearestImage(product, size)) ?? imageOf(product, null) ?? (product && extra.byProduct.get(product.id)) ?? null;
  const issues = [...parsed.issues];
  // Extract (สารสกัด) = the product's first theme in the catalog, counted once so extract totals add up.
  // data/extracts.json can merge themes that are one extract (gluta → red-orange) and rename them.
  const themes = new Map(catalog.themes.map((t) => [t.id, t]));
  const extracts = extractsFile ? loadExtracts(extractsFile) : { merge: {}, labels: {} };
  const familyOf = (product) => {
    let id = product?.themes?.[0];
    if (!id) return NO_FAMILY;
    for (let i = 0; i < 5 && extracts.merge[id]; i++) id = extracts.merge[id];
    const t = themes.get(id);
    return { id, label: extracts.labels[id] ?? t?.label_th ?? id, labelEn: t?.label_en ?? "", sort: t?.sort ?? 999 };
  };
  const items = {};
  const rows = [];

  for (const r of parsed.rows) {
    if (!r.sku) continue;
    const m = matchRow(r, index, skuMap);
    // One dashboard item per catalog SKU; product-level matches keep the size typed in Excel apart.
    const sku = m.alias ?? r.sku; // sku-map can redirect a typo to another code, e.g. JH1-MO4 → JHK1-6G
    const itemKey = m.sku ? m.sku.sku : m.product ? `${m.product.id}|${sku}` : `raw|${keyOf(sku)}`;
    if (!items[itemKey]) {
      const brand = m.product ? index.brands.get(m.product.brand_id) : null;
      items[itemKey] = {
        key: itemKey,
        sku: m.sku?.sku ?? sku,
        // The brand is shown next to the name, so drop the "จุฬาเฮิร์บ " prefix most catalog names carry.
        // The code decides the name: a size missing from the catalog (JHK1-6G) still shows its size, so it never looks
        // like the same card as JHK1-8G.
        // sku-map "name" wins: the team's confirmed name when the catalog name is wrong for that code
        name: (m.name || m.sku?.name_full_th || (m.product ? withSize(m.product.name_th, splitSku(sku).size) : "") || r.nameRaw || sku).replace(/^จุฬาเฮิร์บ\s*/, ""),
        productName: m.product?.name_th ?? "",
        nameEn: m.product?.name_en ?? "",
        nickname: m.product?.nickname_th ?? "",
        productId: m.product?.id ?? "",
        brandId: brand?.id ?? "",
        brandName: brand?.name_en ?? (m.product ? m.product.brand_id : "ไม่ทราบแบรนด์"),
        brandColor: brand?.accent_color ?? "",
        familyId: familyOf(m.product).id,
        image: pickImage(m.product, m.sku, splitSku(sku).size ?? sizeOf(r.nameRaw)),
        match: m.type,
        matchLabel: MATCH_LABEL[m.type],
        rawSkus: [],
        rawNames: [],
      };
    }
    const it = items[itemKey];
    if (!it.rawSkus.includes(r.skuRaw.trim())) it.rawSkus.push(r.skuRaw.trim());
    if (r.nameRaw && !it.rawNames.includes(r.nameRaw)) it.rawNames.push(r.nameRaw);
    if (r.note && !it.rawNames.includes(r.note)) it.rawNames.push(r.note); // so search finds "ไม่มีกล่อง"

    const base = { sheet: r.sheet, row: r.sheetRow, skuRaw: r.skuRaw.trim(), nameRaw: r.nameRaw, itemKey };
    if (m.type === "none") {
      const guess = r.nameRaw ? bestByName(r.nameRaw, index) : null;
      issues.push({
        ...base,
        type: "unmatched",
        message: "SKU นี้ไม่มีในแคตาล็อก",
        suggestion: guess && guess.score >= 0.55 ? `ชื่อใกล้กับ "${guess.product.name_th}" (${guess.product.skus.map((s) => s.sku).join(", ")})` : "",
      });
    } else {
      if (m.type === "product") issues.push({ ...base, type: "size", message: m.note });
      // a code someone confirmed in sku-map is trusted as is
      const mm = m.manual ? null : nameMismatch(r, m.product, index);
      if (mm) {
        issues.push({
          ...base,
          type: "name-mismatch",
          message: `SKU ชี้ไปที่ "${m.product.name_th}" แต่ชื่อในไฟล์ใกล้กับ "${mm.other.name_th}" มากกว่า`,
          suggestion: `รหัสของสินค้านั้น: ${mm.other.skus.map((s) => s.sku).join(", ")}`,
        });
      }
    }
    rows.push({
      month: r.month,
      sheet: r.sheet,
      row: r.sheetRow,
      date: r.date,
      dateRaw: r.dateRaw,
      skuRaw: r.skuRaw.trim(),
      skuUsed: it.sku, // the code the dashboard counts this row under (shown next to the Excel code)
      decidedBy: m.manual ? "map" : m.type, // "map" = set by hand in data/sku-map.json
      mapNote: m.manual ? m.note : "",
      suffix: r.suffix,
      nameRaw: r.nameRaw,
      note: r.note,
      location: r.location,
      itemKey,
      qty: r.qty,
      total: r.total,
    });
  }

  const stat = fs.statSync(xlsx);
  return {
    generatedAt: new Date().toISOString(),
    source: { file: path.basename(xlsx), modifiedAt: stat.mtime.toISOString() },
    catalog: catalog.ok
      ? { ok: true, generatedAt: catalog.generatedAt, products: catalog.products.length }
      : { ok: false, file: catalogFile, error: catalog.error },
    grades: GRADES,
    months: parsed.months,
    locations: [...new Set(rows.map((r) => r.location).filter(Boolean))],
    families: [...new Map(Object.values(items).map((i) => [i.familyId, i.familyId === "-" ? NO_FAMILY : familyOf({ themes: [i.familyId] })])).values()].sort((a, b) => a.sort - b.sort),
    brands: [...new Map(Object.values(items).map((i) => [i.brandId || "-", { id: i.brandId || "-", name: i.brandName, color: i.brandColor }])).values()],
    items,
    rows,
    issues,
  };
}
