# Dockerfile da API do Kantaí (apps/api) — deploy no Railway.
#
# Node (Socket.io) + Python (yt-dlp/Demucs/ffmpeg) na mesma imagem porque
# a importação ao vivo do YouTube spawna esses scripts como subprocesso.
#
# Deploy: como apps/api/media e apps/api/data são gitignored (não existem
# no GitHub), este serviço é enviado via `railway up` (upload direto do
# diretório local, não do repositório) — inclui o catálogo atual (~2GB)
# como "semente" (ver docker/api-entrypoint.sh), copiada para o volume
# persistente montado em /data na primeira execução.
FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg python3 python3-pip \
    && ln -sf /usr/bin/python3 /usr/bin/python \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# monorepo inteiro (respeita .dockerignore — sem node_modules/.git/cache
# de download do YouTube, que não precisa ir pra imagem)
COPY . .

RUN npm install
# torch CPU-only ANTES do resto — sem isso, o resolver do pip puxa a build
# com CUDA (centenas de MB extras de toolkit/cudnn) mesmo sem GPU disponível
# no host (Railway é CPU-only). Mesma abordagem do ambiente local do usuário.
RUN pip3 install --break-system-packages --no-cache-dir \
      torch --index-url https://download.pytorch.org/whl/cpu
RUN pip3 install --break-system-packages --no-cache-dir \
      -r services/audio-processing/requirements.txt

# catálogo/estado atuais viram "semente": saem do caminho onde o volume
# persistente vai ser montado (senão o volume vazio os esconderia)
RUN mkdir -p /app/seed/media /app/seed/state \
    && (mv /app/apps/api/media/* /app/seed/media/ 2>/dev/null || true) \
    && (mv /app/apps/api/data/* /app/seed/state/ 2>/dev/null || true)

ENV NODE_ENV=production
ENV KANTAI_MEDIA_DIR=/data/media
ENV KANTAI_DATA_DIR=/data/state
# HTTP_PORT=0 desativa o espelho HTTP puro (só existe pra TVs sem suporte
# a cert self-signed em dev local — o Railway já entrega HTTPS de verdade)
ENV HTTP_PORT=0

RUN chmod +x docker/api-entrypoint.sh

EXPOSE 4001
ENTRYPOINT ["docker/api-entrypoint.sh"]
CMD ["npm", "run", "start", "--workspace=api"]
