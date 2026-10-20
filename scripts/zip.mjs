// Minimal zip writer (deflate, UTF-8 file names) using only Node built-ins.
// Windows' tar.exe writes Thai names without the UTF-8 flag, so they come out garbled on some machines.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const UTF8_FLAG = 0x0800;
// "made by Unix" + Unix mode bits, so Linux/macOS unzip keeps .sh files executable (Windows ignores them)
const MADE_BY_UNIX = (3 << 8) | 20;
const unixAttrs = (name) => ((name.endsWith(".sh") ? 0o100755 : 0o100644) << 16) >>> 0;

function dosTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

function walk(dir, base = "") {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${e.name}` : e.name;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full, rel));
    else if (e.isFile()) out.push({ rel, full });
  }
  return out;
}

/** Zip every file under `srcDir` into `zipPath` (paths stored relative to srcDir). Returns the file count. */
export function zipDirectory(srcDir, zipPath) {
  const files = walk(srcDir);
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const data = fs.readFileSync(f.full);
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const useDeflate = deflated.length < data.length; // images are already compressed: store them
    const body = useDeflate ? deflated : data;
    const name = Buffer.from(f.rel, "utf8");
    const crc = zlib.crc32(data);
    const { time, day } = dosTime(fs.statSync(f.full).mtime);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(UTF8_FLAG, 6);
    local.writeUInt16LE(useDeflate ? 8 : 0, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, name, body);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(MADE_BY_UNIX, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(UTF8_FLAG, 8);
    cen.writeUInt16LE(useDeflate ? 8 : 0, 10);
    cen.writeUInt16LE(time, 12);
    cen.writeUInt16LE(day, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(body.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(name.length, 28);
    cen.writeUInt32LE(unixAttrs(f.rel), 38);
    cen.writeUInt32LE(offset, 42);
    central.push(cen, name);

    offset += local.length + name.length + body.length;
  }
  const cenSize = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cenSize, 12);
  end.writeUInt32LE(offset, 16);
  fs.writeFileSync(zipPath, Buffer.concat([...chunks, ...central, end]));
  return files.length;
}
