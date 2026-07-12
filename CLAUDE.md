# JAMROOM — Contexto do Projeto (leia antes de qualquer tarefa)

> Este arquivo existe para que qualquer agente (independente do modelo) consiga continuar o
> trabalho exatamente de onde parou, sem depender do histórico de conversa. Sempre que uma
> decisão nova for tomada com o usuário, ou uma fase for concluída, **atualize este arquivo**.

## 1. O que é o produto

SaaS de karaokê cobrado por uso diário (nome do produto: **JAMROOM**). Diferencial: modo
**"Jam/Party"** — várias pessoas no mesmo local entram numa sessão via código/QR (sem conta),
adicionam músicas a uma fila compartilhada, e uma tela host (TV/projetor) exibe vídeo com letra
sincronizada estilo karaokê. Ao final de cada música o sistema calcula uma pontuação por
**afinação real captada pelo microfone** (não simulada) e mantém um ranking ao vivo. Plano futuro
(fora do MVP): locação de equipamento físico (mics, caixas de som).

Documento completo do plano original: `C:\Users\danie\.claude\plans\claude-eu-queria-criar-cozy-hopcroft.md`
Descritivo de produto e telas por superfície: `docs/produto-descritivo-telas.md`
Design system completo: `docs/layoutDesc_extracted.txt` (+ `docs/layout.png`, `docs/layoutDesc.docx`)

### Personas
- **Operador da plataforma** — gerencia catálogo, licenciamento, financeiro (Painel Admin).
- **Anfitrião** — cliente pagante, compra crédito/dia, cria e controla a Jam.
- **Participante** — convidado sem conta, entra via código/QR, canta, vê pontuação/ranking.

### Decisões já validadas com o usuário (não reabrir sem motivo forte)
- Fonte de músicas: catálogo licenciado B2B (Karaoke Version / KaraFun B2B / Singa) como base +
  upload próprio licenciado. **YouTube embed descartado** (ToS + sem stem de áudio para pitch).
- Pontuação: análise real de voz/afinação (pitch detection real), explicitamente não simulada.
- Pagamentos: foco Brasil (Pix/boleto/cartão), gateway Pagar.me ou Mercado Pago, modelo de
  pacote/crédito de dia pré-pago (não assinatura). **Usuário pediu em 2026-07-11 para NÃO
  implementar pagamentos/assinaturas por enquanto — foco em Jam + pontuação.**
- Identidade visual definida (seção 4) — streaming premium, nunca "karaokê anos 2000".

## 2. Arquitetura atual (implementada e funcionando)

Monorepo npm workspaces (sem Turborepo — decisão pragmática; reavaliar se o build ficar lento):

| Pasta | Papel | Status |
|---|---|---|
| `apps/web` | Site institucional (Next.js 16, porta 3000) | **Completo**: Hero, FeaturesBar, Como funciona, Demonstração, Planos, FAQ, Footer |
| `apps/api` | Backend da Jam — Node + Socket.io (porta 4001) | **Funcional (MVP)**: sessões, fila, leaderboard, relay de pitch, catálogo demo. Estado em memória |
| `apps/host` | Tela TV — Next.js (porta 3001) | **Funcional**: lobby com código+QR, player com letra sincronizada + melodia sintetizada, resultado, leaderboard, encerramento |
| `apps/participant` | Mobile-web do participante — Next.js (porta 3002) | **Funcional**: entrar por código/QR, nome, fila, adicionar música, "sua vez" com mic + pitch detection + score real, resultado, ranking |
| `apps/admin` | Painel admin | **Vazio** — não iniciado |
| `packages/shared-types` | Contratos: Song, Jam, QueueItem, PitchCurve, ScoreResult, eventos socket | **Completo** — fonte única do protocolo |
| `packages/ui` | `@jamroom/ui`: Button, Card, Badge, Avatar, cn | **Base pronta** — faltam Input, Modal, Toast, Table etc. |
| `packages/config` | `@jamroom/config`: preset Tailwind (tokens) + tsconfig base | **Completo** |
| `services/audio-processing` | Pipeline Python: Demucs + pyin + faster-whisper | **Funcional** — ver README do serviço; já processou 2 músicas reais |

