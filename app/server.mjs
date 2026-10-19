// CN Dashboard — ตัวเปิดใช้งานบนเครื่อง
// - เปิดหน้าเว็บที่ http://localhost:5230 (รับเฉพาะเครื่องนี้ 127.0.0.1) ถ้าพอร์ตไม่ว่างจะหาพอร์ตว่างถัดไปถึง 5237
//   (5238–5239 เก็บไว้ให้เซิร์ฟเวอร์ทดสอบ)
// - อ่าน "คัดงานCN.xlsx" ใหม่ทุกครั้งที่ไฟล์เปลี่ยน แค่วางไฟล์ใหม่ทับแล้วกดรีเฟรช
// - ชื่อและรูปสินค้าอ่านจาก ../jlc-product-info (อ่านอย่างเดียว ไม่แก้อะไรในโปรเจกต์นั้น)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildData } from "./lib/build-data.mjs";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(DIR, "..");
const PUBLIC = path.join(DIR, "public");
const FONTS = path.join(REPO, "node_modules", "@fontsource");
// Product names/photos: $PRODUCT_INFO_DIR, else "product-info/" inside this project (from the data bundle,
// see scripts/make-bundle.mjs), else the jlc-product-info project next to this one.
const BUNDLED_INFO = path.join(REPO, "product-info");
const PRODUCT_INFO = path.resolve(
  process.env.PRODUCT_INFO_DIR || (fs.existsSync(BUNDLED_INFO) ? BUNDLED_INFO : path.join(REPO, "..", "jlc-product-info")),
);
const CATALOG = path.join(PRODUCT_INFO, "data", "build", "catalog.internal.json");
const MEDIA = path.join(PRODUCT_INFO, "web", "public", "media");
const SKU_MAP = path.join(REPO, "data", "sku-map.json");
const EXTRACTS = path.join(REPO, "data", "extracts.json");
// Extra product photos dropped in the product-info folder, named with the code in brackets: "เซรั่มขิงดำ - หลอด (JH707-40g).jpg"
const EXTRA_IMAGES = PRODUCT_INFO;
const APP_ID = "jlc-cn-stock";

const FIRST_PORT = Number(process.env.PORT) || 5230;
const LAST_PORT = process.env.PORT ? FIRST_PORT : 5237;
const HOST = "127.0.0.1";
const OPEN = process.argv.includes("--open");

/** The CN file: $CN_XLSX, else "คัดงานCN.xlsx", else the newest .xlsx in the project folder. */
function cnFile() {
  if (process.env.CN_XLSX) return path.resolve(process.env.CN_XLSX);
  const preferred = path.join(REPO, "คัดงานCN.xlsx");
  if (fs.existsSync(preferred)) return preferred;
  const xs = fs
    .readdirSync(REPO)
    .filter((f) => f.toLowerCase().endsWith(".xlsx") && !f.startsWith("~$"))
    .map((f) => path.join(REPO, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return xs[0] ?? preferred;
}

const mtime = (p) => {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return 0;
  }
};

// Re-read only when one of the inputs changed.
let cache = { stamp: "", data: null };
function getData() {
  const xlsx = cnFile();
  const stamp = [xlsx, mtime(xlsx), mtime(CATALOG), mtime(SKU_MAP), mtime(EXTRACTS), mtime(EXTRA_IMAGES)].join("|");
  if (cache.stamp !== stamp) {
    cache = { stamp, data: buildData({ xlsx, catalogFile: CATALOG, skuMapFile: SKU_MAP, extraImageDir: EXTRA_IMAGES, extractsFile: EXTRACTS }) };
  }
  return cache.data;
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

/** Serve a file from `root`, refusing anything that resolves outside it. */
function sendFile(res, root, rel, cacheSeconds = 0) {
  const file = path.resolve(root, "." + path.posix.normalize("/" + rel));
  if (!file.startsWith(path.resolve(root) + path.sep)) return send(res, 403, "forbidden");
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, "not found");
    res.writeHead(200, {
      "content-type": TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream",
      "content-length": st.size,
      "cache-control": cacheSeconds ? `public, max-age=${cacheSeconds}` : "no-cache",
    });
    fs.createReadStream(file).pipe(res);
  });
}

function send(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
}
const json = (res, status, obj) => send(res, status, JSON.stringify(obj), "application/json; charset=utf-8");

const server = http.createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "read only");
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, "http://x").pathname);
  } catch {
    return send(res, 400, "bad url");
  }
  if (pathname === "/api/health") return json(res, 200, { app: APP_ID, ok: true });
  if (pathname === "/api/data") {
    try {
      return json(res, 200, getData());
    } catch (e) {
      const msg = e.code === "ENOENT" ? `ไม่พบไฟล์ ${path.basename(cnFile())} ในโฟลเดอร์โปรเจกต์` : e.code === "EBUSY" ? "ไฟล์ Excel ถูกเปิดค้างอยู่ ปิดไฟล์ก่อนแล้วกดรีเฟรช" : String(e.message ?? e);
      return json(res, 500, { error: msg });
    }
  }
  if (pathname.startsWith("/media/")) return sendFile(res, MEDIA, pathname.slice("/media/".length), 86400);
  if (pathname.startsWith("/extra/")) {
    // only image files directly in the product-info folder, nothing else from it
    const name = pathname.slice("/extra/".length);
    if (name.includes("/") || name.includes("\\") || !/\.(jpe?g|png|webp)$/i.test(name)) return send(res, 404, "not found");
    return sendFile(res, EXTRA_IMAGES, name, 3600);
  }
  if (pathname.startsWith("/fonts/")) return sendFile(res, FONTS, pathname.slice("/fonts/".length), 86400);
  return sendFile(res, PUBLIC, pathname === "/" ? "index.html" : pathname.slice(1));
});

/** Is our own dashboard already answering on this port? */
function isOurs(port) {
  return new Promise((resolve) => {
    const r = http.get({ host: HOST, port, path: "/api/health", timeout: 800 }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(body).app === APP_ID);
        } catch {
          resolve(false);
        }
      });
    });
    r.on("error", () => resolve(false));
    r.on("timeout", () => (r.destroy(), resolve(false)));
  });
}

function openBrowser(url) {
  const cmd = process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  spawn(cmd[0], cmd[1], { stdio: "ignore", detached: true }).unref();
}

async function start(port) {
  if (port > LAST_PORT) {
    console.error(`พอร์ต ${FIRST_PORT}–${LAST_PORT} ไม่ว่างทั้งหมด ปิดโปรแกรมที่ใช้พอร์ตเหล่านี้ก่อน`);
    process.exit(1);
  }
  if (await isOurs(port)) {
    const url = `http://localhost:${port}/`;
    console.log(`CN Dashboard เปิดอยู่แล้วที่ ${url}`);
    if (OPEN) openBrowser(url);
    return;
  }
  server.once("error", (e) => {
    if (e.code === "EADDRINUSE") start(port + 1); // someone else's app: never touch it, take the next port
    else throw e;
  });
  server.listen(port, HOST, () => {
    const url = `http://localhost:${port}/`;
    console.log(`CN Dashboard: ${url}`);
    console.log(`ไฟล์ CN: ${cnFile()}`);
    console.log(fs.existsSync(CATALOG) ? `แคตาล็อก: ${CATALOG}` : `ไม่พบแคตาล็อก (${CATALOG}) จะใช้ชื่อจาก Excel และไม่มีรูป`);
    console.log("กด Ctrl+C เพื่อปิด");
    if (OPEN) openBrowser(url);
  });
}

start(FIRST_PORT);
