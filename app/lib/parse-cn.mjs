// อ่านไฟล์ "คัดงานCN.xlsx" แล้วได้แถวที่สะอาด
// - 1 แท็บ = 1 เดือน ชื่อแท็บรูปแบบ MM.YY (เช่น 09.26) แท็บอื่น (เช่น "ปริ้น") ถูกข้าม
// - หาคอลัมน์จากข้อความหัวคอลัมน์ ไม่ล็อกตัวอักษรคอลัมน์ เพราะทีมอาจแทรกคอลัมน์เพิ่ม
import XLSX from "xlsx";

/** Grade order as in the sheet. `group` drives the dashboard: sell = ขายต่อได้, rush = รีบระบาย, expired = หมดอายุ. */
export const GRADES = [
  { key: "Aplus", label: "A+", group: "sell" },
  { key: "A", label: "A", group: "sell" },
  { key: "B", label: "B", group: "sell" },
  { key: "C", label: "C", group: "rush" },
  { key: "D", label: "D", group: "rush" },
  { key: "X", label: "X", group: "expired" },
];

const TH_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const SHEET_RE = /^(\d{1,2})\.(\d{2})$/;

const pad = (n) => String(n).padStart(2, "0");
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

/** Sheet "09.26" → { key: "2026-09", label: "ก.ย. 69" }. Returns null for non-month sheets. */
export function monthFromSheet(name) {
  const m = SHEET_RE.exec(String(name).trim());
  if (!m) return null;
  const month = Number(m[1]);
  const year = 2000 + Number(m[2]);
  if (month < 1 || month > 12) return null;
  return { key: `${year}-${pad(month)}`, label: `${TH_MONTHS[month - 1]} ${String(year + 543).slice(-2)}` };
}

/** Two-digit years are typed in Buddhist Era: 69 → 2569 BE → 2026 CE. */
function beYear(y) {
  if (y < 100) return 2500 + y - 543;
  if (y > 2400) return y - 543;
  return y;
}

/**
 * Parse a date cell. The team types d/m/yy in BE (25/9/69), which Excel stores as 1969-09-25,
 * so years 1950–1999 are shifted by +57 (1969 → 2026). Text cells such as "14-10-69 /// 15-10"
 * take the first d-m-yy found.
 * @returns {{ date: string|null, raw: string, ok: boolean }}
 */
export function parseDate(cell) {
  if (!cell || cell.v === undefined || cell.v === null || cell.v === "") return { date: null, raw: "", ok: false };
  if (cell.t === "n" || cell.t === "d") {
    const serial = cell.t === "d" ? null : cell.v;
    const p = serial !== null ? XLSX.SSF.parse_date_code(serial) : null;
    if (p) {
      const y = p.y >= 1950 && p.y <= 1999 ? p.y + 57 : p.y;
      return { date: iso(y, p.m, p.d), raw: cell.w ?? String(cell.v), ok: true };
    }
  }
  const raw = String(cell.w ?? cell.v).trim();
  const m = /(\d{1,2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{2,4})/.exec(raw);
  if (m) {
    const d = Number(m[1]);
    const mo = Number(m[2]);
    const y = beYear(Number(m[3]));
    if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12) return { date: iso(y, mo, d), raw, ok: true };
  }
  return { date: null, raw, ok: false };
}

/**
 * Clean a SKU as typed: trim, upper-case, drop spaces, and split off trailing "_M1" / "-M2" / "-MO4".
 * " L8B-6G" → { sku: "L8B-6G" } · "L9-8G_M1" → { sku: "L9-8G", suffix: "M1" } · "JHK6-MO1" → { sku: "JHK6", suffix: "MO1" }
 */
export function cleanSku(raw) {
  const s = String(raw ?? "").toUpperCase().replace(/\s+/g, "");
  const m = /^(.+?)[_-](MO?\d+)$/.exec(s);
  return m ? { sku: m[1], suffix: m[2] } : { sku: s, suffix: "" };
}

