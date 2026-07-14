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
| `apps/api` | Backend da Jam — Node + Socket.io, HTTPS (porta 4001) | **Funcional**: sessões, fila, leaderboard, relay de pitch e de sinalização WebRTC, skip, catálogo de 58 músicas, snapshot em disco (sobrevive a restart) |
| `apps/host` | Tela TV — Next.js (porta 3001, HTTP) | **Funcional**: lobby com código+QR, player com áudio real (ou synth p/ demos) + letra sincronizada, "voz na TV" (receptor + medidor de latência), pular música, resultado, leaderboard, encerramento |
| `apps/participant` | Mobile-web — Next.js (porta 3002, HTTPS) | **Funcional**: entrar por código/QR, sessão persistente (localStorage + rejoin), fila com remoção, "sua vez" com mic + score real, toggle "voz na TV" com nível, desistir da música, resultado, ranking |
| `apps/admin` | Painel admin | **Vazio** — não iniciado |
| `packages/shared-types` | Contratos: Song, Jam, QueueItem, PitchCurve, ScoreResult, eventos socket | **Completo** — fonte única do protocolo |
| `packages/ui` | `@jamroom/ui`: Button, Card, Badge, Avatar, PitchMeter, ProgressBar, cn | **Base pronta** — faltam Input, Modal, Toast, Table etc. |
| `packages/config` | `@jamroom/config`: preset Tailwind (tokens) + tsconfig base | **Completo** |
| `services/audio-processing` | Ingestão: pipeline IA (Demucs+pyin+Whisper) + importador UltraStar | **Funcional** — 53 músicas reais processadas; ver README do serviço |

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
**TV que não aceita certificado self-signed** (2026-07-13): a API sobe também um espelho
HTTP puro na **porta 4000** (mesmo Socket.io/handlers; só quando a principal está em HTTPS;
desativar com `HTTP_PORT=0`). Nesse caso, rodar o host com
`NEXT_PUBLIC_API_URL=http://<IP>:4000` — a TV não usa microfone, então não precisa de
contexto seguro; os celulares continuam no HTTPS 4001.
No celular, aceitar o aviso de certificado 2x (uma vez em `https://<IP>:4001/health`, outra na
página do participant); no PC, aceitar 1x para o host falar com a API. Também: `allowedDevOrigins`
com o IP nos `next.config.ts` (Next 16 bloqueia assets de dev cross-origin) e regra de firewall
inbound TCP 3001/3002/4001 (perfil Privado). IP atual configurado: 192.168.15.14.

### Testes (executar após mudanças no protocolo/scoring)
```bash
node scripts/test-protocol.mjs             # protocolo completo, incl. duetos (API de pé com INVITE_TIMEOUT_MS=2000)
node scripts/test-persistence.mjs create   # + kill/restart da API + `verify <code> <pid>`: snapshot
npx tsx scripts/test-scoring.ts            # algoritmo de score com performances sintéticas
python scripts/test-jam-flow.py            # fluxo completo em navegador (Playwright, mic fake)
python scripts/test-real-song.py           # música real: áudio na TV + letra sincronizada + mic
python scripts/test-tv-mic.py              # voz na TV: conexão, pacotes PCM fluindo, som tocando
python scripts/test-session-persistence.py # sessão do celular sobrevive a fechar o navegador
```
Última execução completa: 2026-07-12, tudo verde; em 2026-07-13, test-protocol (com os 19
asserts de dueto) e test-jam-flow re-executados verdes. Score real validado (perfeito=1000, oitava
acima=1000, desafinado 3 semitons=242, mudo=0); voz na TV validada em hardware real pelo usuário.