### Como rodar (4 processos)
```bash
npm run dev:api          # backend da Jam em :4001
npm run dev:host         # tela da TV em :3001
npm run dev:participant  # app do celular em :3002
npm run dev:web          # landing em :3000 (independente dos demais)
```
Fluxo manual: abrir `http://localhost:3001` → "Abrir uma Jam nesta tela" → no celular/aba mobile
abrir `https://localhost:3002/?code=XXXX` (ou escanear o QR) → nome → adicionar música → a TV
inicia sozinha (countdown 5s) → no celular "Liberar microfone e cantar".

**HTTPS local (obrigatório para o microfone no celular)**: getUserMedia só existe em contexto
seguro, então participant e API rodam com o certificado self-signed de `certs/` (gitignored;
regenerar com o comando openssl abaixo se o IP mudar). API sobe em HTTPS automaticamente quando
`certs/dev.key`/`dev.crt` existem; participant usa `next dev --experimental-https` (script `dev`).
```bash
openssl req -x509 -newkey rsa:2048 -nodes -keyout certs/dev.key -out certs/dev.crt -days 825 \
  -subj "//CN=jamroom-dev" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:<IP-DA-MAQUINA>"
```
**Em rede local** (celulares de verdade): exportar `NEXT_PUBLIC_PARTICIPANT_URL=https://<IP>:3002`
para o host (QR aponta para lá) e `NEXT_PUBLIC_API_URL=https://<IP>:4001` para host e participant.
No celular, aceitar o aviso de certificado 2x (uma vez em `https://<IP>:4001/health`, outra na
página do participant); no PC, aceitar 1x para o host falar com a API. Também: `allowedDevOrigins`
com o IP nos `next.config.ts` (Next 16 bloqueia assets de dev cross-origin) e regra de firewall
inbound TCP 3001/3002/4001 (perfil Privado). IP atual configurado: 192.168.15.14.

### Testes (executar após mudanças no protocolo/scoring)
```bash
node scripts/test-protocol.mjs     # protocolo socket completo (API precisa estar de pé)
npx tsx scripts/test-scoring.ts    # algoritmo de score com performances sintéticas
python scripts/test-jam-flow.py    # fluxo real em navegador (api+host+participant de pé; Playwright)
python scripts/test-real-song.py   # música real: áudio na TV + letra Whisper + mic (não espera a música toda)
```
Última execução completa: 2026-07-11, tudo verde (score real validado: cantor perfeito=1000,
oitava acima=1000, desafinado 3 semitons=242, mudo=0; mic fake do Chromium → 21 pts, coerente).

### Músicas reais (pipeline de ingestão)
`services/audio-processing/pipeline.py` (ver README do serviço): entrada = gravação original
com voz (+ instrumental karaokê opcional) → Demucs isola o vocal → librosa.pyin extrai a curva
de pitch → segmentação em `MelodyNote[]` → faster-whisper gera a letra sincronizada → grava
`apps/api/media/<id>.json` + `<id>.mp3`. A API carrega tudo de `apps/api/media/` na
inicialização e serve os áudios em `/media/*` (com Range). A TV toca o instrumental real
(`song.audioUrl`) em vez do synth e reancora o relógio do score via `host:playback_started`.
**Já processadas**: "Knock" e "Orbit" (Josh Woodward, **CC BY 4.0** — atribuição obrigatória,
campo `attribution`; fonte: Internet Archive, itens `pandacd-706-addressed-to-the-stars` e
`cover_Josh_Woodward_-_Addressed_to_the_Stars`, o álbum inteiro tem 14 faixas com par
vocal+instrumental oficial). Dependências Python: `pip install -r services/audio-processing/requirements.txt`
(torch CPU já instalado nesta máquina). **Só processar áudio licenciado** — para uso comercial,
catálogo B2B + ECAD (Seção 1 do plano).

### Decisões técnicas do MVP da Jam (e o upgrade path de cada uma)
- **Backend**: Node puro + Socket.io (não NestJS como no plano — menos boilerplate para o MVP).
  Estado **em memória** (`apps/api/src/store.ts`); migrar para Redis (fila/leaderboard/presença)
  + Postgres (histórico) sem mudar o protocolo de `@jamroom/shared-types`.
