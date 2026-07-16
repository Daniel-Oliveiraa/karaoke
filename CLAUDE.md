# KANTAÍ — Contexto do Projeto (leia antes de qualquer tarefa)

> Este arquivo existe para que qualquer agente (independente do modelo) consiga continuar o
> trabalho exatamente de onde parou, sem depender do histórico de conversa. Sempre que uma
> decisão nova for tomada com o usuário, ou uma fase for concluída, **atualize este arquivo**.

## 0. Estado ao fim de 2026-07-16 (retomar daqui)

- **Deploy completo em produção** (Railway + Vercel + DNS Hostinger, todos no
  ar). Detalhes completos na seção 7. Resumo rápido:
  - **API** (`apps/api`) → Railway, projeto `elegant-vitality`, serviço
    `disciplined-laughter` (nomes aleatórios do Railway, não renomeados).
    URL: `https://api.kantai.online`.
  - **Host** (`apps/host`) → Vercel, projeto `karaoke-host`. **Decisão do
    usuário (fase de testes)**: `kantai.online` (domínio raiz) aponta pro
    HOST, não pro site institucional — abre direto na tela "Abrir uma Jam
    nesta tela". O projeto `karaoke-web` (site institucional) existe na
    Vercel mas **sem domínio custom por enquanto** (só a URL
    `*.vercel.app` gerada); trocar isso é decisão futura de lançamento.
  - **Participant** (`apps/participant`) → Vercel, projeto
    `karaoke-participant`, URL `https://karaoke-participant.vercel.app`
    (sem domínio custom ainda).
  - **Bloqueio ativo, precisa de ação do usuário**: o volume persistente do
    Railway (`disciplined-laughter-volume`, `/data`) está **travado em
    500MB pelo plano trial (sem cartão) e em ~99% cheio** — quebra a
    importação do YouTube (`ENOSPC`, Demucs morre com SIGKILL) e até o
    salvamento periódico do snapshot de Jams (`[store] falha ao salvar
    snapshot: Error: ENOSPC`). **Só resolve com upgrade de plano/cartão no
    Railway** (o dashboard já mostra o botão "Upgrade to get 5 GB" —
    tentar redimensionar pelo "Live Resize" sem upgrade NÃO funciona,
    testado 3x). Catálogo real ficou parcialmente semeado no volume (~79
    músicas com áudio real das ~380 que existem localmente) — só completa
    depois do upgrade. Pesquisa de alternativas gratuitas foi feita (ver
    seção 7) mas nada foi migrado; usuário ainda não decidiu.
  - **Como esse deploy da API foi feito** (importante pra próxima vez que
    `apps/api` mudar): **não use `railway up`** — o binário Windows do CLI
    quebra com panic Rust (`buf.len() <= u32::MAX`) ao empacotar os
    ~2.1GB de mídia com `--no-gitignore`. Fluxo real: `docker build` local
    → `docker push` pra `ghcr.io/daniel-oliveiraa/kantai-api:latest`
    (pacote **público** no GHCR — precisa ser público, senão Railway
    falha com "unable to connect to registry", já que não configuramos
    credencial nenhuma) → no dashboard do Railway, Settings → Source →
    "Connect Image" apontando pra essa tag → e a cada rebuild, "Redeploy"
    manual no dashboard (não há auto-deploy da API a partir do GitHub;
    `apps/api/media`/`apps/api/data` são gitignored e nunca vão pro repo).

