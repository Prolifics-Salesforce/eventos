#!/bin/bash
# Double-click to add sample events, guests, leads and agent activity to an empty instance.
# Close the EventOS window first: only one program can use the database at a time.
cd "$(dirname "$0")" || exit 1
[ -d node_modules ] || npm install --no-audit --no-fund
npm run db:seed >/dev/null 2>&1
npm run db:demo 2>&1 | grep -E "Sample data|already has|Error"
echo
echo "Done. Now double-click start.command."
read -n 1 -s -r -p "Press any key to close."
