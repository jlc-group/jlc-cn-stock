import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildIndex } from "./match-catalog.mjs";
import { parseImageName, scanExtraImages } from "./extra-images.mjs";

test("parseImageName reads the code in brackets", () => {
  assert.deepEqual(parseImageName("เซรั่มขิงดำ - หลอด (JH707-40g).jpg"), { file: "เซรั่มขิงดำ - หลอด (JH707-40g).jpg", code: "JH707", size: { value: 40, unit: "g" }, kind: "big", box: false });
  assert.equal(parseImageName("เจลดาวเรือง - ซอง (JHK1).jpg").kind, "sachet");
  assert.equal(parseImageName("เจลดาวเรือง - ซอง (JHK1).jpg").size, null);
  assert.equal(parseImageName("เซรั่มขิงดำ - กล่องซอง (JH707x6).jpg").code, "JH707");
  assert.deepEqual(parseImageName("อีอีคูชั่นแตงโม - กล่องซอง (JH708-6Gx6).jpg").size, { value: 6, unit: "g" });
  assert.equal(parseImageName("โลชั่นมะมหาด - หลอด (JHM1-120G).jpg").code, "JHM1");
  assert.equal(parseImageName("mango-yogurt-serum-1-xZcFqsQaL.jpg"), null);
  assert.equal(parseImageName("OIP.webp"), null);
  assert.equal(parseImageName("Unconfirmed 274619.crdownload"), null);
});

test("single-piece photo beats the box photo", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cn-img-"));
  for (const f of ["อีอี - กล่องซอง (JH708-6Gx6).jpg", "อีอี - ซอง (JH708-6G).jpg", "ขิงดำ - กล่องซอง (JH707x6).jpg", "ขิงดำ - ซอง (JH707).jpg", "มะม่วง - กล่องซอง (JH705x6).jpg"]) fs.writeFileSync(path.join(dir, f), "");
  const index = buildIndex({ brands: [], products: [{ id: "ee", skus: [{ sku: "JH708-6G" }] }, { id: "men", skus: [{ sku: "JH707-8G" }, { sku: "JH707-40G" }] }, { id: "mango", skus: [{ sku: "JH705-8G" }, { sku: "JH705-40G" }] }] });
  const { bySku } = scanExtraImages(dir, index);
  assert.equal(decodeURIComponent(bySku.get("JH708-6G").sm), "extra/อีอี - ซอง (JH708-6G).jpg");
  assert.equal(decodeURIComponent(bySku.get("JH707-8G").sm), "extra/ขิงดำ - ซอง (JH707).jpg");
  assert.equal(decodeURIComponent(bySku.get("JH705-8G").sm), "extra/มะม่วง - กล่องซอง (JH705x6).jpg"); // box is still used when it is all there is
  fs.rmSync(dir, { recursive: true });
});

test("scanExtraImages fills only SKUs without a catalog image", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cn-img-"));
  for (const f of ["เซรั่มขิงดำ - กล่องซอง (JH707).jpg", "เซรั่มขิงดำ - หลอด (JH707-40g).jpg", "มะม่วง - หลอด (JH705).jpg", "เจล - ซอง (JHK3).jpg"]) fs.writeFileSync(path.join(dir, f), "");
  const index = buildIndex({
    brands: [],
    products: [
      { id: "men", skus: [{ sku: "JH707-8G" }, { sku: "JH707-40G" }] },
      { id: "mango", skus: [{ sku: "JH705-8G" }, { sku: "JH705-40G" }] },
      { id: "gluta", image: { sm: "x" }, skus: [{ sku: "JHK3-6G" }, { sku: "JHK3-30G", image: { sm: "media/JHK3-30G.webp" } }] },
    ],
  });
  const { bySku, byProduct } = scanExtraImages(dir, index);
  assert.match(decodeURIComponent(bySku.get("JH707-8G").sm), /กล่องซอง/);
  assert.match(decodeURIComponent(bySku.get("JH707-40G").sm), /หลอด/);
  assert.match(decodeURIComponent(bySku.get("JH705-40G").sm), /หลอด/);
  assert.equal(bySku.has("JH705-8G"), false);
  assert.match(decodeURIComponent(bySku.get("JHK3-6G").sm), /ซอง/);
  assert.equal(bySku.has("JHK3-30G"), false); // catalog image wins
  assert.ok(byProduct.has("men"));
  assert.equal(byProduct.has("gluta"), false); // product already has an image
  fs.rmSync(dir, { recursive: true });
});
