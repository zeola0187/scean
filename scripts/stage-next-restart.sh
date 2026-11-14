#!/usr/bin/env bash
# Rebuild, stop the isolated harness gracefully, and start it again (data kept).
set -e
cd "$(dirname "$0")/.."
node scripts/dev-build.mjs | tail -1
L=evidence/${1:-stage-next-dev}
if [ -f "$L/launch.json" ]; then touch "$L/stop-request"; for i in $(seq 1 60); do [ -f "$L/exit.json" ] && break; sleep 1; done; fi
rm -f "$L/exit.json" "$L/stop-request" "$L/launch.json"
