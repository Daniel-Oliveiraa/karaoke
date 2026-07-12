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
