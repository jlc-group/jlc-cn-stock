import { test } from "node:test";
import assert from "node:assert/strict";
import XLSX from "xlsx";
import { cleanSku, gradeNote, monthFromSheet, parseDate, parseWorkbook, splitNote } from "./parse-cn.mjs";

test("monthFromSheet reads MM.YY tabs and skips others", () => {
  assert.deepEqual(monthFromSheet("09.26"), { key: "2026-09", label: "ก.ย. 69" });
  assert.deepEqual(monthFromSheet("10.26"), { key: "2026-10", label: "ต.ค. 69" });
  assert.equal(monthFromSheet("ปริ้น"), null);
  assert.equal(monthFromSheet("13.26"), null);
});

test("parseDate turns BE two-digit years into CE", () => {
  // 25/9/69 typed in Excel is stored as 1969-09-25 (serial 25471)
  assert.equal(parseDate({ t: "n", v: 25471, w: "9/25/69" }).date, "2026-09-25");
  assert.equal(parseDate({ t: "n", v: 25477, w: "1-10-69" }).date, "2026-10-01");
  assert.deepEqual(parseDate({ t: "s", v: "14-10-69 /// 15-10" }), { date: "2026-10-14", raw: "14-10-69 /// 15-10", ok: true });
  assert.equal(parseDate({ t: "s", v: "-" }).ok, false);
  assert.equal(parseDate(undefined).ok, false);
});

test("cleanSku trims and splits lot suffixes", () => {
  assert.deepEqual(cleanSku(" L8B-6G"), { sku: "L8B-6G", suffix: "" });
  assert.deepEqual(cleanSku("L9-8G_M1"), { sku: "L9-8G", suffix: "M1" });
  assert.deepEqual(cleanSku("C2-8G-M2"), { sku: "C2-8G", suffix: "M2" });
  assert.deepEqual(cleanSku("JHK6-MO1"), { sku: "JHK6", suffix: "MO1" });
  assert.deepEqual(cleanSku("JHM2"), { sku: "JHM2", suffix: "" });
  assert.deepEqual(cleanSku("JH707-8G "), { sku: "JH707-8G", suffix: "" });
});

test("gradeNote explains both header styles", () => {
  assert.equal(gradeNote("10/28-07/29"), "หมดอายุ 10/28 – 07/29");
  assert.equal(gradeNote("18-24"), "เหลือ 18–24 เดือน");
  assert.equal(gradeNote("ต่ำกว่า6 "), "เหลือต่ำกว่า 6 เดือน");
  assert.equal(gradeNote("หมดอายุ  10/26"), "หมดอายุ 10/26");
});

function book(sheets) {
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  return wb;
}

test("parseWorkbook finds columns by header text, skips print tab and location-only rows", () => {
  const head = ["วันที่", "SKU", "ชื่อสินค้า", "A+ =11/28-08/29", "A=04/28-10/28", "B=10/27-03/28", "C=04/27-09/27", "D=11/26-03/27", "X=หมดอายุ  10/26", "อื่นๆ "];
  const wb = book({
    "10.26": [head, [25477, " L8A-6G", "อีอี คูชั่น", 2510, 275, null, null, null, null, null], [null, null, null, null, null, null, null, null, null, "Zentro"], [25477, "C1-6G", "เจล", null, null, null, 396, null, 561, "Zentro"]],
    "ปริ้น": [head],
  });
  const { months, rows } = parseWorkbook(wb);
  assert.equal(months.length, 1);
  assert.equal(months[0].gradeNotes.X, "หมดอายุ 10/26");
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0].qty, { Aplus: 2510, A: 275 });
  assert.equal(rows[0].sku, "L8A-6G");
  assert.equal(rows[1].location, "Zentro");
  assert.equal(rows[1].total, 957);
});

test("parseWorkbook copes with an inserted column", () => {
  const wb = book({ "09.26": [["วันที่", "หมายเหตุ", "SKU", "ชื่อสินค้า", "X=หมดอายุ", "A+ =10/28-07/29"], [25471, "x", "L3-8G", "ดีดี", 5, 7]] });
  const { rows } = parseWorkbook(wb);
  assert.deepEqual(rows[0].qty, { X: 5, Aplus: 7 });
});

test("splitNote keeps remarks after // apart from the name", () => {
  assert.deepEqual(splitNote("ดีดีครีมวอเตอร์เมลอนซันสกรีน 40g //// ไม่มีกล่อง"), { name: "ดีดีครีมวอเตอร์เมลอนซันสกรีน 40g", note: "ไม่มีกล่อง" });
  assert.deepEqual(splitNote("ทูธเพสท์+ 70กรัม//// ไม่มีกล่อง"), { name: "ทูธเพสท์+ 70กรัม", note: "ไม่มีกล่อง" });
  assert.deepEqual(splitNote("อโวคาโด ครีม 8G // ยังไม่แกะกล่อง"), { name: "อโวคาโด ครีม 8G", note: "ยังไม่แกะกล่อง" });
  assert.deepEqual(splitNote("ซอฟท์-เบลอ ยูวี เจล 7 กรัม"), { name: "ซอฟท์-เบลอ ยูวี เจล 7 กรัม", note: "" });
});

test('"-" in the date column is a deliberate no-date, not an issue', () => {
  const head = ["วันที่", "SKU", "ชื่อสินค้า", "A+ =11/28-08/29", "X=หมดอายุ", "อื่นๆ"];
  const wb = book({ "09.26": [head, ["-", "L3-40G", "ดีดีครีม 40g //// ไม่มีกล่อง", 50, 5, "Zentro"], [null, "L3-8G", "ดีดีครีม 8g", 1, null, null]] });
  const { rows, issues } = parseWorkbook(wb);
  assert.equal(rows[0].date, null);
  assert.equal(rows[0].note, "ไม่มีกล่อง");
  assert.equal(rows[0].nameRaw, "ดีดีครีม 40g");
  assert.deepEqual(issues.map((i) => [i.row, i.type]), [[3, "date"]]); // only the truly empty date is flagged
});
