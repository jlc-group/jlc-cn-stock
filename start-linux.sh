#!/usr/bin/env bash
# CN Dashboard — ตัวเปิดสำหรับ Linux / macOS (Windows ใช้ "เปิด CN Dashboard.bat")
#   bash start-linux.sh      หรือ   ./start-linux.sh
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo
  echo "  ไม่พบ Node.js — ติดตั้งก่อน (ต้องเวอร์ชัน 18 ขึ้นไป) เช่น"
  echo "    Ubuntu/Debian:  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs"
  echo "    หรือดูวิธีอื่นที่ https://nodejs.org"
  echo
  exit 1
fi

major=$(node -p 'process.versions.node.split(".")[0]')
if [ "$major" -lt 18 ]; then
  echo "  Node.js ในเครื่องเป็นเวอร์ชัน $(node -v) เก่าเกินไป ต้องเวอร์ชัน 18 ขึ้นไป"
  exit 1
fi

if [ ! -d node_modules/xlsx ]; then
  echo "  ติดตั้งครั้งแรก กำลังรัน npm install ..."
  npm install --no-fund --no-audit
fi

exec node app/server.mjs --open