### Músicas reais (pipeline de ingestão)
`services/audio-processing/pipeline.py` (ver README do serviço): entrada = gravação original
com voz (+ instrumental karaokê opcional) → Demucs isola o vocal → librosa.pyin extrai a curva
de pitch → segmentação em `MelodyNote[]` → faster-whisper gera a letra sincronizada → grava
`apps/api/media/<id>.json` + `<id>.mp3`. A API carrega tudo de `apps/api/media/` na
inicialização e serve os áudios em `/media/*` (com Range). A TV toca o instrumental real
(`song.audioUrl`) em vez do synth e reancora o relógio do score via `host:playback_started`.
**Importador UltraStar** (`services/audio-processing/ultrastar.py`): converte arquivos
UltraStar `.txt` (padrão dos jogos de karaokê com pontuação por voz) direto para o formato
`Song` — melodia com tom exato + letra por sílaba, sem Demucs/Whisper. `--strip-vocals`
opcional gera instrumental via Demucs (timing idêntico ao mapa, ao contrário de um
instrumental de outra fonte). `batch_ultrastar_cc.py` importa o repositório oficial
UltraStar-Deluxe/songs (39 pacotes CC). `batch_local.py [--strip-vocals]` importa pacotes
locais de `input/ultrastar/` (uma pasta por música: .txt + áudio) — fluxo do usuário para
estudo pessoal em casa; itens entram marcados como não licenciados para uso comercial.
**Letras sincronizadas (2026-07-14)**: o pipeline tenta a **LRCLIB** (lrclib.net, letra
comunitária com timestamp por linha; match artista+título+duração ±4s) antes do Whisper;
`fix_lyrics.py [--id slug] [--force]` corrige músicas já importadas (backup em
`lyrics_backup/`, gitignored; UltraStar é pulado — letra por sílaba já é exata; letras são
obra protegida — uso pessoal, catálogo comercial exige licença ex-Musixmatch).
**`batch_youtube.py <URL|ytsearchN:termos> [--language xx] [--limit N]`** (2026-07-13):
baixa playlist/vídeo com yt-dlp (MP3 cacheado em `input/youtube/`, ffmpeg do PATH ou do
pacote `imageio-ffmpeg`) e roda o pipeline IA em cada faixa; título/artista vêm dos
metadados do vídeo. Mesmo enquadramento do `batch_local.py`: só estudo pessoal (viola ToS
do YouTube), attribution registra origem e ausência de licença — jamais entra no produto.
**Catálogo atual: 68+ músicas e crescendo** — 14 Josh Woodward (CC BY 4.0, via
pipeline Demucs+pyin+Whisper) + 39 UltraStar CC (Jonathan Coulton etc. — **vários são
CC BY-NC, não comercial**: revisar license.txt de cada pacote antes de qualquer lançamento)
+ 5 cantigas demo synth + itens pessoais via `batch_youtube.py` (em 2026-07-13 há um lote
de 373 músicas de playlist do usuário em processamento contínuo, ~13/h — **não licenciadas,
uso pessoal**; retomar com o mesmo comando se interromper, progresso em
`input/youtube/processed.txt`). Dependências Python:
`pip install -r services/audio-processing/requirements.txt` (torch CPU já instalado).
**Só processar áudio licenciado** — música comercial popular exige catálogo B2B + ECAD
(Seção 1 do plano); bancos UltraStar comunitários de hits comerciais são transcrições sem
licença e NÃO devem ser importados em massa no produto.

### Decisões técnicas do MVP da Jam (e o upgrade path de cada uma)
- **Backend**: Node puro + Socket.io (não NestJS como no plano — menos boilerplate para o MVP).
  Estado em memória com **snapshot em `apps/api/data/jams.json`** (`store.ts`): jams sobrevivem
  a restart da API (música tocando volta para a fila no boot; jams >24h descartadas). Sessão do
  participante persiste em localStorage no celular + rejoin. Migrar para Redis/Postgres sem
  mudar o protocolo de `@jamroom/shared-types`. Testes: `scripts/test-persistence.mjs`.
- **Pular/cancelar**: `host:skip_song` (botão na TV), `participant:skip_song` (cantor sai da
  música — num grupo os demais continuam; se ninguém sobrar, pula) e
  `participant:remove_song` (✕ nos itens próprios da fila) — pular não pontua.
