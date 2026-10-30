// CN Dashboard — หน้าเว็บ (JS ล้วน ไม่ต้อง build) ข้อมูลมาจาก GET /api/data
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmt = (n) => Number(n || 0).toLocaleString("th-TH");
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const thDate = (iso) => (iso ? new Date(iso + "T00:00:00").toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" }) : "");
const thDateTime = (iso) => new Date(iso).toLocaleString("th-TH", { day: "numeric", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" });

const GROUPS = {
  sell: { label: "ขายต่อได้", desc: "เกรด A+ / A / B", color: "var(--sell)" },
  rush: { label: "รีบระบาย", desc: "เกรด C / D ใกล้หมดอายุ", color: "var(--rush)" },
  expired: { label: "หมดอายุ", desc: "เกรด X ต้องทำลาย", color: "var(--expired)" },
};
const ISSUE_TYPES = {
  unmatched: "SKU ไม่มีในแคตาล็อก",
  "name-mismatch": "ชื่อในไฟล์ไม่ตรงกับรหัส (แดชบอร์ดใช้ตามรหัส)",
  size: "ขนาดนี้ไม่มีในแคตาล็อก",
  date: "วันที่อ่านไม่ได้",
  "date-text": "วันที่เป็นข้อความ",
  "no-qty": "มี SKU แต่ไม่มีจำนวน",
  "no-sku": "มีจำนวนแต่ไม่มี SKU",
  sheet: "แท็บที่อ่านไม่ได้",
};

let DATA = null;
// An exported file carries its data inline (see export.js); the live app fetches it from the server.
const SNAPSHOT = window.__CN_DATA__ ?? null;
/** Image paths from the server are relative to it; exported files hold data: URLs. */
const imgSrc = (src) => (String(src).startsWith("data:") ? src : "/" + src);
const state = { month: null, group: "all", grade: "all", codeMismatch: false, hideExpired: false, family: "all", brand: "all", location: "all", q: "", sort: "sell", view: "cards" };

// remember view choices per viewer (convenience only)
try {
  Object.assign(state, JSON.parse(localStorage.getItem("cn-dash") || "{}"), { group: "all", q: "" });
} catch {}
const save = () => {
  try {
    localStorage.setItem("cn-dash", JSON.stringify({ month: state.month, sort: state.sort, view: state.view, hideExpired: state.hideExpired }));
  } catch {}
};

const gradeColor = (k) => `var(--g-${k})`;
const familyLabel = (id) => DATA.families?.find((f) => f.id === id)?.label ?? "";

// ---------------------------------------------------------------- days to expiry (one logic for every view)
// Rows carry an expiry range per grade, read from the column headers (see gradeRange in app/lib/parse-cn.mjs).
// Days are counted from today on the viewer's machine, so an exported file stays current when opened later.
const DAY_MS = 86400000;
const todayUtc = () => {
  const n = new Date();
  return Date.UTC(n.getFullYear(), n.getMonth(), n.getDate());
};
const daysUntil = (isoDate) => Math.round((Date.parse(isoDate + "T00:00:00Z") - todayUtc()) / DAY_MS);
const thMonthYear = (isoDate) => new Date(isoDate + "T00:00:00").toLocaleDateString("th-TH", { month: "short", year: "2-digit" });

/** Combine the expiry ranges of these rows for the given grades → { min, max, from, to, approx } in days, or null. */
function expiryOf(rows, gradeKeys) {
  let e = null;
  for (const r of rows) {
    for (const k of gradeKeys) {
      const x = r.qty[k] ? r.expiry?.[k] : null;
      if (!x) continue;
      e ??= { min: Infinity, max: -Infinity, from: null, to: null, approx: false };
      if (x.expired) {
        e.min = Math.min(e.min, -1);
        e.max = Math.max(e.max, -1);
        continue;
      }
      e.min = Math.min(e.min, daysUntil(x.from));
      e.max = Math.max(e.max, daysUntil(x.to));
      if (!e.from || x.from < e.from) e.from = x.from;
      if (!e.to || x.to > e.to) e.to = x.to;
      e.approx ||= !!x.approx;
    }
  }
  return e;
}

/** "หมดอายุแล้ว" · "อีกไม่เกิน N วัน" (part may already be expired) · "อีก N–M วัน" ("~" = estimated from months-left headers) */
function expiryText(e) {
  if (!e) return "";
  if (e.max < 0) return "หมดอายุแล้ว";
  const t = e.approx ? "~" : "";
  if (e.min <= 0) return `อีกไม่เกิน ${t}${fmt(e.max)} วัน`;
  return e.min === e.max ? `อีก ${t}${fmt(e.min)} วัน` : `อีก ${t}${fmt(e.min)}–${fmt(e.max)} วัน`;
}
const expiryLevel = (e) => (!e ? "" : e.max < 0 ? "exp-gone" : e.min <= 90 ? "exp-90" : e.min <= 180 ? "exp-180" : "exp-ok");
const TH_MONTH_SHORT = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
/** Grade note from the header, with MM/YY written as Thai month + BE year: "หมดอายุ 11/28 – 08/29" → "หมดอายุ พ.ย. 71 – ส.ค. 72" */
const prettyNote = (note) =>
  String(note ?? "").replace(/\b(\d{1,2})\/(\d{2})\b/g, (m, mm, yy) => (Number(mm) >= 1 && Number(mm) <= 12 ? `${TH_MONTH_SHORT[Number(mm) - 1]} ${Number(yy) + 43}` : m));
const expiryRange = (e) => {
  if (!e?.from) return "";
  const [a, b] = [thMonthYear(e.from), thMonthYear(e.to)];
  return a === b ? a : `${a} – ${b}`;
};
const expiryBadge = (e, extra = "", prefix = "") => (e ? `<span class="exp ${expiryLevel(e)}">${prefix}${esc(expiryText(e))}${extra}</span>` : "");

/** The stock that expires first among grades not yet expired (A+ … D); falls back to grade X when only X is left. */
function soonest(a) {
  let best = null;
  for (const g of DATA.grades) {
    if (g.group === "expired" || !a.qty[g.key]) continue;
    const e = expiryOf(a.rows, [g.key]);
    if (e && e.max >= 0 && (!best || e.min < best.e.min)) best = { e, grade: g };
  }
  if (best) return best;
  const x = expiryOf(a.rows, DATA.grades.filter((g) => g.group === "expired").map((g) => g.key));
  return x ? { e: x, grade: DATA.grades.find((g) => g.group === "expired") } : null;
}
const soonestDays = (a) => {
  const s = soonest(a);
  return s ? s.e.min : Infinity;
};
const groupOf = (k) => DATA.grades.find((g) => g.key === k)?.group;

function sumGroups(qty) {
  const s = { sell: 0, rush: 0, expired: 0, total: 0 };
  for (const g of DATA.grades) {
    const n = qty[g.key] || 0;
    s[g.group] += n;
    s[g.key] = n;
    s.total += n;
  }
  return s;
}

/** Rows in the selected month / location. */
/** Grades shown on screen: all of them, or without grade X while "ซ่อนหมดอายุ" is on. */
const shownGrades = () => DATA.grades.filter((g) => !(state.hideExpired && g.group === "expired"));
const expiredKeys = () => DATA.grades.filter((g) => g.group === "expired").map((g) => g.key);
/** Copy of a row without its expired pieces (nothing is deleted from the data). */
function withoutExpired(r) {
  const qty = { ...r.qty };
  const expiry = { ...r.expiry };
  let total = r.total;
  for (const k of expiredKeys()) {
    total -= qty[k] || 0;
    delete qty[k];
    delete expiry[k];
  }
  return { ...r, qty, expiry, total };
}

function scopedRows() {
  const rows = DATA.rows.filter((r) => (state.month === "all" || r.month === state.month) && (state.location === "all" || r.location === state.location));
  return state.hideExpired ? rows.map(withoutExpired).filter((r) => r.total > 0) : rows;
}

function matchesText(it) {
  if (!state.q) return true;
  const q = state.q.toLowerCase().replace(/\s+/g, "");
  const hay = [it.name, familyLabel(it.familyId), it.productName, it.nameEn, it.nickname, it.sku, ...it.rawSkus, ...it.rawNames].join("|").toLowerCase().replace(/\s+/g, "");
  return hay.includes(q);
}

/** Aggregate rows per item, then apply brand / search filters. Group filter is applied by the caller. */
function aggregate(rows) {
  const by = new Map();
  for (const r of rows) {
    const it = DATA.items[r.itemKey];
    if (!it) continue;
    if (state.brand !== "all" && (it.brandId || "-") !== state.brand) continue;
    if (state.family !== "all" && it.familyId !== state.family) continue;
    if (!matchesText(it)) continue;
    let a = by.get(r.itemKey);
    if (!a) by.set(r.itemKey, (a = { item: it, qty: {}, rows: [] }));
    for (const [k, n] of Object.entries(r.qty)) a.qty[k] = (a.qty[k] || 0) + n;
    a.rows.push(r);
  }
  for (const a of by.values()) a.sum = sumGroups(a.qty);
  return [...by.values()];
}

// ---------------------------------------------------------------- render
function syncExpiredToggle() {
  if (state.hideExpired) {
    if (state.group === "expired") state.group = "all";
    if (expiredKeys().includes(state.grade)) state.grade = "all";
    if (state.sort === "expired") state.sort = "sell";
  }
  const opt = document.querySelector('#sort option[value="expired"]');
  if (opt) opt.hidden = state.hideExpired;
  $("#sort").value = state.sort;
  const btn = $("#expToggle");
  btn.textContent = state.hideExpired ? "🙈 แสดงหมดอายุ" : "👁 ซ่อนหมดอายุ";
  btn.classList.toggle("on", state.hideExpired);
  btn.setAttribute("aria-pressed", String(state.hideExpired));
}

function render() {
  syncExpiredToggle();
  const all = aggregate(scopedRows());
  const totals = { qty: {} };
  for (const a of all) for (const [k, n] of Object.entries(a.qty)) totals.qty[k] = (totals.qty[k] || 0) + n;
  totals.sum = sumGroups(totals.qty);

  renderMonths();
  renderKpis(totals.sum);
  renderGradeBar(totals.qty, totals.sum.total, all.flatMap((a) => a.rows));

  // A single grade (clicked in the grade bar) is narrower than a group (KPI card); only one is active at a time.
  const pick = state.grade !== "all" ? state.grade : state.group;
  let list = pick === "all" ? all : all.filter((a) => a.sum[pick] > 0);
  // "รหัสไม่ตรง": only items whose Excel code differs from the code used
  const mismatched = list.filter((a) => excelCodes(a).length);
  $("#mismatchCount").textContent = fmt(mismatched.length);
  $("#mismatch").classList.toggle("on", state.codeMismatch);
  $("#mismatch").setAttribute("aria-pressed", String(state.codeMismatch));
  if (state.codeMismatch) list = mismatched;
  const key = state.grade !== "all" ? state.grade : state.sort;
  list.sort((a, b) =>
    key === "name" ? a.item.name.localeCompare(b.item.name, "th") : key === "expiry" ? soonestDays(a) - soonestDays(b) || b.sum.total - a.sum.total : b.sum[key] - a.sum[key] || b.sum.total - a.sum.total,
  );
  renderFilterLine(list.length);
  $("#list").innerHTML =
    list.length === 0 ? `<div class="empty">ไม่มีสินค้าที่ตรงกับตัวกรอง</div>` : state.view === "table" ? tableHtml(list) : state.view === "family" ? familyHtml(list) : cardsHtml(list);
  renderCodes();
  renderIssues();
}

function renderMonths() {
  const opts = [...DATA.months.map((m) => ({ key: m.key, label: m.label })), { key: "all", label: "ทุกเดือน" }];
  $("#months").innerHTML = opts.map((o) => `<button type="button" data-month="${o.key}" class="${o.key === state.month ? "on" : ""}">${esc(o.label)}</button>`).join("");
}

function renderKpis(s) {
  const card = (cls, label, value, meta, dot) => `
    <button type="button" class="kpi ${cls} ${state.group === cls ? "on" : ""}" data-group="${cls}" aria-pressed="${state.group === cls}">
      <div class="label">${dot ? `<i class="dot" style="background:${dot}"></i>` : ""}${label}</div>
      <div class="value num">${fmt(value)}<small>ชิ้น</small></div>
      <div class="meta">${meta}</div>
    </button>`;
  $("#kpis").innerHTML =
    card("all", state.hideExpired ? "รับคืน (ไม่รวมหมดอายุ)" : "รับคืนทั้งหมด", s.total, `${fmt(new Set(scopedRows().map((r) => r.itemKey)).size)} รายการสินค้า`) +
    card("sell", GROUPS.sell.label, s.sell, `${pct(s.sell, s.total)}% · ${GROUPS.sell.desc}`, GROUPS.sell.color) +
    card("rush", GROUPS.rush.label, s.rush, `${pct(s.rush, s.total)}% · ${GROUPS.rush.desc}`, GROUPS.rush.color) +
    (state.hideExpired ? "" : card("expired", GROUPS.expired.label, s.expired, `${pct(s.expired, s.total)}% · ${GROUPS.expired.desc}`, GROUPS.expired.color));
  $("#kpis").classList.toggle("three", state.hideExpired);
}

function renderGradeBar(qty, total, rows = []) {
  $("#gradebar").innerHTML = shownGrades()
    .map((g) => {
      const n = qty[g.key] || 0;
      const w = total ? (n / total) * 100 : 0;
      const cls = state.grade === g.key ? "on" : state.grade !== "all" ? "dim" : "";
      return w > 0
        ? `<button type="button" class="${cls}" data-grade="${g.key}" style="width:${w}%;background:${gradeColor(g.key)}" title="${g.label}: ${fmt(n)} ชิ้น (${pct(n, total)}%) · กดเพื่อดูสินค้าเกรดนี้">${w > 6 ? `${g.label} ${pct(n, total)}%` : ""}</button>`
        : "";
    })
    .join("");
  const month = DATA.months.find((m) => m.key === state.month);
  $("#gradeHint").textContent = month ? `ช่วงอายุตามหัวคอลัมน์ในแท็บ ${month.sheet}` : "เลือกเดือนเพื่อดูช่วงวันหมดอายุของแต่ละเกรด";
  $("#legend").classList.toggle("five", state.hideExpired);
  $("#legend").innerHTML = shownGrades()
    .map((g) => {
      const n = qty[g.key] || 0;
      const note = month?.gradeNotes?.[g.key] || GROUPS[g.group].label;
      const cls = state.grade === g.key ? "on" : state.grade !== "all" ? "dim" : "";
      const e = n ? expiryOf(rows, [g.key]) : null;
      return `<li><button type="button" class="${cls}" data-grade="${g.key}" aria-pressed="${state.grade === g.key}" ${n ? "" : "disabled"} title="กดเพื่อดูสินค้าเกรด ${g.label}">
        <span class="lg-top"><span class="sw" style="background:${gradeColor(g.key)}">${g.label}</span><span class="lg-pct num">${total ? pct(n, total) : 0}%</span></span>
        <span class="lg-num num">${fmt(n)} <small>ชิ้น</small></span>
        <span class="lg-note" title="${esc(prettyNote(note))}">${esc(prettyNote(note))}</span>
        ${e ? `<span class="lg-days ${expiryLevel(e)}">⏳ ${esc(expiryText(e))}</span>` : `<span class="lg-days lg-none">—</span>`}
      </button></li>`;
    })
    .join("");
}

function renderFilterLine(count) {
  const chips = [];
  if (state.group !== "all") chips.push(`<button class="chip" data-clear="group">${GROUPS[state.group].label} ✕</button>`);
  if (state.grade !== "all") chips.push(`<button class="chip" data-clear="grade">เกรด ${esc(DATA.grades.find((g) => g.key === state.grade)?.label)} ✕</button>`);
  if (state.codeMismatch) chips.push(`<button class="chip" data-clear="codeMismatch">รหัสไม่ตรง ✕</button>`);
  if (state.family !== "all") chips.push(`<button class="chip" data-clear="family">สารสกัด ${esc(familyLabel(state.family))} ✕</button>`);
  if (state.brand !== "all") chips.push(`<button class="chip" data-clear="brand">${esc(DATA.brands.find((b) => b.id === state.brand)?.name)} ✕</button>`);
  if (state.location !== "all") chips.push(`<button class="chip" data-clear="location">${esc(state.location)} ✕</button>`);
  if (state.q) chips.push(`<button class="chip" data-clear="q">"${esc(state.q)}" ✕</button>`);
  $("#filterline").innerHTML = `<span>${fmt(count)} รายการ</span>${chips.join("")}`;
}

function thumb(it, size = "sm") {
  const src = it.image?.[size] ?? it.image?.sm;
  if (src) return `<img src="${esc(imgSrc(src))}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'ph',textContent:'${esc(it.sku).slice(0, 8)}'}))" />`;
  return `<div class="ph">${esc(it.sku.split("-")[0])}</div>`;
}

function miniBar(qty, total, h = 8) {
  return `<div class="mini" style="height:${h}px">${shownGrades()
    .map((g) => (qty[g.key] ? `<span style="width:${(qty[g.key] / total) * 100}%;background:${gradeColor(g.key)}" title="${g.label}: ${fmt(qty[g.key])}"></span>` : ""))
    .join("")}</div>`;
}

const matchFlag = (it) => (it.match === "none" ? `<span class="flag none">ไม่พบในแคตาล็อก</span>` : it.match === "product" ? `<span class="flag">ตรวจขนาด</span>` : "");
/** Remarks typed after "//" in the Excel name (ไม่มีกล่อง, กล่องสีซีด …), unique per item. */
const notesOf = (a) => [...new Set(a.rows.map((r) => r.note).filter(Boolean))];
const noteFlag = (a) => {
  const notes = notesOf(a);
  return notes.length ? `<span class="flag note" title="${esc(notes.join(" · "))}">📝 ${esc(notes.length === 1 ? notes[0] : `หมายเหตุ ${notes.length} ข้อ`)}</span>` : "";
};

function cardsHtml(list) {
  // The big number follows the selected group (ขายต่อได้ by default).
  const focus = state.group === "all" ? "sell" : state.group;
  const grade = DATA.grades.find((g) => g.key === state.grade);
  return `<div class="cards">${list
    .map((a) => {
      const it = a.item;
      const s = a.sum;
      const others = ["rush", "expired", "sell"].filter((g) => g !== focus && s[g]);
      return `<button type="button" class="card" data-item="${esc(it.key)}">
        <div class="thumb">${thumb(it)}${matchFlag(it)}${noteFlag(a)}</div>
        <div class="card-body">
          <div class="name" title="${esc(it.name)}">${esc(it.name)}</div>
          <div class="skuline"><span class="mono">${esc(it.sku)}</span>${excelCodes(a).length ? `<span class="excel-code" title="รหัสที่พิมพ์ในไฟล์ Excel">ใน Excel: ${esc(excelCodes(a).join(", "))}</span>` : it.brandName ? `· ${esc(it.brandName)}` : ""}</div>
          ${
            grade
              ? `<div class="big"><span class="n num" style="color:${GROUPS[grade.group].color}">${fmt(s[grade.key])}</span><span class="t">เกรด ${grade.label} · ${GROUPS[grade.group].label}</span></div>`
              : `<div class="big"><span class="n num ${s[focus] ? "" : "zero"}" style="color:${s[focus] ? GROUPS[focus].color : ""}">${fmt(s[focus])}</span><span class="t">${GROUPS[focus].label}</span></div>`
          }
          ${miniBar(a.qty, s.total)}
          ${(() => {
            const sn = soonest(a);
            return sn ? `<div class="exp-line" title="ของที่ใกล้หมดอายุที่สุดของสินค้านี้">${expiryBadge(sn.e, "", "⏳ ")}<span class="muted">เกรด ${esc(sn.grade.label)}</span></div>` : "";
          })()}
          <div class="subline"><span>รวม <b class="num">${fmt(s.total)}</b></span>${others.map((g) => `<span class="${g}">${GROUPS[g].label} ${fmt(s[g])}</span>`).join("")}</div>
        </div>
      </button>`;
    })
    .join("")}</div>`;
}

function tableHtml(list) {
  const g = shownGrades();
  const foot = { qty: {} };
  for (const a of list) for (const [k, n] of Object.entries(a.qty)) foot.qty[k] = (foot.qty[k] || 0) + n;
  foot.sum = sumGroups(foot.qty);
  const cell = (n) => `<td class="r num ${n ? "" : "zero"}">${n ? fmt(n) : "–"}</td>`;
  return `<div class="tablewrap"><table>
    <thead><tr><th></th><th>สินค้า</th><th>SKU</th>${g.map((x) => `<th class="r"><span class="gh"><i style="background:${gradeColor(x.key)}"></i>${x.label}</span></th>`).join("")}<th class="r">ขายต่อได้</th><th class="r">รวม</th><th>ใกล้หมดสุด</th></tr></thead>
    <tbody>${list
      .map(
        (a) => `<tr data-item="${esc(a.item.key)}">
          <td>${a.item.image ? `<img class="tthumb" src="${esc(imgSrc(a.item.image.sm))}" alt="" loading="lazy" />` : ""}</td>
          <td class="pname">${esc(a.item.name)}</td>
          <td class="mono">${esc(a.item.sku)}</td>
          ${g.map((x) => cell(a.qty[x.key])).join("")}
          <td class="r num sellcol">${fmt(a.sum.sell)}</td>
          <td class="r num"><b>${fmt(a.sum.total)}</b></td>
          <td>${(() => {
            const sn = soonest(a);
            return sn ? `${expiryBadge(sn.e)} <span class="muted">${esc(sn.grade.label)}</span>` : "";
          })()}</td></tr>`,
      )
      .join("")}</tbody>
    <tfoot><tr><td></td><td>รวม ${fmt(list.length)} รายการ</td><td></td>${g.map((x) => `<td class="r num">${fmt(foot.qty[x.key])}</td>`).join("")}<td class="r num sellcol">${fmt(foot.sum.sell)}</td><td class="r num">${fmt(foot.sum.total)}</td><td></td></tr></tfoot>
  </table></div>`;
}

/** One section per extract family; rows inside keep the selected sort. Sections are ordered by the same sort key. */
function familyHtml(list) {
  const groups = new Map();
  for (const a of list) {
    const id = a.item.familyId;
    if (!groups.has(id)) groups.set(id, { id, items: [], qty: {} });
    const g = groups.get(id);
    g.items.push(a);
    for (const [k, n] of Object.entries(a.qty)) g.qty[k] = (g.qty[k] || 0) + n;
  }
  const key = state.sort;
  const fams = [...groups.values()].map((g) => ({ ...g, sum: sumGroups(g.qty) }));
  fams.sort((a, b) => (key === "name" ? familyLabel(a.id).localeCompare(familyLabel(b.id), "th") : b.sum[key] - a.sum[key] || b.sum.total - a.sum.total));
  // unknown family always last
  const unknown = fams.findIndex((f) => f.id === "-");
  if (unknown >= 0) fams.push(...fams.splice(unknown, 1));
  return `<div class="fams">${fams
    .map(
      (f) => `<section class="fam">
        <header class="fam-head">
          <button type="button" class="fam-name" data-family="${esc(f.id)}" title="กรองเฉพาะสารสกัดนี้">${esc(familyLabel(f.id))}</button>
          <span class="muted">${fmt(f.items.length)} รายการ</span>
          <span class="fam-nums"><b class="num">${fmt(f.sum.total)}</b> ชิ้น · <span class="sell">ขายต่อได้ ${fmt(f.sum.sell)}</span>${f.sum.rush ? ` · <span class="rush">รีบระบาย ${fmt(f.sum.rush)}</span>` : ""}${f.sum.expired && !state.hideExpired ? ` · <span class="expired">หมดอายุ ${fmt(f.sum.expired)}</span>` : ""}</span>
        </header>
        ${miniBar(f.qty, f.sum.total, 10)}
        <div class="fam-rows">${f.items
          .map(
            (a) => `<button type="button" class="fam-row" data-item="${esc(a.item.key)}">
              <span class="fam-thumb">${thumb(a.item)}</span>
              <span class="fam-info"><span class="fam-pname">${esc(a.item.name)}</span><span class="mono muted">${esc(a.item.sku)} ${(() => {
                const sn = soonest(a);
                return sn ? `· ⏳ ${expiryBadge(sn.e)}` : "";
              })()}</span></span>
              <span class="fam-bar">${miniBar(a.qty, a.sum.total)}</span>
              <span class="fam-q"><b class="num ${a.sum.sell ? "sell" : "zero"}">${fmt(a.sum.sell)}</b><small>ขายได้</small></span>
              <span class="fam-q q-rush"><b class="num ${a.sum.rush ? "rush" : "zero"}">${fmt(a.sum.rush)}</b><small>รีบระบาย</small></span>
              ${state.hideExpired ? "" : `<span class="fam-q q-exp"><b class="num ${a.sum.expired ? "expired" : "zero"}">${fmt(a.sum.expired)}</b><small>หมดอายุ</small></span>`}
              <span class="fam-q"><b class="num">${fmt(a.sum.total)}</b><small>รวม</small></span>
            </button>`,
          )
          .join("")}</div>
      </section>`,
    )
    .join("")}</div>`;
}


const normSku = (s) => String(s ?? "").toUpperCase().replace(/\s+/g, "");
/** Codes typed in Excel (for these rows) that differ from the code the item is counted under. */
const excelCodes = (a) => [...new Set(a.rows.map((r) => r.skuRaw).filter((s) => normSku(s) !== normSku(a.item.sku)))];
const DECIDED = {
  map: "สรุปไว้ (sku-map)",
  exact: "ระบบ: ตัดช่องว่าง/ท้ายรหัส",
  size: "ระบบ: รหัส + ขนาดจากชื่อ",
  product: "ระบบ: รหัสตรง แต่ไม่มีขนาดนี้",
  none: "จับคู่ไม่ได้",
};

/** Every Excel code that the dashboard counts under another code, side by side, in the selected month. */
function renderCodes() {
  const groups = new Map();
  for (const r of scopedRows()) {
    if (normSku(r.skuRaw) === normSku(r.skuUsed)) continue;
    const k = `${r.skuRaw}|${r.skuUsed}`;
    if (!groups.has(k)) groups.set(k, { ...r, names: new Set(), total: 0, where: [] });
    const g = groups.get(k);
    if (r.nameRaw) g.names.add(r.nameRaw);
    g.total += r.total;
    g.where.push(`${r.sheet}/${r.row}`);
  }
  const list = [...groups.values()].sort((a, b) => (a.decidedBy === "map" ? 0 : 1) - (b.decidedBy === "map" ? 0 : 1) || a.skuRaw.localeCompare(b.skuRaw));
  $("#codeCount").textContent = fmt(list.length);
  $("#codeCount").className = "pill ok";
  $("#codes").innerHTML = list.length
    ? `<div class="tablewrap"><table>
      <thead><tr><th>รหัสใน Excel</th><th>ชื่อใน Excel</th><th></th><th>รหัสที่ใช้</th><th>ชื่อสินค้าที่แสดง</th><th>ใครสรุป</th><th class="r">ชิ้น</th><th>แท็บ / แถว</th></tr></thead>
      <tbody>${list
        .map((g) => {
          const it = DATA.items[g.itemKey];
          return `<tr data-item="${esc(g.itemKey)}">
            <td class="mono">${esc(g.skuRaw)}</td>
            <td style="white-space:normal;min-width:180px">${esc([...g.names].join(" / "))}</td>
            <td>→</td>
            <td class="mono"><b>${esc(g.skuUsed)}</b></td>
            <td style="white-space:normal;min-width:200px">${esc(it?.name ?? "")}${g.mapNote ? `<div class="muted">📌 ${esc(g.mapNote)}</div>` : ""}</td>
            <td><span class="decided ${g.decidedBy === "map" ? "map" : ""}">${esc(DECIDED[g.decidedBy] ?? g.decidedBy)}</span></td>
            <td class="r num">${fmt(g.total)}</td>
            <td class="muted">${esc(g.where.join(", "))}</td>
          </tr>`;
        })
        .join("")}</tbody></table></div>`
    : `<p class="muted">รหัสในไฟล์ตรงกับรหัสที่ใช้ทั้งหมด</p>`;
}

function scopedIssues() {
  const sheets = state.month === "all" ? null : new Set(DATA.months.filter((m) => m.key === state.month).map((m) => m.sheet));
  return DATA.issues.filter((i) => !sheets || sheets.has(i.sheet));
}

function renderIssues() {
  const list = scopedIssues();
  $("#issueCount").textContent = fmt(list.length);
  $("#issueCount").className = "pill" + (list.length ? "" : " ok");
  if (!list.length) {
    $("#issues").innerHTML = `<p class="muted">ไม่มีอะไรต้องแก้ 🎉</p>`;
    return;
  }
  // Group by type, then merge identical SKU + message so one problem shows once with all its rows.
  const byType = new Map();
  for (const i of list) {
    if (!byType.has(i.type)) byType.set(i.type, new Map());
    const k = `${i.skuRaw}|${i.message}`;
    const m = byType.get(i.type);
    if (!m.has(k)) m.set(k, { ...i, where: [] });
    m.get(k).where.push(`${i.sheet} แถว ${i.row}`);
  }
  const order = Object.keys(ISSUE_TYPES);
  $("#issues").innerHTML = [...byType.entries()]
    .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
    .map(
      ([type, m]) => `<div class="issue-group"><h3>${ISSUE_TYPES[type] ?? type} <span class="muted">(${[...m.values()].reduce((n, x) => n + x.where.length, 0)} แถว)</span></h3>
        ${[...m.values()]
          .map(
            (i) => `<div class="issue">
              <div><span class="mono">${esc(i.skuRaw || "—")}</span><div class="where">แท็บ ${esc(i.where.join(", "))}</div></div>
              <div>${i.nameRaw ? `<div>${esc(i.nameRaw)}</div>` : ""}<div class="muted">${esc(i.message)}</div>${i.suggestion ? `<div class="hint">→ ${esc(i.suggestion)}</div>` : ""}</div>
            </div>`,
          )
          .join("")}</div>`,
    )
    .join("");
}

// ---------------------------------------------------------------- detail dialog
function openDetail(key) {
  const a = aggregate(scopedRows()).find((x) => x.item.key === key);
  if (!a) return;
  const it = a.item;
  const month = DATA.months.find((m) => m.key === state.month);
  const issues = scopedIssues().filter((i) => i.itemKey === key && i.type !== "name-mismatch"); // the code wins; name differences stay in ตรวจข้อมูล
  const rows = [...a.rows].sort((x, y) => (x.date || "").localeCompare(y.date || "") || x.row - y.row);
  const showLoc = rows.some((r) => r.location);
  const showNote = rows.some((r) => r.note);
  const dlg = $("#detail");
  dlg.innerHTML = `
    <button class="d-close" type="button" aria-label="ปิด" data-close>✕</button>
    <div class="d-head">
      <div class="thumb">${thumb(it, "lg")}</div>
      <div>
        <div class="muted">${esc(it.brandName)} · สารสกัด ${esc(familyLabel(it.familyId))} · ${esc(it.matchLabel)}</div>
        <h2 class="d-title" id="dTitle">${esc(it.name)}</h2>
        ${it.nameEn ? `<div class="muted">${esc(it.nameEn)}</div>` : ""}
        <div style="margin-top:6px"><span class="muted">รหัสที่ใช้</span> <span class="tag mono"><b>${esc(it.sku)}</b></span>${excelCodes(a).length ? ` <span class="muted">· ใน Excel</span> ${excelCodes(a).map((s) => `<span class="tag mono excel-code">${esc(s)}</span>`).join("")}` : ""}</div>
        ${[...new Set(a.rows.map((r) => r.mapNote).filter(Boolean))].map((n) => `<div class="muted" style="margin-top:4px">📌 ${esc(n)}</div>`).join("")}
        <div class="big" style="margin-top:10px"><span class="n num ${a.sum.sell ? "" : "zero"}">${fmt(a.sum.sell)}</span><span class="t">ขายต่อได้ จากทั้งหมด ${fmt(a.sum.total)} ชิ้น ${state.month === "all" ? "(ทุกเดือน)" : `(${esc(month?.label)})`}</span></div>
        ${miniBar(a.qty, a.sum.total, 10)}
        <div class="d-grades ${state.hideExpired ? "five" : ""}">${shownGrades()
          .map((g) => `<div style="border-left:4px solid ${gradeColor(g.key)}"><span>${g.label}</span><b class="num">${fmt(a.qty[g.key] || 0)}</b><span class="muted">${esc(prettyNote(month?.gradeNotes?.[g.key]) || GROUPS[g.group].label)}</span>${a.qty[g.key] ? expiryBadge(expiryOf(a.rows, [g.key])) : ""}</div>`)
          .join("")}</div>
        ${(() => {
          const lines = shownGrades()
            .filter((g) => a.qty[g.key])
            .map((g) => ({ g, e: expiryOf(a.rows, [g.key]) }))
            .filter((x) => x.e);
          return lines.length
            ? `<div class="exp-strip"><b>⏳ เหลืออีกกี่วันถึงหมดอายุ (นับจากวันนี้)</b>${lines
                .map(
                  ({ g, e }) =>
                    `<div><span class="sw" style="background:${gradeColor(g.key)}">${g.label}</span> <span class="num">${fmt(a.qty[g.key])} ชิ้น</span> <span class="muted">${esc(expiryRange(e) || "หมดอายุแล้ว")}</span> ${expiryBadge(e)}</div>`,
                )
                .join("")}</div>`
            : "";
        })()}
      </div>
    </div>
    <div class="d-body">
      ${
        issues.length
          ? `<div class="banner">${issues.map((i) => `• ${esc(i.message)}${i.suggestion ? ` <b>→ ${esc(i.suggestion)}</b>` : ""} <span class="muted">(${esc(i.sheet)} แถว ${i.row})</span>`).join("<br>")}</div>`
          : ""
      }
      <h3 style="font-size:15px">รายการที่มาจากไฟล์ Excel (${fmt(rows.length)} แถว)</h3>
      <div class="tablewrap"><table>
        <thead><tr><th>วันที่</th><th>SKU ในไฟล์</th><th>ชื่อในไฟล์</th>${shownGrades().map((g) => `<th class="r"><span class="gh"><i style="background:${gradeColor(g.key)}"></i>${g.label}</span></th>`).join("")}${showLoc ? "<th>Location</th>" : ""}${showNote ? "<th>หมายเหตุ</th>" : ""}<th>หมดอายุใน</th><th>แท็บ / แถว</th></tr></thead>
        <tbody>${rows
          .map(
            (r) => `<tr style="cursor:default"><td>${r.date ? thDate(r.date) : `<span class="muted">${esc(r.dateRaw || "—")}</span>`}</td><td class="mono">${esc(r.skuRaw)}${normSku(r.skuRaw) !== normSku(r.skuUsed) ? ` <span class="muted">→ ${esc(r.skuUsed)}</span>` : ""}</td><td style="white-space:normal;min-width:200px">${esc(r.nameRaw)}</td>
              ${shownGrades().map((g) => `<td class="r num ${r.qty[g.key] ? "" : "zero"}">${r.qty[g.key] ? fmt(r.qty[g.key]) : "–"}</td>`).join("")}${showLoc ? `<td>${esc(r.location)}</td>` : ""}${showNote ? `<td style="white-space:normal">${r.note ? `<b>📝 ${esc(r.note)}</b>` : ""}</td>` : ""}<td style="white-space:normal">${DATA.grades
                .filter((g) => r.qty[g.key])
                .map((g) => `<span class="nowrap">${g.label} ${expiryBadge(expiryOf([r], [g.key]))}</span>`)
                .join(" ")}</td><td class="muted">${esc(r.sheet)} / ${r.row}</td></tr>`,
          )
          .join("")}</tbody>
      </table></div>
    </div>`;
  dlg.showModal();
}

// ---------------------------------------------------------------- filters & events
function fillSelects() {
  const brands = [...DATA.brands].sort((a, b) => a.name.localeCompare(b.name));
  $("#brand").innerHTML = `<option value="all">ทุกแบรนด์</option>` + brands.map((b) => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join("");
  if (!brands.some((b) => b.id === state.brand)) state.brand = "all";
  $("#brand").value = state.brand;
  $("#family").innerHTML = `<option value="all">ทุกสารสกัด</option>` + DATA.families.map((f) => `<option value="${esc(f.id)}">${esc(f.label)}</option>`).join("");
  if (!DATA.families.some((f) => f.id === state.family)) state.family = "all";
  $("#family").value = state.family;
  const locs = DATA.locations;
  $("#location").hidden = locs.length === 0;
  $("#location").innerHTML = `<option value="all">ทุก Location</option>` + locs.map((l) => `<option>${esc(l)}</option>`).join("");
  if (!locs.includes(state.location)) state.location = "all";
  $("#location").value = state.location;
  $("#sort").value = state.sort;
  document.querySelectorAll(".seg button").forEach((b) => b.classList.toggle("on", b.dataset.view === state.view));
}

function renderChrome() {
  $("#source").textContent = SNAPSHOT
    ? `ข้อมูล ณ ${thDateTime(DATA.exportedAt)} · จากไฟล์ ${DATA.source.file}`
    : `ไฟล์ ${DATA.source.file} · แก้ไขล่าสุด ${thDateTime(DATA.source.modifiedAt)}`;
  const banners = [];
  if (!DATA.catalog.ok) banners.push(`<div class="banner">อ่านแคตาล็อกสินค้าจาก jlc-product-info ไม่ได้ (${esc(DATA.catalog.error)}) จึงแสดงชื่อจากไฟล์ Excel และไม่มีรูปสินค้า</div>`);
  $("#banner").innerHTML = banners.join("");
  $("#foot").innerHTML = [
    DATA.catalog.ok ? `ชื่อและรูปสินค้าจาก jlc-product-info (อัปเดต ${thDateTime(DATA.catalog.generatedAt)})` : "",
    DATA.locations.length ? "" : `ยังไม่มีข้อมูล Location — ถ้ากรอกช่อง "อื่นๆ" (เช่น Zentro) ในแถวที่มีจำนวน จะกรองตามที่เก็บสินค้าได้`,
  ]
    .filter(Boolean)
    .join("<br>");
}

async function load() {
  $("#refresh").disabled = true;
  try {
    if (SNAPSHOT) DATA = SNAPSHOT;
    else {
      const res = await fetch("/api/data", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || res.statusText);
      DATA = body;
    }
    if (!state.month || (state.month !== "all" && !DATA.months.some((m) => m.key === state.month))) state.month = DATA.months.at(-1)?.key ?? "all";
    fillSelects();
    renderChrome();
    render();
  } catch (e) {
    $("#banner").innerHTML = `<div class="banner err">โหลดข้อมูลไม่ได้: ${esc(e.message)}</div>`;
  } finally {
    $("#refresh").disabled = false;
  }
}

document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-month],[data-group],[data-grade],[data-family],[data-item],[data-view],[data-clear],[data-close]");
  if (!t) {
    if (e.target === $("#detail")) $("#detail").close(); // click on backdrop
    return;
  }
  if (t.dataset.close !== undefined) return $("#detail").close();
  if (t.dataset.month) state.month = t.dataset.month;
  else if (t.dataset.group) {
    state.group = state.group === t.dataset.group ? "all" : t.dataset.group;
    state.grade = "all";
    if (state.group !== "all") state.sort = state.group;
    $("#sort").value = state.sort;
  } else if (t.dataset.grade) {
    state.grade = state.grade === t.dataset.grade ? "all" : t.dataset.grade;
    state.group = "all";
    if (state.grade !== "all") document.querySelector("#list").closest(".panel").scrollIntoView({ behavior: "smooth", block: "start" });
  } else if (t.dataset.family) {
    state.family = state.family === t.dataset.family ? "all" : t.dataset.family;
    $("#family").value = state.family;
  } else if (t.dataset.item) return openDetail(t.dataset.item);
  else if (t.dataset.view) {
    state.view = t.dataset.view;
    document.querySelectorAll(".seg button").forEach((b) => b.classList.toggle("on", b === t));
  } else if (t.dataset.clear) {
    state[t.dataset.clear] = t.dataset.clear === "q" ? "" : t.dataset.clear === "codeMismatch" ? false : "all";
    if (t.dataset.clear === "q") $("#q").value = "";
    if (t.dataset.clear === "brand") $("#brand").value = "all";
    if (t.dataset.clear === "family") $("#family").value = "all";
    if (t.dataset.clear === "location") $("#location").value = "all";
  }
  save();
  render();
});
$("#q").addEventListener("input", (e) => {
  state.q = e.target.value.trim();
  render();
});
for (const id of ["family", "brand", "location", "sort"]) {
  $("#" + id).addEventListener("change", (e) => {
    state[id] = e.target.value;
    save();
    render();
  });
}
$("#refresh").addEventListener("click", load);
$("#expToggle").addEventListener("click", () => {
  state.hideExpired = !state.hideExpired;
  save();
  render();
});
$("#mismatch").addEventListener("click", () => {
  state.codeMismatch = !state.codeMismatch;
  render();
});
if (SNAPSHOT?.expiredRemoved) {
  // exported without expired stock: nothing to show again, so hide the toggle too
  state.hideExpired = true;
  $("#expToggle").hidden = true;
}
if (SNAPSHOT) {
  // exported file: no server to refresh from or export again
  $("#refresh").hidden = true;
  $("#export").hidden = true;
}
$("#export").addEventListener("click", async () => {
  const btn = $("#export");
  const label = btn.textContent;
  btn.disabled = true;
  try {
    const { exportHtml } = await import("./export.js");
    // while "ซ่อนหมดอายุ" is on, the exported file leaves grade X out completely
    const { bytes, file } = await exportHtml(DATA, (msg) => (btn.textContent = msg), { removeExpired: state.hideExpired });
    btn.textContent = `✓ บันทึก ${file} (${(bytes / 1024 / 1024).toFixed(1)} MB)`;
    setTimeout(() => (btn.textContent = label), 6000);
  } catch (e) {
    btn.textContent = label;
    $("#banner").innerHTML = `<div class="banner err">ส่งออกไม่สำเร็จ: ${esc(e.message)}</div>`;
  } finally {
    btn.disabled = false;
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "/" && document.activeElement !== $("#q")) {
    e.preventDefault();
    $("#q").focus();
  }
});

load();
