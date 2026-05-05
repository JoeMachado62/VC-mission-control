#!/usr/bin/env bash

set -euo pipefail

timestamp="${1:-$(date -u +%Y%m%dT%H%M%SZ)}"
backup_root="/root/migration-backups/${timestamp}"
mc_data_target="/var/lib/mission-control"
oc_state_target="/root/.openclaw"

mkdir -p "${backup_root}" "${mc_data_target}" "${oc_state_target}"

echo "==> backing up current compose files"
cp /root/openclaw-mission-control/docker-compose.yml "${backup_root}/docker-compose.yml"
cp /root/openclaw-mission-control/Caddyfile "${backup_root}/Caddyfile"
cp /root/openclaw-mission-control/.env "${backup_root}/docker.env"

echo "==> exporting Mission Control data from Docker"
docker cp mission-control:/app/.data/. "${backup_root}/mission-control-data"
rsync -a "${backup_root}/mission-control-data/" "${mc_data_target}/"

echo "==> exporting OpenClaw state from Docker"
docker cp openclaw-gateway:/home/node/.openclaw/. "${backup_root}/openclaw-state"
rsync -a "${backup_root}/openclaw-state/" "${oc_state_target}/"

echo "==> securing host OpenClaw state"
chmod 700 "${oc_state_target}"
if [[ -f "${oc_state_target}/openclaw.json" ]]; then
  chmod 600 "${oc_state_target}/openclaw.json"
fi

echo "==> migration staging complete"
echo "Backup root: ${backup_root}"
echo "Mission Control data: ${mc_data_target}"
echo "OpenClaw state: ${oc_state_target}"
