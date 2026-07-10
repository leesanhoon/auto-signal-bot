#!/usr/bin/env bash
# Cập nhật code mới nhất và rebuild container.
# Chạy trên VM Ubuntu: ./deploy/update.sh
set -euo pipefail
cd "$(dirname "$0")/.."

git pull --ff-only
docker compose build bot
docker compose up -d
docker image prune -f

echo "Done. Trạng thái:"
docker compose ps
