// ส่งออกแดชบอร์ดเป็นไฟล์ HTML ไฟล์เดียว (ข้อมูล รูปย่อ ฟอนต์ ฝังอยู่ในไฟล์) ส่งให้คนอื่นดับเบิลคลิกเปิดได้เลย
// ทำในเบราว์เซอร์ทั้งหมด: ย่อรูปด้วย canvas จึงไม่ต้องติดตั้ง package เพิ่ม

const IMG_MAX = 480; // px, enough for cards and the detail dialog
const FONT_SUBSETS = /^(sarabun|inter)-(thai|latin)-\d/; // Thai + basic Latin only, skip cyrillic/greek/vietnamese/latin-ext

const blobToDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });

async function fileDataUrl(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`โหลด ${url} ไม่ได้`);
  return blobToDataUrl(await res.blob());
}

async function shrinkImage(url) {
  // createImageBitmap decodes off-screen; img.decode() can wait forever while the tab is not being painted
  const res = await fetch(url);
  if (!res.ok) throw new Error(`โหลด ${url} ไม่ได้`);
  const img = await createImageBitmap(await res.blob());
  const scale = Math.min(1, IMG_MAX / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * scale);
  c.height = Math.round(img.height * scale);
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const webp = c.toDataURL("image/webp", 0.82);
  if (webp.startsWith("data:image/webp")) return webp;
  // browsers without WebP encoding: JPEG on white
  ctx.globalCompositeOperation = "destination-over";
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.85);
}

/** Inline the @fontsource CSS for one family/weight with its woff2 files as data URLs. */
async function fontCss(family, weight) {
  const css = await (await fetch(`/fonts/${family}/${weight}.css`)).text();
  const blocks = css.split("/* ").filter((b) => FONT_SUBSETS.test(b));
  const out = [];
  for (const b of blocks) {
    const m = /url\(\.\/files\/([^)]+\.woff2)\)/.exec(b);
    if (!m) continue;
    const data = await fileDataUrl(`/fonts/${family}/files/${m[1]}`);
    out.push("/* " + b.replace(/src:[^;]+;/, `src: url(${data}) format('woff2');`));
  }
  return out.join("\n");
}

const pad = (n) => String(n).padStart(2, "0");

/** Remove grade X from the exported data itself (not just hidden), so the file cannot show it. */
function dropExpired(snap) {
  const keys = snap.grades.filter((g) => g.group === "expired").map((g) => g.key);
  snap.rows = snap.rows
    .map((r) => {
      const qty = { ...r.qty };
      const expiry = { ...r.expiry };
      let total = r.total;
      for (const k of keys) {
        total -= qty[k] || 0;
        delete qty[k];
        delete expiry[k];
      }
      return { ...r, qty, expiry, total };
    })
    .filter((r) => r.total > 0);
  const used = new Set(snap.rows.map((r) => r.itemKey));
  for (const k of Object.keys(snap.items)) if (!used.has(k)) delete snap.items[k];
  for (const m of snap.months) for (const k of keys) delete m.gradeNotes?.[k];
  snap.expiredRemoved = true;
}

/**
 * Build the standalone HTML and start the download.
 * @param {object} data   the /api/data payload currently shown
 * @param {(msg: string) => void} progress
 */
export async function exportHtml(data, progress = () => {}, { removeExpired = false } = {}) {
  const snap = structuredClone(data);
  snap.exportedAt = new Date().toISOString();
  if (removeExpired) dropExpired(snap);

  // 1) images → small embedded copies (same picture shared by several SKUs is encoded once)
  const items = Object.values(snap.items).filter((i) => i.image);
  const cache = new Map();
  let done = 0;
  for (const it of items) {
    const src = it.image.lg || it.image.sm;
    if (!cache.has(src)) {
      try {
        cache.set(src, await shrinkImage("/" + src));
      } catch {
        cache.set(src, null);
      }
    }
    const url = cache.get(src);
    it.image = url ? { sm: url } : null; // one copy only: the page falls back to sm when lg is missing
    progress(`ย่อรูป ${++done}/${items.length}`);
  }

  // 2) fonts, styles, script, logo
  progress("ฝังฟอนต์…");
  const fonts = [];
  for (const fam of ["sarabun", "inter"]) for (const w of [400, 600, 700]) fonts.push(await fontCss(fam, w));
  const [css, appJs, page, logo, favicon] = await Promise.all([
    fetch("/styles.css").then((r) => r.text()),
    fetch("/app.js").then((r) => r.text()),
    fetch("/index.html").then((r) => r.text()),
    fileDataUrl("/jlc-logo.png"),
    fileDataUrl("/favicon.png"),
  ]);

  // 3) assemble — use replacer functions so "$" in the data is never treated as a pattern
  const json = JSON.stringify(snap).replace(/</g, "\\u003c");
  const script = appJs.replace(/<\/script/gi, "<\\/script");
  const d = new Date();
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  let html = page
    .replace(/\s*<link rel="stylesheet"[^>]*>/g, "")
    .replace('href="favicon.png"', () => `href="${favicon}"`)
    .replace('src="jlc-logo.png"', () => `src="${logo}"`)
    .replace(/<title>[^<]*<\/title>/, () => `<title>CN Dashboard · JLC (ข้อมูล ${stamp})</title>`)
    .replace("</head>", () => `<style>\n${fonts.join("\n")}\n${css}\n</style>\n</head>`)
    .replace('<script src="app.js" type="module"></script>', () => `<script>window.__CN_DATA__ = ${json};</script>\n<script type="module">\n${script}\n</script>`);

  progress("กำลังบันทึก…");
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `CN-Dashboard-${stamp}.html`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  return { bytes: blob.size, file: a.download };
}