- **"Voz na TV" v3 — track Opus TESTADO EM PRODUÇÃO E REVERTIDO NO MESMO
  DIA (2026-07-16). NÃO REFAZER: agora há medição real.** O usuário pediu
  pra trocar o PCM/DataChannel (v2) por MediaStreamTrack Opus direto,
  espremendo tudo (frames 10ms, `jitterBufferTarget=0`, `latencyHint: 0`,
  track direto sem reconstrução — meta declarada: 15–35ms). Implementado,
  deployado e **medido pelo usuário em hardware real: ~177ms total (rede
  25 · buffer 104 · saída 48) vs ~70ms da v2** — o NetEq do Chrome segurou
  ~104ms de jitter buffer MESMO com `jitterBufferTarget = 0` (o alvo é só
  um pedido; o NetEq adaptativo ignora na prática), contra 14-23ms do ring
  buffer próprio da v2. **Código revertido pra v2 (commit da v3: c406b48,
  se um dia precisar do código de referência).** Conclusão definitiva, com
  dados: pra latência mínima em LAN, PCM cru via DataChannel com buffer
  próprio GANHA de track Opus — o jitter buffer do WebRTC não é
  controlável o suficiente. Registro do que a v3 tinha (tudo removido):
  - Celular: `pc.addTransceiver(track, "sendonly")` com o track do mic
    DIRETO (nada de AudioWorklet no caminho do áudio — o AudioContext do
    celular virou só medidor de nível via AnalyserNode). `contentHint =
    "speech"`, `networkPriority: "high"` (best effort).
  - SDP da ANSWER da TV munged (`tuneOpusSdp`, duplicada nos dois arquivos):
    `a=ptime:10` + fmtp `minptime=10;stereo=0;usedtx=0;cbr=1` → frames Opus
    de 10ms em vez de 20ms. **Confirmado no teste: ~100 pacotes/s** (seria
    50/s com os 20ms default). É a answer que governa o encoder do celular.
  - TV: `receiver.jitterBufferTarget = 0` (+ `playoutDelayHint = 0` legado),
    reaplicado a cada ciclo de stats; `AudioContext({ latencyHint: 0 })`;
    track entra por `MediaStreamAudioSourceNode` no mesmo barramento de voz
    de antes (ganho por cantor + reverb + analyser). O hack do `<audio>`
    mudo continua necessário (bug do Chrome: stream remoto só soa no
    WebAudio se preso a um elemento de mídia).
  - Badge continua com números MEDIDOS: "buffer" agora é o atraso real do
    NetEq via `getStats()` (`jitterBufferDelay/jitterBufferEmittedCount`,
    delta por ciclo); "rede" = `SEND_PATH_MS` (20ms estimados: captura +
    frame 10ms + lookahead do encoder) + RTT/2 medido. Motor no badge
    agora exibe `opus-track`. `__tvmic` ganhou `concealedPct` (perda
    audível), `jitterBufferMs`, `rttMs`; perdeu os campos da v2 (seq/
    reorder/stretch — não existem mais).
  - A previsão feita antes da medição se confirmou: a meta de 15–35ms era
    fisicamente inalcançável nesse hardware (só a saída de áudio já é
    ~48ms, teto de SO/hardware), e o risco apontado ("NetEq pode segurar
    mais buffer que o ring buffer da v2") foi exatamente o que aconteceu.
  - Nota de infra do dev local descoberta nessa sessão: o host devolvia
    404 em TODAS as rotas por cache `.next` corrompido —
    `Remove-Item -Recurse apps/host/.next` e subir de novo resolveu (não
    era o código). Também: host dev roda em HTTPS agora quando pedido
    (`npx next dev -p 3001 --experimental-https --experimental-https-key
    ../../certs/dev.key --experimental-https-cert ../../certs/dev.crt` a
    partir de `apps/host` — o script `dev` do package.json segue HTTP).

- **"Voz na TV" v2 (ATUAL — restaurada após a medição da v3 acima) —
  sessão grande de redução de latência.** Medido no PC do
  usuário (motor `worklet`, não o fallback): começou em **~100ms** relatado
  → terminou em **~70ms** estável (`rede` 9-21ms real via RTT/2, `buffer`
  14-23ms agora adaptativo, `saída` 48ms — **teto confirmado de
  hardware/SO do Windows/Chrome, testado e não muda por código**). O que
  foi implementado (todo em `apps/host/src/lib/micReceiver.ts` +
  `apps/participant/src/lib/tvMic.ts`, ver comentários no código pros
  detalhes exatos):
  - Cabeçalho de 8 bytes por pacote PCM (seq uint32 + captureTimeUs
    uint32) → mede perda/reordenamento reais e confirma via
    `getStats()`/candidate-pair que a conexão é **sempre direta**
    celular↔TV (nunca "relay" — não há STUN/TURN configurado, LAN only
    por design). Exposto em `window.__tvmic` (`lossPct`, `reorderCount`,
    `candidateType`).
  - Suavização do buffer: em vez de pular/cortar seco, corrige a taxa de
    resampling suavemente (`STRETCH_K=0.02`, `MAX_STRETCH=0.03` = 3%
    máx) — permite operar com margens de buffer bem mais apertadas sem
    estalar.
  - Alvo de buffer **adaptativo** por jitter medido de verdade (não mais
    fixo): `WORKLET_MIN_TARGET_MS=4`, `SCRIPT_PROCESSOR_MIN_TARGET_MS=8`,
    `MAX_TARGET_MS=60`, `JITTER_TARGET_MULTIPLIER=2.5` (histórico:
    4→2.5→1.5→**2.5 de novo** — com 1.5 o usuário reportou estalos em uso
    real depois da reversão da v3, exatamente o risco documentado; 2.5 é
    o último validado sem estalo. Se estalar em festa: subir pra 4).
  - **Anti-estalo (declick, adicionado junto com a volta pra 2.5)**:
    underrun termina com cauda exponencial (`UNDERRUN_DECAY=0.95`) em vez
    de corte seco pra zero, e retomada/salto duro do ring entram com
    fade-in (`FADE_IN_SAMPLES=128`, ~3ms) — o clique de underrun é a
    descontinuidade da onda, não o silêncio. Custo zero em latência; nos
    dois motores (worklet e ScriptProcessor). Validado com
    `DEBUG_JITTER_MS=30` (underruns tratados, sem crash, sem runaway).
  - **Resync duro (`RESYNC_EXCESS_MS=80`, adicionado após o teste na TV
    real marcar ~400ms)**: a suavização de 3% drena backlog a só ~30ms/s —
    jank de Smart TV acumulava centenas de ms que nunca drenavam. Excesso
    acima de 80ms sobre o alvo pula o readIdx direto pro alvo (fade-in do
    declick mascara o salto); atraso de buffer fica LIMITADO a
    alvo+80ms no pior caso. Contador `resyncs` em `__tvmic` — se
    incrementa sem parar, a TV não está dando conta (motor/CPU, não rede).
    Substituiu a trava antiga de 90% do ring (~900ms, inalcançável agora).
    Efeito medido no próprio teste headless: badge que inflava pra
    400-1000ms no carregamento passou a estabilizar em ~55-75ms.
  - Motor ativo (`worklet`/`script-processor`) exposto **na própria tela**
    (badge "Voz na TV"), não só no console — Smart TV raramente tem
    devtools acessível.
  - **Bug encontrado e corrigido**: a 1ª tentativa de medir a latência
    "real" (comparando o relógio do `AudioContext` do celular com
    `performance.now()` da TV, calibrado por RTT/2 assumido) deu valores
    absurdos em teste real (`-371ms`, depois `-432ms` mesmo recalibrando a
    cada 5s) — **calibrar dois relógios independentes com poucas amostras
    é frágil demais pra ser o número principal exibido**. Revertido: o
    badge "rede" voltou a usar `CAPTURE_MS + RTT/2` (sempre confiável,
    nunca negativo). A medição experimental entre relógios continua
    calculada mas só aparece em `window.__tvmic` como
    `oneWayLatencyMsExperimental`, não influencia o badge nem os cálculos.
  - `latencyHint` numérico (`0.01` em vez do preset `"interactive"`)
    tentado nos dois lados: **não mudou nada do lado da TV** (saída
    ficou idêntica, confirmando teto de hardware) e teve **efeito
    colateral ruim do lado do celular** (mic captando mais ruído de
    fundo — provável troca de perfil de áudio "comunicação" pra "cru" no
    SO). Revertido no celular (voltou pra `"interactive"`), mantido na TV
    (sem efeito, mas também sem efeito colateral reportado).
  - **Decisão tomada, não revisitar**: comprimir o pacote (Opus etc.) foi
    considerado e descartado — o gargalo não é banda (pacotes de ~256
    bytes/2.7ms já são ínfimos), e um codec reintroduziria atraso
    algorítmico (5-20ms+) e possivelmente o piso de jitter buffer do
    WebRTC (~40-80ms) que a arquitetura PCM cru existe justamente pra
    evitar.
  - Injetor de jitter sintético via `localStorage` (`kantai-debug-jitter-ms`,
    setado pelo `scripts/test-tv-mic.py` via `DEBUG_JITTER_MS=<ms>`) pra
    validar a suavização/alvo adaptativo sem depender de festa real —
    **não reproduz condições de rede real 100%**, só prova que a lógica
    não quebra sob jitter/perda simulados.
  - **Pendente**: não validado ainda numa Smart TV real (só no PC do
    usuário) nem numa rede de festa de verdade (só o injetor sintético).

- **QR code da Jam agora aparece também DURANTE a música tocando**
  (`PlayerView.tsx`, canto inferior esquerdo, com o código por baixo) —
  antes só existia na `LobbyView` antes de começar. Deixa quem chega depois
  entrar mesmo com alguém já cantando.

- **Tela distorcida/cortada em Smart TV — TvScaleFrame v2 (preencher, não
  letterbox)**: `apps/host/src/components/TvScaleFrame.tsx` — o app da TV
  renderiza sempre num quadro fixo de 1920x1080 escalado pro viewport real.
  A v1 usava escala UNIFORME + barras pretas; **testada na TV real do
  usuário e rejeitada** (o navegador da TV reporta viewport não-16:9 →
  sobravam barras laterais, tela "apertada" sem ocupar o painel). v2 escala
  CADA eixo pra preencher 100% (distorção de poucos % num navegador de TV
  quase-16:9, contra barras que incomodam de verdade). Também: `position:
  fixed` + top/left/right/bottom explícitos (sem `inset`/100vh — navegador
  de TV antigo), re-medição com timeouts 500ms/2.5s (viewport de TV assenta
  depois do load sem disparar resize). Validado via Playwright em 4
  viewports (todos preenchem 100%; distorção 0% em 16:9 exato, 8-10% só
  nos casos sintéticos extremos) — **pendente confirmação visual na TV
  real do usuário**.

- **Pesquisa feita (não implementada)**: alternativas gratuitas ao Railway
  com mais armazenamento, pro caso do usuário não querer pagar o upgrade.
  Conclusão: **Oracle Cloud "Always Free"** é a única opção realmente
  grátis-pra-sempre com armazenamento relevante (200GB de block storage +
  VM real com root, 2 OCPU/12GB RAM em ARM Ampere — reduzido recentemente
  de 4 OCPU/24GB), mas exige o usuário administrar a VM na mão (sem deploy
  automático tipo git push; precisa configurar HTTPS/firewall/systemd
  manualmente — bem mais trabalho que o Railway atual). Fly.io não é mais
  grátis pra conta nova. Render não suporta disco persistente no tier
  grátis e hiberna a cada 15min de inatividade. Koyeb não tem mais tier
  grátis de compute geral. Alternativa mais simples de todas: só pagar o
  upgrade do próprio Railway (~$5/mês, botão já visível no dashboard).
  **Usuário ainda não decidiu qual caminho seguir.**

- Commits desta sessão (`git log 4b40696..HEAD`): deploy da API (Docker +
  env vars), e uma sequência de 6 commits de "Voz na TV" (medição real +
  buffer suave + fix de tela, correção do bug de latência negativa,
  latencyHint, dois ajustes de margem de buffer, reversão do latencyHint
  no celular). Ver mensagens de commit pra detalhe de cada um.

## 1. O que é o produto

SaaS de karaokê cobrado por uso diário (nome do produto: **Kantaí**; domínio: kantai.online).
Diferencial: modo
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
| `apps/api` | Backend da Jam — Node + Socket.io, HTTPS 4001 + espelho HTTP 4000 (local) | **Funcional, em produção** (Railway, `https://api.kantai.online`): sessões, fila (com convites de dueto), leaderboard, relay de pitch/WebRTC, skip, catálogo dinâmico (~380 músicas), playcounts, importador YouTube in-app, snapshot em disco. Ver seção 7 pro bloqueio de volume ativo. |
| `apps/host` | Tela TV — Next.js (porta 3001 local) | **Funcional, em produção** (Vercel, domínio raiz `kantai.online` aponta pra cá — seção 0/7): lobby com código+QR (também durante a música tocando, canto inferior), player com áudio real (ou synth p/ demos) + letra sincronizada, "voz na TV" (receptor + medidor de latência + motor ativo exibido), `TvScaleFrame` (escala uniforme pra Smart TV), pular música, resultado, leaderboard, encerramento |
| `apps/participant` | Mobile-web — Next.js (porta 3002, HTTPS local) | **Funcional, em produção** (Vercel, `https://karaoke-participant.vercel.app`): entrar por código/QR, sessão persistente (localStorage + rejoin), fila com remoção, "sua vez" com mic + score real, toggle "voz na TV" com nível, desistir da música, resultado, ranking |
| `apps/admin` | Painel admin | **Vazio** — não iniciado |
| `packages/shared-types` | Contratos: Song, Jam, QueueItem, PitchCurve, ScoreResult, eventos socket | **Completo** — fonte única do protocolo |
| `packages/ui` | `@kantai/ui`: Button, Card, Badge, Avatar, PitchMeter, ProgressBar, cn | **Base pronta** — faltam Input, Modal, Toast, Table etc. |
| `packages/config` | `@kantai/config`: preset Tailwind (tokens) + tsconfig base | **Completo** |
| `services/audio-processing` | Ingestão: pipeline IA (Demucs+pyin+LRCLIB→Whisper) + UltraStar + batch YouTube + fix_lyrics/fix_genres | **Funcional** — 330+ músicas reais processadas; ver README do serviço |

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
  -subj "//CN=kantai-dev" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:<IP-DA-MAQUINA>"
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
inbound TCP 3001/3002/4001 (perfil Privado — hoje coberto por regras por programa `node.exe`,
que valem para a 4000 também). IP atual configurado: 192.168.15.14.
**Host em produção** (setup atual da TV; NEXT_PUBLIC_* é embutido NO BUILD):
```powershell
$env:NEXT_PUBLIC_API_URL = 'http://192.168.15.14:4000'
$env:NEXT_PUBLIC_PARTICIPANT_URL = 'https://192.168.15.14:3002'
npm run build --workspace=host; npm run start --workspace=host   # :3001
```
O participant NÃO tem produção HTTPS (`next start` é http puro e o mic exige contexto
seguro) — fica em `npm run dev:participant` até existir cert real/proxy.

### Testes (executar após mudanças no protocolo/scoring)
```bash
node scripts/test-protocol.mjs             # protocolo completo, incl. duetos, playCount e import dedupe (API de pé com INVITE_TIMEOUT_MS=2000)
node scripts/test-import-e2e.mjs "artista musica"  # LENTO (~5-10min): import real do YouTube via socket até catalog:new_song
node scripts/test-persistence.mjs create   # + kill/restart da API + `verify <code> <pid>`: snapshot
npx tsx scripts/test-scoring.ts            # algoritmo de score com performances sintéticas
python scripts/test-jam-flow.py            # fluxo completo em navegador (Playwright, mic fake)
python scripts/test-real-song.py           # música real: áudio na TV + letra sincronizada + mic
python scripts/test-tv-mic.py              # voz na TV: conexão, pacotes PCM fluindo, som tocando
python scripts/test-session-persistence.py # sessão do celular sobrevive a fechar o navegador
```
Última execução: test-tv-mic em 2026-07-16 (verde na v2 restaurada após a reversão da
v3); demais em 2026-07-14 — test-protocol com 44 asserts verdes (duetos com convite
pré-fila, playCount, busca/import YouTube), test-jam-flow verde, test-import-e2e validou
um import real até `catalog:new_song`.
Score real validado em 07-12 (perfeito=1000, oitava acima=1000, desafinado 3 semitons=242,
mudo=0); voz na TV v2 validada em hardware real pelo usuário em 07-12 e de novo em 07-16
(~70ms, contra ~177ms medidos da v3 Opus — ver seções 0 e 2).

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
**Catálogo atual: ~340 músicas e crescendo** — 14 Josh Woodward (CC BY 4.0, via
pipeline Demucs+pyin+Whisper) + 39 UltraStar CC (Jonathan Coulton etc. — **vários são
CC BY-NC, não comercial**: revisar license.txt de cada pacote antes de qualquer lançamento)
+ 5 cantigas demo synth + ~280 itens pessoais via `batch_youtube.py` (lote de 373 da
playlist do usuário quase concluído — ver seção 0; **não licenciadas, uso pessoal**;
progresso em `input/youtube/processed.txt`). Letras: 127+ com letra sincronizada da
LRCLIB, resto Whisper (rodar `fix_lyrics.py` de novo após o lote). Gêneros reais via
iTunes em ~200 (rodar `fix_genres.py` após o lote). Dependências Python:
`pip install -r services/audio-processing/requirements.txt` (torch CPU já instalado).
**Só processar áudio licenciado** — música comercial popular exige catálogo B2B + ECAD
(Seção 1 do plano); bancos UltraStar comunitários de hits comerciais são transcrições sem
licença e NÃO devem ser importados em massa no produto.

### Decisões técnicas do MVP da Jam (e o upgrade path de cada uma)
- **Backend**: Node puro + Socket.io (não NestJS como no plano — menos boilerplate para o MVP).
  Estado em memória com **snapshot em `apps/api/data/jams.json`** (`store.ts`): jams sobrevivem
  a restart da API (música tocando volta para a fila no boot; jams >24h descartadas). Sessão do
  participante persiste em localStorage no celular + rejoin. Migrar para Redis/Postgres sem
  mudar o protocolo de `@kantai/shared-types`. Testes: `scripts/test-persistence.mjs`.
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
- **Catálogo v2 (2026-07-14)**: sheet do participant tem abas — "Mais tocadas" (default,
  por `Song.playCount`, contagem global persistida em `apps/api/data/playcounts.json` via
  `playcounts.ts`, incrementada no `host:start_song`), "Todas", uma por gênero (≥2 músicas)
  e "Outras". **Importação pelo app**: busca no YouTube (`catalog:search_youtube`, yt-dlp
  flat) e `catalog:import_youtube {videoId,title}` → fila SERIAL em `apps/api/src/importer.ts`
  (máx 5 pendentes; spawna `batch_youtube.py <url>`, que imprime `RESULT <slug> ok|skip`);
  progresso via `catalog:import_update` (broadcast), música pronta via `catalog:new_song`.
  **Prévia antes de importar (2026-07-15)**: cada resultado do YouTube tem um botão
  "▶ Prévia" que expande inline o embed oficial (`youtube.com/embed/<videoId>`, 100%
  client-side, sem tocar o servidor) — deixa o usuário confirmar que é a versão certa
  antes de disparar os ~5min de processamento. Só uma prévia aberta por vez
  (`previewVideoId` em HubView.tsx); fecha ao importar, voltar ao catálogo ou fechar o
  sheet. Nada a ver com a decisão antiga de não usar YouTube embed como fonte de
  reprodução do produto (essa é só uma prévia client-side, não o player da Jam).
  (hot-add com `addProcessedSong` no catalog.ts; participant e host dão append sem refresh).
  `PYTHON_BIN` env aponta o Python (default "python"). Import = uso pessoal, não licenciado.
  **Progresso real por estágio (2026-07-14)**: `ImportJob` ganhou `requesterId`, `progress`
  (0–100) e `stage` (texto curto) — `importer.ts` varre a saída acumulada do processo
  (stdout+stderr) por marcadores conhecidos do pipeline (`[1/4] Demucs...`, `[2/4]
  Extraindo...`, etc.) e do `[download] NN%` do yt-dlp, subindo o progresso em degraus
  (nunca desce; não tenta parsear a barra tqdm interna do Demucs — o estágio "Removendo a
  voz" fica parado no mesmo % por ~2–3min, compensado só com uma animação de pulso no
  client). `HubView` mostra um banner persistente (fora do sheet, em qualquer aba) com
  `ProgressBar` + estágio + % **só para quem pediu a importação** (filtro por
  `requesterId === me.id`); o toast de conclusão continua global (avisa todo mundo que
  uma música nova chegou). Teste: `scripts/test-import-e2e.mjs` agora loga
  estágio/progresso a cada update e falha se menos de 2 estágios distintos aparecerem
  antes do `done` (prova que o parsing em tempo real funciona).
  **Bug de dedupe corrigido**: ver seção 0 — o atalho de `processed.txt` do
  `batch_youtube.py` só se aplica a mais de 1 vídeo agora.
- **Gêneros reais**: `fix_genres.py` (backfill) e o pipeline consultam a iTunes Search API
  (grátis, sem chave, `country=BR` → "Sertanejo", "MPB"...) quando o gênero é o default
  "Pop/Rock"; ids corrigidos em `lyrics_backup/genres_fixed.txt`.
- **Redesign da LobbyView (TV, 2026-07-14)**: tela de lobby (`apps/host/src/components/
  LobbyView.tsx`) redesenhada a partir de um esboço do usuário (`docs/jam-layout.png`):
  header com logo Kantaí (split KAN/TAÍ), headline "Sua Jam está aberta!" com destaque roxo, label
  "ENTRE NA JAM" + glow ao redor do QR, divisor "ou use o código", seção "PARTICIPANTES"
  (uppercase, contagem alinhada à direita) com linhas em card (não mais pills), rodapé
  com ícone de pessoas + status. **Decisão do usuário**: sem identidade/nome de anfitrião
  (não existe conceito de "host com nome" no sistema — ver seção 3) — sem badge
  "ANFITRIÃO" na lista, só participantes que entraram pelo celular. Toda a lógica
  condicional existente (countdown "A seguir", fila, leaderboard compacto) foi preservada
  intacta, só o visual mudou. Validado em 1920×1080 (bate com o esboço); em viewports
  menores que ~900px de altura o rodapé pode ficar fora da área visível (conteúdo mais
  alto que a tela) — não testado em TV real ainda.
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
- **"Voz na TV" (v2 — ATUAL, protótipo de 2026-07-12 refinado em 2026-07-16)**: toggle
  experimental no SingView transmite a voz do cantor para a TV (celular como microfone),
  sempre P2P direto na LAN (nunca passa pelo servidor — Socket.io só relaya SDP/ICE;
  sem STUN/TURN configurado, então o ICE só resolve candidatos "host"; confirmado via
  `getStats()`/candidate-pair, exposto em `window.__tvmic.candidateType`). Histórico de
  arquiteturas — **as duas alternativas com track Opus JÁ FORAM TESTADAS E PERDERAM,
  não revisitar**: v1 = track Opus default (piso NetEq ~40-80ms); v3 = track Opus
  espremido (frames 10ms, `jitterBufferTarget=0`, `latencyHint: 0`, track direto) —
  **medida em produção em 2026-07-16: ~177ms total (buffer NetEq ~104ms mesmo com
  target 0)**, revertida no mesmo dia (código de referência no commit c406b48). A v2
  usa **PCM Int16 cru via RTCDataChannel não-confiável/não-ordenado**, cada pacote com
  cabeçalho de 8 bytes
  (`seq` uint32 + `captureTimeUs` uint32) — mede perda/reordenamento reais
  (`lossPct`/`reorderCount` em `__tvmic`). Playback com ring buffer próprio + resampling
  linear + **suavização contínua** em vez de corte seco: `STRETCH_K = 0.02`,
  `MAX_STRETCH = 0.03` (corrige a taxa de reprodução em até 3% pra convergir ao alvo sem
  estalar, tanto no overrun quanto no underrun). **Alvo de buffer adaptativo** por jitter
  medido (RFC3550-style): `WORKLET_MIN_TARGET_MS = 4`, `SCRIPT_PROCESSOR_MIN_TARGET_MS = 8`,
  `MAX_TARGET_MS = 60` (teto duro), `JITTER_TARGET_MULTIPLIER = 2.5` (1.5 estalou em uso
  real — ver seção 0), `TARGET_STEP_MS = 2`
  (reavaliado a cada ~1s, nunca pula — só desliza). **Declick**: underrun sai com cauda
  exponencial e retomada entra com fade-in (~3ms) — tira o estalo de borda sem custo de
  latência (`UNDERRUN_DECAY`/`FADE_IN_SAMPLES`). Captura em 1 render quantum
  (`CHUNKS_PER_PACKET = 1`, ~2.7ms, `CAPTURE_MS = 6` de estimativa fixa do lado do
  celular). `AudioContext({ latencyHint })`: `"interactive"` no celular (testado `0.01`
  numérico e revertido — captava mais ruído de fundo, provável troca de perfil de áudio
  do SO); `0.01` mantido na TV (sem efeito mensurável, também sem efeito colateral).
  Recalibração de relógio cruzado a cada `CLOCK_RECALIBRATE_MS = 5000`, mas o valor
  resultante (`oneWayLatencyMsExperimental`) é só diagnóstico — o badge "rede" exibido
  usa `CAPTURE_MS + RTT/2` (mais confiável; a medição por relógio cruzado já deu valores
  absurdos/negativos em teste real com poucas amostras). Motor ativo
  (`worklet`/`script-processor`) exposto na própria tela do host (badge "Voz na TV"), já
  que Smart TV raramente tem devtools acessível. **Resultado medido no PC do usuário
  (motor worklet): ~70ms estável** (rede 9-21ms, buffer 14-23ms adaptativo, saída 48ms —
  este último é teto de hardware/SO, confirmado não mudar com nenhuma configuração de
  software testada; é o piso do software neste PC — melhorar além disso é ambiente:
  outra saída de áudio, TV com modo jogo, cabo em vez de Bluetooth). Injetor de jitter
  sintético via
  `localStorage.setItem("kantai-debug-jitter-ms", "<ms>")` (gated, nunca ligado em uso
  normal) usado por `DEBUG_JITTER_MS=<ms> python scripts/test-tv-mic.py` pra validar
  suavização/alvo adaptativo sob rede instável simulada — **não reproduz jitter de rede
  real 100%**, só prova que a lógica não quebra. Arquivos:
  `apps/participant/src/lib/tvMic.ts`, `apps/host/src/lib/micReceiver.ts`. **Pendente**:
  validação numa Smart TV real (só testado no PC do usuário) e numa rede de festa de
  verdade (só o injetor sintético até agora). Se crepitar numa festa real, a primeira
  coisa a tentar é subir `JITTER_TARGET_MULTIPLIER` de 2.5 pra 4 (1.5 já provou que
  estala; o declick reduz a audibilidade mas não substitui margem). Fatores fora do
  código que dominam a latência residual: caixa Bluetooth (+100–300ms — usar HDMI/cabo),
  "modo jogo" da TV (20–100ms), Wi-Fi 5GHz vs 2.4GHz. Mic dedicado (Fase 4) segue sendo
  o premium.

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
- Repositório git com remote no GitHub: `https://github.com/Daniel-Oliveiraa/karaoke`
  (privado, criado em 2026-07-15). `main` já rastreia `origin/main`.
- **Volume do Railway travado em 500MB/~99% cheio (plano trial, sem cartão)** — quebra
  import do YouTube e o snapshot de Jams em produção. Só resolve com upgrade de
  plano/cartão no Railway (~$5/mês) ou migração pra outro provedor (Oracle Cloud
  "Always Free" pesquisado como alternativa viável, mas exige administração manual de
  VM). **Decisão do usuário pendente** — ver seção 7.
- Validação em hardware real pendente: "voz na TV" (latência + qualidade) numa Smart TV
  de verdade e numa rede de festa real (só testado no PC do usuário e com injetor de
  jitter sintético); `TvScaleFrame` (fix de tela distorcida/cortada) só validado
  matematicamente via JS no Chrome, não visualmente numa TV real.

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
- Reaproveitar `@kantai/ui` + preset em qualquer app novo (ver `apps/*/tailwind.config.js`).

## 5. Roadmap (estado em 2026-07-16)

- **Fase 0 — Fundações**: parcial. Feito: landing completa, design system, monorepo, git local.
  Pendente: auth, admin. A negociação B2B segue sendo o item de maior lead time.
- **Fase 1 — Jam/Party core**: **FEITA** (código/QR, fila em tempo real com remoção/skip, tela
  host, leaderboard, sessões persistentes em ambos os lados).
- **Fase 2 — Scoring real por pitch**: **FEITA**, incluindo os dois caminhos de ingestão
  (pipeline IA e importador UltraStar) com 53 músicas reais. **Validada pelo usuário com
  microfone e rede reais.** Pendente: calibração fina em ambiente ruidoso (festa) e feature
  flag score simulado/real por sessão.
- **Extras (fora do plano original)**:
  - "Voz na TV" (07-12): celular como microfone via WebRTC/PCM, latência validada em
    hardware real; (07-14) fallback ScriptProcessor para contexto inseguro + aviso de
    autoplay sempre visível — pendente re-validação na TV real do usuário.
  - Duetos/grupos (07-13, convite pré-fila 07-14): popup ao adicionar → convidado
    aceita/recusa ANTES de entrar na fila; score individual; até 2 vozes na TV;
    pendente validação com 2 celulares reais.
  - Catálogo v2 (07-14): abas "Mais tocadas"/gêneros no sheet, playcounts persistidos,
    importação de músicas do YouTube pelo próprio app (fila serial no servidor,
    hot-add no catálogo), letras sincronizadas via LRCLIB, gêneros reais via iTunes.
  - Resiliência (07-14): espelho HTTP :4000 para TVs sem suporte a cert self-signed;
    clients refazem attach/rejoin quando a API reinicia.
  - Progresso real de import + redesign da LobbyView (07-14): barra de progresso por
    estágio (parsing da saída do pipeline) persistente para quem importou; tela da TV
    redesenhada a partir do esboço do usuário (`docs/jam-layout.png`).
  - Deploy em produção (07-15/07-16): API no Railway (Docker/GHCR), web/host/participant
    na Vercel, DNS no Hostinger — tudo no ar (ver seção 7). Bloqueado por volume travado
    em 500MB no Railway (seção 3).
  - "Voz na TV" — reescrita de latência v2 (07-16): cabeçalho de pacote com seq/timestamp,
    suavização contínua de buffer (sem estalo), alvo adaptativo por jitter medido,
    correção de um bug de medição de latência negativa/absurda. ~100ms → ~70ms estável
    medido no PC do usuário; pendente validação em Smart TV real e festa real (seção 3).
  - "Voz na TV" v3 (07-16, mesma data, mais tarde — TESTADA E REVERTIDA): track Opus
    espremido (frames 10ms, jitterBufferTarget=0, latencyHint 0, track direto) medido
    em produção: ~177ms vs ~70ms da v2 (NetEq segurou ~104ms ignorando o target 0).
    Revertida pra v2 no mesmo dia; commit de referência da v3: c406b48 (seções 0 e 2).
  - QR code da Jam também visível durante a música tocando (07-16), não só no lobby.
  - Fix de tela distorcida/cortada em Smart TV via `TvScaleFrame` (escala uniforme
    1920x1080, 07-16); pendente validação visual numa TV real (seção 3).
- **Fase 3 — Monetização**: **adiada a pedido do usuário**.
- **Fase 4 — Locação de equipamentos**: fora do escopo.

### Próximos passos recomendados
1. Highlight de letra por sílaba na TV (dados já existem nas músicas UltraStar — só UI).
2. Dashboard do Anfitrião + auth (destrava o fluxo de produto real: conta → criar Jam → TV;
   inclui o controle remoto da Jam que hoje está espalhado entre TV e celular do cantor).
3. `apps/admin` com CRUD de catálogo simples (prepara a entrada do catálogo licenciado).
4. Persistência real (Redis para estado vivo, Postgres para histórico) atrás do `store.ts`.
5. Calibrar scoring em festa de verdade (ruído, várias vozes) e ajustar `CLARITY_MIN`/limiares.
6. Retomar a frente comercial: fornecedores B2B de catálogo (o importador já fala UltraStar,
   e o pipeline IA cobre qualquer par áudio original + instrumental).

## 6. Convenções observadas (seguir ao continuar)
- Nome do produto: **Kantaí** (pacotes `@kantai/*`; domínio kantai.online; slogan "Aumenta o
  som e Kantaí."). Copy de produto e comentários em pt-BR;
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
  clique + avisar na UI — o aviso precisa aparecer MESMO sem conexão de voz ativa); assets
  de dev do Next 16 bloqueiam acesso cross-origin (`allowedDevOrigins`); getUserMedia exige
  HTTPS fora de localhost; **AudioWorklet só existe em secure context** — TV acessando
  `http://<IP>` cai no fallback ScriptProcessor do micReceiver (+~21ms; `__tvmic.engine`
  diz qual motor está ativo); stream remoto WebRTC só soa no WebAudio se também estiver
  preso a um `<audio>` mudo (bug antigo do Chrome — vale pro fallback ontrack do
  micReceiver); `totalAudioEnergy`/`audioLevel` do inbound-rtp ficam 0 no caminho
  track→WebAudio (descoberto na v3 — não usar de assert; sinal real se prova pelo
  analyser do mixer); `receiver.jitterBufferTarget = 0` NÃO força o NetEq a esvaziar
  (medido: ~104ms de buffer mesmo com target 0 — é pedido, não ordem);
  sockets reconectados após restart da API perdem role/sala —
  clients refazem attach/rejoin no evento `reconnect`; testes localhost não cobrem
  contexto inseguro — usar `TV_URL=http://<IP>:3001 python scripts/test-tv-mic.py`;
  host dev devolvendo 404 em TODAS as rotas = cache `.next` corrompido (apagar
  `apps/host/.next` e subir de novo).

## 7. Deploy em produção (2026-07-16 — no ar, com um bloqueio ativo)

**Arquitetura**: os 3 apps Next.js (`web`, `host`, `participant`) estão na **Vercel**; a
**API** (Socket.io, estado em memória + processos Python) está no **Railway** — Vercel é
serverless (sem conexão persistente/WebSocket, sem disco local persistente, sem
`child_process` de Python), incompatível com a arquitetura atual da API.

**Estado ao vivo**:
- **API** → Railway, projeto `elegant-vitality`, serviço `disciplined-laughter` (nomes
  aleatórios do Railway, não renomeados). URL pública: `https://api.kantai.online`.
- **Host** (`apps/host`) → Vercel, projeto `karaoke-host`. **Decisão do usuário (fase de
  testes)**: o domínio raiz `kantai.online` aponta pro HOST, não pro site institucional —
  abre direto em "Abrir uma Jam nesta tela" (mudar isso é decisão futura de lançamento).
- **Participant** (`apps/participant`) → Vercel, projeto `karaoke-participant`, URL
  `https://karaoke-participant.vercel.app` (sem domínio custom ainda).
- **Web** (`apps/web`, site institucional) → projeto `karaoke-web` existe na Vercel mas
  **sem domínio custom** (só a URL `*.vercel.app` gerada) — fica assim enquanto
  `kantai.online` apontar pro host, por decisão do usuário.
- DNS em `kantai.online` gerenciado no Hostinger (hpanel.hostinger.com).

**Decisões do usuário (2026-07-15)**:
- Catálogo publicado = **o inteiro atual** (~380 músicas, a maioria do lote pessoal do
  YouTube, **não licenciada para uso comercial** — decisão explícita "por enquanto", para
  testar o produto; trocar antes de qualquer lançamento real/divulgação pública).
- Importação ao vivo do YouTube (`catalog:import_youtube`) **continua ativa em produção**
  — qualquer participante conectado pode disparar um download+Demucs pelo servidor
  publicado. Risco aceito: abuso/custo de quem descobrir a URL, e a violação de ToS do
  YouTube fica exposta publicamente. Sem mitigação implementada ainda (ex.: rate-limit
  por participante) — considerar se virar problema real.

### Vercel — web/host/participant
Um projeto Vercel por app, todos apontando pro mesmo repo (`Daniel-Oliveiraa/karaoke`),
com **Root Directory** diferente e **auto-deploy em cada push pra `main`** (só o(s)
projeto(s) cujos arquivos mudaram ganham novo deploy):
| App | Root Directory | Domínio | Env vars |
|---|---|---|---|
| `apps/web` | `apps/web` | nenhum (só `*.vercel.app`) | nenhuma |
| `apps/host` | `apps/host` | `kantai.online` (raiz) | `NEXT_PUBLIC_API_URL=https://api.kantai.online`, `NEXT_PUBLIC_PARTICIPANT_URL` |
| `apps/participant` | `apps/participant` | nenhum (só `*.vercel.app`) | `NEXT_PUBLIC_API_URL=https://api.kantai.online` |

`NEXT_PUBLIC_*` apontam pras URLs públicas reais — nada de IP de rede local em produção.
Vercel detecta o workspace npm automaticamente (instala na raiz do monorepo mesmo com
Root Directory numa subpasta). HTTPS de verdade emitido automaticamente — sem fricção de
certificado self-signed em produção (isso só existe no fluxo de dev local, seção 2).

### Railway — API (`apps/api`)
**Não use `railway up`** — o binário Windows do CLI quebra com panic Rust
(`buf.len() <= u32::MAX as usize`) ao empacotar os ~2.1GB de `apps/api/media` com
`--no-gitignore` (necessário porque `media/`/`data/` são gitignored e o deploy via
GitHub chegaria com catálogo vazio). **Fluxo real, validado e é o que deve ser repetido
a cada mudança em `apps/api`**:
```bash
docker build -t kantai-api -f Dockerfile .
docker tag kantai-api ghcr.io/daniel-oliveiraa/kantai-api:latest
docker push ghcr.io/daniel-oliveiraa/kantai-api:latest
```
depois, no dashboard do Railway: Settings → Source → "Connect Image" (já configurado
apontando pra essa tag) → botão **"Redeploy" manual** (não há auto-deploy; o Railway não
observa o registry, só faz pull de novo quando mandado). Requer login Docker no GHCR
(`docker login ghcr.io`, token/PAT do GitHub) antes do primeiro push.

**Armadilha real que já mordeu**: o pacote GHCR (`ghcr.io/daniel-oliveiraa/kantai-api`)
precisa estar **público** — se privado, Railway falha com "unable to connect to the
registry" (não configuramos credencial de registry nenhuma no Railway). Mudar
visibilidade é uma ação de controle de acesso — pedir pro usuário fazer no GitHub
(Packages → kantai-api → Package settings → Change visibility), não fazer por conta
própria.

**Arquivos**: `Dockerfile` (raiz do repo) + `docker/api-entrypoint.sh` + `.dockerignore`.
Node 20 + Python3 + ffmpeg (Demucs/yt-dlp da importação ao vivo). Catálogo/estado atuais
são copiados pra `/app/seed/` na imagem (fora do path onde o volume monta) — o
entrypoint copia essa semente pra `/data/media` e `/data/state` **só na primeira
execução** (volume vazio); depois disso o volume já tem dados e sobrevive a redeploys.

Variáveis de ambiente lidas pelo código (sem elas, cai nos caminhos locais de sempre —
dev local não é afetado):
- `KANTAI_MEDIA_DIR` (catálogo — `catalog.ts`), `KANTAI_DATA_DIR` (snapshot de Jams +
  playcounts — `store.ts`/`playcounts.ts`) — ambos setados pro Railway apontar pro
  volume em `/data`.
- `PORT` (Railway injeta sozinho; código já respeita `process.env.PORT`).
- `HTTP_PORT=0` (desativa o espelho HTTP puro de dev local — Railway já entrega HTTPS
  de verdade, então essa muleta não é necessária em produção).
- `PYTHON_BIN` (default `"python"` — o Dockerfile já cria o symlink `python→python3`).

**⚠️ BLOQUEIO ATIVO — precisa de decisão/ação do usuário**: o volume persistente
(`disciplined-laughter-volume`, montado em `/data`) está **travado em 500MB pelo plano
trial (sem cartão) e em ~99% cheio**. Isso quebra a importação do YouTube em produção
(`ENOSPC`, Demucs morre com SIGKILL) e às vezes o salvamento do snapshot de Jams
(`[store] falha ao salvar snapshot: Error: ENOSPC`). O dashboard mostra um botão
"Upgrade to get 5 GB" — **"Live Resize" sem fazer upgrade NÃO funciona** (testado 3x,
volta pro mesmo tamanho). Catálogo ficou parcialmente semeado (~79 de ~380 músicas com
áudio real completo). Duas saídas, nenhuma feita ainda:
1. Pagar o upgrade do Railway (~$5/mês) — caminho mais simples, zero migração.
2. Migrar pra Oracle Cloud "Always Free" (pesquisado nesta sessão): 200GB de block
   storage + VM real com root, 2 OCPU/12GB RAM ARM Ampere, genuinamente grátis pra
   sempre — mas exige administrar a VM na mão (sem deploy tipo git push; HTTPS/
   firewall/systemd manuais). Fly.io não é mais grátis pra conta nova; Render não tem
   disco persistente no tier grátis e hiberna; Koyeb não tem mais tier grátis de
   compute geral — nenhum desses é uma alternativa viável.

**Build local**: `docker build -t kantai-api-test -f Dockerfile .` (contexto ~2.79GB,
imagem final ~8.3GB — Node+Python+torch CPU+Demucs+catálogo). Importante: o
`requirements.txt` precisa do `pip3 install torch --index-url .../cpu` **antes** dele,
senão o resolver do pip puxa a build CUDA/GPU de torch (centenas de MB de
`cuda-toolkit`/`nvidia-cudnn` inúteis num host CPU-only como o Railway).