- **Duetos/grupos (2026-07-13; convite pré-fila em 2026-07-14)**: o convite acontece AO
  ADICIONAR — o popup do catálogo pergunta "chamar alguém?" (seleção múltipla) e o item
  nasce com status **`"inviting"`** (`participant:add_song {songId, inviteeIds}`), fora da
  fila de reprodução até resolver: convidado recebe banner Aceitar/Recusar
  (`participant:invite_response`); alguém aceitou → vira `"queued"`; todos recusaram ou
  expirou (`INVITE_TIMEOUT_MS` 60s, env sobrescreve p/ teste) → banner de decisão do dono
  (`participant:resolve_item {addSolo}` — solo ou cancela). `QueueItem.singers:
  QueueSinger[]` (dono = `participantId`, entra aceito; helper `acceptedSingerIds`); máx
  `MAX_SINGERS_PER_ITEM = 4`. Quando a música começa, TODO cantor aceito (dono e
  convidados) cai no SingView ("Liberar microfone"); cada celular captura o próprio áudio
  e envia score individual; servidor coleta em `pendingScores` e fecha quando todos enviam
  (fallback 8s preenche zeros de quem sumiu).
  `Jam.lastResults: ScoreResult[]` (ordenado por score desc) substituiu `lastResult` —
  snapshot antigo é migrado no load. TV: um PitchMeter por cantor, resultado lado a lado
  com badge "melhor da música". "Voz na TV" aceita até `MAX_TV_MICS = 2` celulares
  simultâneos (peers/worklets separados somados no voiceBus com ganho 0.7; o 3º é ignorado).
  Limitações físicas documentadas: crosstalk entre celulares no mesmo ambiente (detector é
  monofônico), feedback com 2 mics abertos e "voz dobrada" por latências diferentes.
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
- Persistência "de verdade" (Postgres/Redis) — hoje é snapshot JSON em arquivo, suficiente
  para o MVP mas não para múltiplas instâncias.
- **Pagamentos/monetização (Fase 3) — explicitamente adiado a pedido do usuário (2026-07-11).**
- Catálogo B2B licenciado — a negociação com fornecedor segue sendo o gargalo de lead time.
  O pipeline técnico de ingestão **já existe e funciona** (53 músicas processadas).
- Vídeo no player (hoje: áudio real + fundo gradiente para músicas reais; synth para demos).
- Highlight de letra por palavra/sílaba na TV (os dados por sílaba JÁ existem nas músicas
  UltraStar — falta só a UI; músicas do pipeline IA têm granularidade de linha).
- Repositório git **local apenas** — sem remote (GitHub) configurado ainda.

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

## 5. Roadmap (estado em 2026-07-12)

- **Fase 0 — Fundações**: parcial. Feito: landing completa, design system, monorepo, git local.
  Pendente: auth, admin. A negociação B2B segue sendo o item de maior lead time.
- **Fase 1 — Jam/Party core**: **FEITA** (código/QR, fila em tempo real com remoção/skip, tela
  host, leaderboard, sessões persistentes em ambos os lados).
- **Fase 2 — Scoring real por pitch**: **FEITA**, incluindo os dois caminhos de ingestão
  (pipeline IA e importador UltraStar) com 53 músicas reais. **Validada pelo usuário com
  microfone e rede reais.** Pendente: calibração fina em ambiente ruidoso (festa) e feature
  flag score simulado/real por sessão.
- **Extra (fora do plano original)**: "voz na TV" — celular como microfone via WebRTC/PCM,
  latência validada em hardware real pelo usuário. **Duetos/grupos (2026-07-13)**: convite
  com aceite, até 4 cantores por música com score individual (cada celular captura a própria
  voz), voz na TV mixada para até 2 aparelhos — protocolo testado
  (`scripts/test-protocol.mjs`, 19 asserts novos); pendente validação manual com 2 celulares
  reais.
- **Fase 3 — Monetização**: **adiada a pedido do usuário**.
- **Fase 4 — Locação de equipamentos**: fora do escopo.

### Próximos passos recomendados
1. Highlight de letra por sílaba na TV (dados já existem nas músicas UltraStar — só UI).
2. Dashboard do Anfitrião + auth (destrava o fluxo de produto real: conta → criar Jam → TV;
   inclui o controle remoto da Jam que hoje está espalhado entre TV e celular do cantor).
3. `apps/admin` com CRUD de catálogo simples (prepara a entrada do catálogo licenciado).
4. Criar remote no GitHub e fazer push (repo é só local).
5. Persistência real (Redis para estado vivo, Postgres para histórico) atrás do `store.ts`.
6. Calibrar scoring em festa de verdade (ruído, várias vozes) e ajustar `CLARITY_MIN`/limiares.
7. Retomar a frente comercial: fornecedores B2B de catálogo (o importador já fala UltraStar,
   e o pipeline IA cobre qualquer par áudio original + instrumental).

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
- Lições de WebRTC/áudio que custaram debugging (não repetir): candidatos ICE precisam de fila
  até a descrição remota aplicar; Android entrega silêncio numa 2ª captura simultânea do mic
  (compartilhar o MediaStream); AudioContext criado sem gesto nasce suspenso (retomar em
  clique + avisar na UI); assets de dev do Next 16 bloqueiam acesso cross-origin
  (`allowedDevOrigins`); getUserMedia exige HTTPS fora de localhost.
