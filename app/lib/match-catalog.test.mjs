import { test } from "node:test";
import assert from "node:assert/strict";
import { buildIndex, matchRow, nameMismatch, sizeOf, splitSku } from "./match-catalog.mjs";

const catalog = {
  brands: [{ id: "julas-herb", name_en: "Jula's Herb" }],
  products: [
    { id: "ee", brand_id: "julas-herb", name_th: "วอเตอร์เมลอน อีอี คูชั่น", skus: [{ sku: "L8A-6G" }, { sku: "L8A-6Gx6" }] },
    { id: "melon", brand_id: "julas-herb", name_th: "เมลอน มิลก์ ยูวี เอสเซนส์", skus: [{ sku: "C3-7G" }, { sku: "JHK6-7G" }, { sku: "C3-30G" }] },
    { id: "moringa", brand_id: "julas-herb", name_th: "มอรินก้า คอมพลีต รีแพร์ เซรั่ม", skus: [{ sku: "C2-8G" }, { sku: "C2-35G" }] },
    { id: "men", brand_id: "julas-herb", name_th: "แบล็ค จิงเจอร์ ออล อิน วัน เมน เซรั่ม", skus: [{ sku: "JH707-8G" }] },
    { id: "pore", brand_id: "julas-herb", name_th: "แบล็ก จิงเจอร์ พอร์เลส แอนด์ ออยล์ เคลียร์ เซรั่ม", skus: [{ sku: "C4-8G" }] },
    { id: "mahad", brand_id: "julas-herb", name_th: "มะหาด บอดี้ เซรั่ม", skus: [{ sku: "TB-JHM1-120G" }] },
  ],
};
const index = buildIndex(catalog);

test("sizeOf and splitSku", () => {
  assert.deepEqual(sizeOf("เมลอน 7G "), { value: 7, unit: "g" });
  assert.deepEqual(sizeOf("ซันฟลาวเวอร์ 30กรัม"), { value: 30, unit: "g" });
  assert.deepEqual(sizeOf("โลชั่นมะหาด 120 ML"), { value: 120, unit: "ml" });
  assert.equal(sizeOf("ไม่มีขนาด"), null);
  assert.deepEqual(splitSku("L8A-6Gx6"), { code: "L8A", size: { value: 6, unit: "g" }, pack: 6 });
  assert.deepEqual(splitSku("JHK6"), { code: "JHK6", size: null, pack: 1 });
});

test("exact SKU match", () => {
  const m = matchRow({ sku: "L8A-6G", skuRaw: " L8A-6G", nameRaw: "" }, index);
  assert.equal(m.type, "exact");
  assert.equal(m.sku.sku, "L8A-6G");
});

test("code + size from the Excel name", () => {
  const m = matchRow({ sku: "JHK6", skuRaw: "JHK6-MO1", nameRaw: "เมลอน มิลก์ ยูวี เอสเซนส์ 7G" }, index);
  assert.equal(m.type, "size");
  assert.equal(m.sku.sku, "JHK6-7G");
});

test("size not in catalog falls back to product level", () => {
  const m = matchRow({ sku: "C2-40G", skuRaw: "C2-40G", nameRaw: "มอรินก้า 40G" }, index);
  assert.equal(m.type, "product");
  assert.equal(m.product.id, "moringa");
  assert.match(m.note, /40G/);
});

test("sku-map wins over everything", () => {
  const map = new Map([["JHM1MO1", { sku: "TB-JHM1-120G" }]]);
  const m = matchRow({ sku: "JHM1", skuRaw: "JHM1-MO1", nameRaw: "โลชั่นมะหาด 120 ML" }, index, map);
  assert.equal(m.type, "map");
  assert.equal(m.sku.sku, "TB-JHM1-120G");
});

test("unknown code is unmatched", () => {
  assert.equal(matchRow({ sku: "JH05", skuRaw: "JH05-MO1", nameRaw: "แมงโก้ 8G" }, index).type, "none");
});

test("name pointing at another product is flagged", () => {
  const row = { nameRaw: "แบล็ค จิงเจอร์ พอร์เลส&ออยล์ เคลียร์ เซรั่ม 8g" };
  const men = catalog.products.find((p) => p.id === "men");
  assert.equal(nameMismatch(row, men, index)?.other.id, "pore");
  const pore = catalog.products.find((p) => p.id === "pore");
  assert.equal(nameMismatch(row, pore, index), null);
});

test("sku-map can redirect to a size the catalog does not list", () => {
  const map = new Map([["JH1MO4", { sku: "C2-40G" }]]);
  const m = matchRow({ sku: "JH1", skuRaw: "JH1-MO4", nameRaw: "มอรินก้า 6G" }, index, map);
  assert.equal(m.type, "product");
  assert.equal(m.product.id, "moringa");
  assert.equal(m.alias, "C2-40G");
});

test("sku-map can give a code its confirmed display name", () => {
  const map = new Map([["C28G", { sku: "C2-8G", name: "ชื่อที่ทีมยืนยัน", note: "เหตุผล" }]]);
  const m = matchRow({ sku: "C2-8G", skuRaw: "C2-8G", nameRaw: "" }, index, map);
  assert.equal(m.name, "ชื่อที่ทีมยืนยัน");
  assert.equal(m.sku.sku, "C2-8G");
});