/** Header "A+ =10/28-07/29" → readable note for that grade in that month. */
export function gradeNote(label) {
  const t = String(label ?? "").trim().replace(/\s+/g, " ");
  if (!t) return "";
  let m;
  if ((m = /^(\d{1,2}\/\d{2})\s*-\s*(\d{1,2}\/\d{2})$/.exec(t))) return `หมดอายุ ${m[1]} – ${m[2]}`;
  if ((m = /^(\d+)\s*-\s*(\d+)$/.exec(t))) return `เหลือ ${m[1]}–${m[2]} เดือน`;
  if ((m = /^ต่ำกว่า\s*(\d+)$/.exec(t))) return `เหลือต่ำกว่า ${m[1]} เดือน`;
  return t;
}

/**
 * The team adds remarks after "//" in the name: "ดีดีครีม 40g //// ไม่มีกล่อง" → { name: "ดีดีครีม 40g", note: "ไม่มีกล่อง" }.
 * The note matters for resale (no box, faded box…), so it is kept apart instead of being matched as part of the name.
 */
export function splitNote(raw) {
  const s = String(raw ?? "").replace(/\s+/g, " ").trim();
  const i = s.search(/\/{2,}/);
  if (i < 0) return { name: s, note: "" };
  return { name: s.slice(0, i).trim(), note: s.slice(i).replace(/^\/+\s*/, "").trim() };
}

const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-based
/** "2026-09-25" + 18 months → "2028-03-25" (day clamped to the month's length). */
export function addMonths(isoDate, n) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const ty = t.getUTCFullYear();
  const tm = t.getUTCMonth() + 1;
  return iso(ty, tm, Math.min(d, lastDay(ty, tm)));
}

/**
 * Expiry date range of a grade, from its column header (the sheet holds no per-row expiry dates).
 *   "04/27-09/27"  → 2027-04-01 … 2027-09-30
 *   "18-24"        → base + 18 months … base + 24 months   (months left; approx)
 *   "ต่ำกว่า6"      → base … base + 6 months                 (approx)
 *   "หมดอายุ 10/26" → 2026-10-01 … 2026-10-31
 *   "หมดอายุ"       → already expired
 * `base` is the row's receive date, or the first day of the sheet's month when the row has none.
 * @returns {{ from?: string, to?: string, expired?: boolean, approx?: boolean } | null}
 */
export function gradeRange(label, base) {
  const t = String(label ?? "").trim().replace(/\s+/g, " ");
  let m;
  if ((m = /^(\d{1,2})\/(\d{2})\s*-\s*(\d{1,2})\/(\d{2})$/.exec(t))) {
    const [y1, m1, y2, m2] = [2000 + Number(m[2]), Number(m[1]), 2000 + Number(m[4]), Number(m[3])];
    return { from: iso(y1, m1, 1), to: iso(y2, m2, lastDay(y2, m2)) };
  }
  if ((m = /^(\d+)\s*-\s*(\d+)$/.exec(t))) return { from: addMonths(base, Number(m[1])), to: addMonths(base, Number(m[2])), approx: true };
  if ((m = /^ต่ำกว่า\s*(\d+)$/.exec(t))) return { from: base, to: addMonths(base, Number(m[1])), approx: true };
  if ((m = /^หมดอายุ\s*(\d{1,2})\/(\d{2})$/.exec(t))) {
    const [y, mo] = [2000 + Number(m[2]), Number(m[1])];
    return { from: iso(y, mo, 1), to: iso(y, mo, lastDay(y, mo)) };
  }
  if (/^หมดอายุ$/.test(t)) return { expired: true };
  return null;
}

const text = (cell) => (cell && cell.v !== undefined && cell.v !== null ? String(cell.w ?? cell.v).trim() : "");

/** Find columns from the header row. */
export function readHeader(ws, range) {
  const cols = { date: -1, sku: -1, name: -1, location: -1, grades: {} };
  const notes = {};
  const labels = {}; // raw text after "=", turned into expiry ranges per row
  for (let c = range.s.c; c <= range.e.c; c++) {
    const h = text(ws[XLSX.utils.encode_cell({ r: range.s.r, c })]);
    if (!h) continue;
    const g = /^(A\+|A|B|C|D|X)\s*=\s*(.*)$/i.exec(h);
    if (g) {
      const grade = GRADES.find((x) => x.label === g[1].toUpperCase());
      cols.grades[grade.key] = c;
      notes[grade.key] = gradeNote(g[2]);
      labels[grade.key] = g[2];
    } else if (h.startsWith("วันที่")) cols.date = c;
    else if (h.toUpperCase() === "SKU") cols.sku = c;
    else if (h.startsWith("ชื่อสินค้า")) cols.name = c;
    else if (h.startsWith("อื่น") || /location/i.test(h)) cols.location = c;
  }
  return { cols, notes, labels };
}

