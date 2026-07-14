# services/audio-processing — ingestão de músicas reais

Transforma um par de arquivos de áudio numa música completa do JAMROOM
(letra sincronizada + curva de pitch de referência + instrumental para a TV).

## Requisitos

```bash
pip install -r requirements.txt   # demucs (torch CPU), librosa, faster-whisper
```

## Uso

```bash
python pipeline.py \
  --original input/musica_com_voz.mp3 \      # gravação original COM voz
  --instrumental input/musica_karaoke.mp3 \  # versão karaokê (opcional*)
  --id minha-musica \
  --title "Minha Música" --artist "Artista" --genre "Pop" \
  --language pt \
  --attribution "Artista — CC BY 4.0"
```

\* Sem `--instrumental`, o acompanhamento separado pelo Demucs é usado como
instrumental (qualidade inferior à versão karaokê oficial, mas funciona).

Saída: `apps/api/media/<id>.json` + `apps/api/media/<id>.mp3`. A API carrega
tudo que estiver nessa pasta na inicialização — reinicie `npm run dev:api`.

## Lote a partir do YouTube (uso pessoal)

```bash
python batch_youtube.py "<URL-da-playlist-ou-video>" [--language pt] [--limit N]
python batch_youtube.py "ytsearch1:artista nome da musica"
```

Baixa o áudio com yt-dlp (MP3 em `input/youtube/`, com cache) e roda o
pipeline acima em cada faixa — título/artista saem dos metadados do vídeo.
Baixar do YouTube viola os ToS da plataforma: fluxo **somente para estudo
pessoal**, nunca para o catálogo do produto (o `attribution` de cada item
registra a origem e a ausência de licença comercial).

## Etapas internas

1. **Demucs** (htdemucs, two-stems) separa o vocal da gravação original —
   o vocal é usado só como insumo interno (nunca é servido ao usuário).
2. **librosa.pyin** extrai a curva f0 do vocal (80–1000 Hz, ~86 fps).
3. A curva é segmentada em notas (`MelodyNote[]`): a referência do scoring.
4. **faster-whisper** (modelo base) transcreve com timestamps → letra por linha.
5. JSON + instrumental copiados para `apps/api/media/`.

## Licenciamento

Só processe áudio que você tem direito de usar. Para testes: músicas
Creative Commons (ex: Josh Woodward, CC BY 4.0 — atribuição obrigatória,
use `--attribution`). Para uso comercial: catálogo B2B licenciado + ECAD
(ver plano do projeto). Os arquivos em `input/` e `apps/api/media/` não
devem ir para repositório público sem verificar a licença.