- **Catálogo híbrido**: 5 cantigas demo (grade MIDI hardcoded em `apps/api/src/catalog.ts`,
  playback sintetizado) + músicas reais processadas pelo pipeline em `apps/api/media/*.json`
  (playback de instrumental MP3 real). O mesmo formato `Song` cobre os dois casos — a
  diferença é só `audioUrl` presente ou não. Com catálogo B2B: mover os JSONs para Postgres.
- **Pitch detection**: 100% client-side no celular (privacidade/latência/custo, decisão do plano).
  AudioWorklet + autocorrelação NSDF/McLeod em JS puro (`apps/participant/src/lib/pitchDetector.ts`),
  janela 2048, decimação 3x, faixa 80–1000 Hz. Trocar por pYIN/aubio-WASM não muda a interface.
- **Scoring** (`apps/participant/src/lib/scoring.ts`): tolerante a oitava, hit ≤1 semitom (meio
  crédito ≤1.75), folga de timing ±250ms (relógios host/celular não são sincronizados), ponderado
  pela confiança do detector, score = accuracy × 1000. Servidor aplica fallback de score 0 após
  8s se o cantor sumir (Jam nunca trava).
- **Fluxo da TV é autônomo**: countdown de 5s inicia a próxima da fila, resultado fica 8s e volta.
  A TV é "um palco" (sem interação); o controle remoto do anfitrião virá com o dashboard.
- **Sem auth ainda**: qualquer um cria Jam. Auth entra junto com o dashboard do anfitrião.
- **"Voz na TV" (protótipo v2, 2026-07-12)**: toggle experimental no SingView transmite a voz
  do cantor para a TV (celular como microfone). v1 usava track Opus do WebRTC — o jitter
  buffer NetEq do Chrome tem piso de ~40–80ms e o usuário mediu >150ms em hardware real.
  v2 fura esse piso: **PCM Int16 cru em pacotes de 8ms via RTCDataChannel não-confiável/
  não-ordenado**, playback na TV por AudioWorklet com **ring buffer próprio de 30ms**
  (resampling linear entre taxas; excesso descartado — atraso nunca acumula; underrun
  reacumula até o alvo). Captura crua no celular, saída WebAudio "interactive" + reverb
  curto (mascara o residual). Medidor na TV mostra números medidos (buffer real + RTT/2 +
  saída). Sinalização via Socket.io (mesmos eventos mic_signal). Arquivos:
  `apps/participant/src/lib/tvMic.ts`, `apps/host/src/lib/micReceiver.ts`. Teste:
  `python scripts/test-tv-mic.py` (headless: estável 57–87ms). Fatores fora do código que
  dominam a latência real: caixa Bluetooth (+100–300ms — usar HDMI/cabo), "modo jogo" da TV
  (TVs processam áudio, 20–100ms), Wi-Fi 5GHz. Mic dedicado (Fase 4) segue sendo o premium.

## 3. O que NÃO foi feito (pendências conhecidas)
- `apps/admin` (CRUD de catálogo, gestão de licenciamento, monitor de jams) — pasta vazia.
- Dashboard do Anfitrião (conta, criar Jam a partir do dashboard, controle remoto da Jam,
  histórico/relatórios) — não existe; hoje a própria tela da TV cria a sessão.
- Autenticação (admin/anfitrião) — não existe.
- Persistência (Postgres/Redis) — estado em memória; reiniciou a API, perdeu as jams.
- **Pagamentos/monetização (Fase 3) — explicitamente adiado a pedido do usuário (2026-07-11).**
- Catálogo B2B licenciado — a negociação com fornecedor segue sendo o gargalo de lead time.
  O pipeline técnico de ingestão **já existe e funciona** (2 músicas CC processadas).
- Vídeo no player (hoje: áudio real + fundo gradiente para músicas reais; synth para demos).
- Letra sincronizada por palavra/sílaba (hoje é por linha, via segmentos do Whisper).
- Repositório git **não inicializado**.

## 4. Design System — regras obrigatórias para qualquer UI nova

