"use client";

/**
 * Captura de microfone + detecção de pitch em tempo real, 100% no client
 * (decisão do plano: sem streamar áudio de voz ao servidor — latência,
 * custo e privacidade).
 *
 * Implementação: AudioWorklet (não ScriptProcessorNode, deprecated) rodando
 * autocorrelação normalizada estilo McLeod/NSDF sobre janelas de ~2048
 * amostras decimadas 3x (~16kHz efetivo), faixa vocal 80–1000 Hz.
 * Sem dependência de WASM para manter o MVP leve; o algoritmo pode ser
 * trocado por pYIN/aubio-wasm sem mudar esta interface.
 */

export interface PitchFrame {
  /** Frequência detectada em Hz, ou null (silêncio/sem clareza). */
  hz: number | null;
  /** Clareza/confiança 0–1 (pico da NSDF). */
  clarity: number;
  /** RMS do frame (nível de voz). */
  level: number;
}

export interface PitchCapture {
  stop: () => void;
}

// Código do processor serializado num Blob — evita servir arquivo estático
// separado e mantém o worklet dentro do bundle da app.
const WORKLET_CODE = `
class PitchProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.win = 2048;      // janela na taxa nativa
    this.hop = 1024;      // ~21ms de passo em 48kHz
    this.buf = new Float32Array(this.win);
    this.filled = 0;
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;

    let offset = 0;
    while (offset < ch.length) {
      const take = Math.min(ch.length - offset, this.win - this.filled);
      this.buf.set(ch.subarray(offset, offset + take), this.filled);
      this.filled += take;
      offset += take;

      if (this.filled === this.win) {
        this.analyze();
        // desliza a janela em "hop" amostras
        this.buf.copyWithin(0, this.hop);
        this.filled = this.win - this.hop;
      }
    }
    return true;
  }

  analyze() {
    // decima 3x com média (anti-alias simples) — voz cabe folgado em 8kHz
    const D = 3;
    const n = Math.floor(this.win / D);
    const x = new Float32Array(n);
    let rms = 0;
    for (let i = 0; i < n; i++) {
      const j = i * D;
      const v = (this.buf[j] + this.buf[j + 1] + this.buf[j + 2]) / 3;
      x[i] = v;
      rms += v * v;
    }
    rms = Math.sqrt(rms / n);
    if (rms < 0.008) {
      this.port.postMessage({ hz: null, clarity: 0, level: rms });
      return;
    }

    const sr = sampleRate / D;
    const minLag = Math.max(2, Math.floor(sr / 1000)); // 1000 Hz
    const maxLag = Math.min(n - 2, Math.ceil(sr / 80)); // 80 Hz

    // NSDF (McLeod): nsdf[lag] = 2*ac(lag) / (m0 + m(lag))
    const nsdf = new Float32Array(maxLag + 1);
    for (let lag = minLag; lag <= maxLag; lag++) {
      let ac = 0, m = 0;
      for (let i = 0; i < n - lag; i++) {
        const a = x[i], b = x[i + lag];
        ac += a * b;
        m += a * a + b * b;
      }
      nsdf[lag] = m > 0 ? (2 * ac) / m : 0;
    }

    // picos locais após o primeiro cruzamento negativo
    let start = minLag;
    while (start <= maxLag && nsdf[start] > 0) start++;

    let maxVal = 0;
    const peaks = [];
    for (let lag = start + 1; lag < maxLag; lag++) {
      if (nsdf[lag] > nsdf[lag - 1] && nsdf[lag] >= nsdf[lag + 1]) {
        peaks.push(lag);
        if (nsdf[lag] > maxVal) maxVal = nsdf[lag];
      }
    }
    if (peaks.length === 0 || maxVal < 0.5) {
      this.port.postMessage({ hz: null, clarity: maxVal, level: rms });
      return;
    }

    // primeiro pico acima de k*max (evita erro de oitava para baixo)
    const threshold = 0.9 * maxVal;
    let lag = peaks[0];
    for (const p of peaks) {
      if (nsdf[p] >= threshold) { lag = p; break; }
    }

    // interpolação parabólica para refinar o lag
    const a = nsdf[lag - 1], b = nsdf[lag], c = nsdf[lag + 1];
    const denom = a - 2 * b + c;
    const shift = denom !== 0 ? (0.5 * (a - c)) / denom : 0;
    const refined = lag + Math.max(-0.5, Math.min(0.5, shift));

    this.port.postMessage({ hz: sr / refined, clarity: nsdf[lag], level: rms });
  }
}
registerProcessor("jamroom-pitch", PitchProcessor);
`;

let workletUrl: string | null = null;

export async function startPitchCapture(
  onFrame: (frame: PitchFrame) => void
): Promise<PitchCapture> {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    throw new Error("insecure-context");
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false, // preserva a voz crua para o detector
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  const ctx = new AudioContext();
  if (ctx.state === "suspended") await ctx.resume();

  if (!workletUrl) {
    workletUrl = URL.createObjectURL(
      new Blob([WORKLET_CODE], { type: "application/javascript" })
    );
  }
  await ctx.audioWorklet.addModule(workletUrl);

  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, "jamroom-pitch", {
    numberOfInputs: 1,
    numberOfOutputs: 0,
  });
  node.port.onmessage = (e: MessageEvent<PitchFrame>) => onFrame(e.data);
  source.connect(node);

  return {
    stop: () => {
      node.port.onmessage = null;
      source.disconnect();
      node.disconnect();
      for (const track of stream.getTracks()) track.stop();
      void ctx.close();
    },
  };
}