/**
 * Read the whole workbook.
 * @returns {{ months: object[], rows: object[], issues: object[] }}
 */
export function parseWorkbook(wb) {
  const months = [];
  const rows = [];
  const issues = [];
  for (const sheet of wb.SheetNames) {
    const month = monthFromSheet(sheet);
    if (!month) continue;
    const ws = wb.Sheets[sheet];
    if (!ws || !ws["!ref"]) continue;
    const range = XLSX.utils.decode_range(ws["!ref"]);
    const { cols, notes, labels } = readHeader(ws, range);
    if (cols.sku < 0 || Object.keys(cols.grades).length === 0) {
      issues.push({ type: "sheet", sheet, row: 1, message: "หาหัวคอลัมน์ SKU หรือคอลัมน์เกรดไม่เจอ แท็บนี้ถูกข้าม" });
      continue;
    }
    months.push({ ...month, sheet, gradeNotes: notes });
    const cell = (r, c) => (c < 0 ? undefined : ws[XLSX.utils.encode_cell({ r, c })]);
    for (let r = range.s.r + 1; r <= range.e.r; r++) {
      const skuRaw = text(cell(r, cols.sku));
      const qty = {};
      let total = 0;
      for (const g of GRADES) {
        const v = cell(r, cols.grades[g.key] ?? -1);
        const n = v && typeof v.v === "number" ? v.v : Number(String(v?.v ?? "").replace(/,/g, ""));
        if (Number.isFinite(n) && n > 0) {
          qty[g.key] = n;
          total += n;
        }
      }
      if (!skuRaw && total === 0) continue; // blank row, or a row with only a location such as "Zentro"
      const sheetRow = r + 1;
      const d = parseDate(cell(r, cols.date));
      const { sku, suffix } = cleanSku(skuRaw);
      const { name: nameRaw, note } = splitNote(text(cell(r, cols.name)));
      const row = {
        month: month.key,
        sheet,
        sheetRow,
        date: d.date,
        dateRaw: d.raw,
        skuRaw,
        sku,
        suffix,
        nameRaw,
        note,
        location: text(cell(r, cols.location)),
        qty,
        total,
        expiry: {},
      };
      // expiry range per grade in this row; months-left headers count from the receive date
      const base = d.date ?? `${month.key}-01`;
      for (const k of Object.keys(qty)) {
        const range = gradeRange(labels[k], base);
        if (range) row.expiry[k] = range;
      }
      if (!skuRaw) issues.push({ type: "no-sku", sheet, row: sheetRow, nameRaw: row.nameRaw, message: "มีจำนวนแต่ไม่มี SKU" });
      if (total === 0) issues.push({ type: "no-qty", sheet, row: sheetRow, skuRaw, nameRaw: row.nameRaw, message: "มี SKU แต่ไม่มีจำนวนในช่องเกรด" });
      // "-" is how the team marks rows without a receive date (e.g. a stock count at a location): not an error
      const noDateOnPurpose = /^-+$/.test(d.raw);
      if (!d.ok && !noDateOnPurpose) issues.push({ type: "date", sheet, row: sheetRow, skuRaw, nameRaw: row.nameRaw, message: d.raw ? `อ่านวันที่ไม่ได้: "${d.raw}"` : "ไม่มีวันที่" });
      else if (d.ok && d.raw && !/^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$/.test(d.raw)) issues.push({ type: "date-text", sheet, row: sheetRow, skuRaw, nameRaw: row.nameRaw, message: `วันที่เป็นข้อความ "${d.raw}" ใช้วันแรก (${d.date})` });
      rows.push(row);
    }
  }
  return { months, rows, issues };
}

export function readCnFile(path) {
  return parseWorkbook(XLSX.readFile(path, { cellDates: false }));
}