Fonte completa: `docs/layoutDesc_extracted.txt`. Tokens em `packages/config/tailwind-preset.js` —
**sempre usar o preset**, nunca hardcodar cores/spacing fora dele. Resumo:
- Dark sempre: bg `#09090B`/`#121216`, cards `#18181B`, bordas `#2A2A32`, texto `#FFF`/`#B3B3BC`.
  Primária roxo `#7C3AED` (hover `#8B5CF6`), azul `#3B82F6` só em detalhes.
- Fonte única (Plus Jakarta Sans via `next/font`); radius 14/16/20 (nunca reto); sombras suaves;
  glass só em modais/overlays/player/leaderboard (blur 8px); grid de 8px; ícones traço fino
  (inline SVGs em `apps/web/src/components/icons.tsx`); microinterações 200–300ms.
- Referências por superfície: Landing = streaming; TV = "um palco" (fontes enormes, pouquíssimos
  elementos, nunca dashboard); Mobile = Spotify (entrar→nome→música em <30s, botão principal
  fixo); Admin = Linear/GitHub/Vercel (denso, tabular).
- Reaproveitar `@jamroom/ui` + preset em qualquer app novo (ver `apps/*/tailwind.config.js`).

## 5. Roadmap (estado em 2026-07-11)

- **Fase 0 — Fundações**: parcial. Feito: landing completa, design system, monorepo. Pendente:
  auth, admin, pipeline. A negociação B2B segue sendo o item de maior lead time.
- **Fase 1 — Jam/Party core**: **FEITA** (código/QR, fila em tempo real, tela host, leaderboard).
- **Fase 2 — Scoring real por pitch**: **FEITA**, incluindo o pipeline de ingestão
  (Demucs + pyin + Whisper) com 2 músicas reais processadas. Pendente: testes em ambiente
  ruidoso de verdade e feature flag score simulado/real por sessão.
- **Fase 3 — Monetização**: **adiada a pedido do usuário**.
- **Fase 4 — Locação de equipamentos**: fora do escopo.

### Próximos passos recomendados
1. Testar a Jam com microfone real (a validação automatizada usou o fake device do Chromium) e
   calibrar tolerâncias do scoring (`CLARITY_MIN`, limiares de hit) com voz de verdade —
   agora dá para cantar "Knock"/"Orbit" com áudio real.
2. `git init` + primeiro commit (não há controle de versão!). Considerar gitignore para
   `apps/api/media/` e `services/audio-processing/input/` (arquivos de áudio grandes).
3. Processar as outras 12 faixas do álbum CC do Josh Woodward (comando no README do serviço;
   ~3 min/faixa em CPU) para encher o catálogo de teste.
4. Dashboard do Anfitrião + auth (destrava o fluxo de produto real: conta → criar Jam → TV).
5. `apps/admin` com CRUD de catálogo simples (prepara a entrada do catálogo licenciado).
6. Persistência (Redis para estado vivo, Postgres para histórico) atrás do `store.ts` atual.
7. Extrair componentes repetidos das três apps (barra de afinação, leaderboard, tabs) para
   `@jamroom/ui`.

## 6. Convenções observadas (seguir ao continuar)
- Nome do produto: **JAMROOM** (pacotes `@jamroom/*`). Copy de produto e comentários em pt-BR;
  código (identificadores) em inglês.
- Protocolo cliente-servidor: mudar SEMPRE começando por `packages/shared-types/src/index.ts`
  (tipos + eventos), depois api, depois clients. Rodar `scripts/test-protocol.mjs` após.
- `apps/web/AGENTS.md` (e o padrão vale para host/participant, mesma versão do Next): não presumir
  API do Next.js 16 por conhecimento de treino — conferir `node_modules/next/dist/docs/`.
  Já confirmado: Turbopack default, `params` de rota é `Promise` (usar `React.use()` em client
  components), Node 20.9+.
- Typecheck por app: `npx tsc --noEmit` dentro de `apps/api`, `apps/host`, `apps/participant`.
- Screenshots de verificação visual ficam em `C:\Users\danie\AppData\Local\Temp\claude\karaoke-shots`
  (scripts `shot_landing.py`/`shot_viewport.py` lá; testes oficiais em `scripts/`).
