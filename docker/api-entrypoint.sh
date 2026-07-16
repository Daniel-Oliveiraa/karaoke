#!/bin/sh
# Semeia o volume persistente (/data) com o catálogo/estado que veio
# junto na imagem, na PRIMEIRA execução (volume novo = vazio). Em
# execuções seguintes o volume já tem dados e nada é sobrescrito — assim
# novas músicas importadas ao vivo (ou o estado de Jams) sobrevivem a
# redeploys.
set -e

seed_if_empty() {
  target="$1"
  seed="$2"
  mkdir -p "$target"
  if [ -z "$(ls -A "$target" 2>/dev/null)" ]; then
    echo "[entrypoint] semeando $target a partir de $seed..."
    cp -r "$seed"/. "$target"/ 2>/dev/null || true
  fi
}

seed_if_empty /data/media /app/seed/media
seed_if_empty /data/state /app/seed/state

exec "$@"
