#!/bin/bash
# Double-click to install, set up and start EventOS on this Mac.
cd "$(dirname "$0")" || exit 1
pause() { echo; read -n 1 -s -r -p "Press any key to close."; exit 1; }

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Install version 20 or higher from https://nodejs.org, then double-click this file again."
  pause
fi
major=$(node -p "process.versions.node.split('.')[0]")
if [ "$major" -lt 20 ]; then
  echo "Node $(node -v) is too old. Install version 20 or higher from https://nodejs.org."
  pause
fi
echo "== Node $(node -v)"

echo "== Installing dependencies (a minute or two the first time)"
npm install --no-audit --no-fund || { echo "Install failed."; pause; }
[ -f .env ] || cp .env.example .env

echo "== Setting up the database and accounts"
npm run db:seed 2>&1 | tee -a seed-output.txt || { echo "Setup failed."; pause; }
echo "== Sign-in details and your API key are in seed-output.txt in this folder. Keep it private."

echo "== Running the tests"
npm test 2>&1 | tee test-output.txt

echo "== Starting EventOS at http://localhost:3000 (close this window to stop it)"
(sleep 6; open http://localhost:3000) &
npm run dev
