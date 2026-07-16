"use client";

import { useEffect, useState } from "react";

const DESIGN_WIDTH = 1920;
const DESIGN_HEIGHT = 1080;

/**
 * Todo o design da tela da TV foi desenhado e validado num quadro fixo de
 * 1920x1080 (docs/jam-layout.png, CLAUDE.md). Navegadores embutidos de Smart
 * TV costumam reportar um viewport diferente do físico (zoom padrão, DPI
 * distinto, barra de UI do próprio navegador, ou simplesmente não respeitam
 * bem a meta viewport) — o efeito é texto/rodapé cortados ou esticados,
 * porque o CSS em rem/vh assume que o viewport bate com 1920x1080.
 *
 * v1 usava um único scale uniforme (nunca esticar) + barras pretas quando a
 * proporção não fosse 16:9. **Testado na TV real do usuário (2026-07-16) e
 * rejeitado**: o navegador da TV reporta um viewport que NÃO é 16:9 exato,
 * então sobravam barras laterais — a tela "apertada" que não ocupava o
 * painel inteiro. v2 escalava CADA eixo pra preencher 100% do viewport —
 * bom pra TV (diferença de poucos %), mas **num monitor ultrawide real (bem
 * longe de 16:9) a distorção fica óbvia** (usuário testa host tanto num
 * monitor normal quanto ultrawide). v3 (atual) é híbrido: só estica pra
 * preencher quando o viewport está PERTO de 16:9 (a tolerância cobre as
 * variações de TV já vistas); fora disso (ultrawide, portrait, janela
 * redimensionada) volta pro scale uniforme + barras — a mesma lógica da v1,
 * só que agora condicional em vez de sempre-ligada.
 *
 * `position: fixed` + top/left/right/bottom 0 (não usar o shorthand `inset`
 * nem 100vh — navegador de TV antigo lida mal com os dois) garante cobrir a
 * janela toda independente de como ela calcula vh. O viewport de TV também
 * pode "assentar" DEPOIS do load (barra de UI some) sem disparar resize —
 * daí as re-medições com timeout. Os offsets de centralização são
 * calculados em pixels (não CSS `margin: auto`/flex) pelo mesmo motivo: já
 * causou problema em TV antiga lidando com unidades relativas.
 */

/**
 * Fora dessa faixa ao redor de 1 (razão entre o fator de escala X e Y), o
 * viewport está longe demais de 16:9 pra esticar sem ficar visivelmente
 * distorcido — cai pro scale uniforme + barras. 1.15 cobre as variações de
 * TV já observadas (até ~10%) com folga, mas rejeita um monitor ultrawide
 * 21:9 (que seria ~1.31) bem antes de chegar lá.
 */
const MAX_AXIS_RATIO = 1.15;

export function TvScaleFrame({ children }: { children: React.ReactNode }) {
  const [scaleX, setScaleX] = useState(1);
  const [scaleY, setScaleY] = useState(1);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);

  useEffect(() => {
    function update() {
      const vw = document.documentElement.clientWidth || window.innerWidth;
      const vh = document.documentElement.clientHeight || window.innerHeight;
      if (vw <= 0 || vh <= 0) return;

      const rawX = vw / DESIGN_WIDTH;
      const rawY = vh / DESIGN_HEIGHT;
      const axisRatio = rawX / rawY;
      const closeToDesignRatio =
        axisRatio > 1 / MAX_AXIS_RATIO && axisRatio < MAX_AXIS_RATIO;

      const sx = closeToDesignRatio ? rawX : Math.min(rawX, rawY);
      const sy = closeToDesignRatio ? rawY : sx;
      setScaleX(sx);
      setScaleY(sy);
      setOffsetX((vw - DESIGN_WIDTH * sx) / 2);
      setOffsetY((vh - DESIGN_HEIGHT * sy) / 2);
    }
    update();
    window.addEventListener("resize", update);
    const t1 = setTimeout(update, 500);
    const t2 = setTimeout(update, 2500);
    return () => {
      window.removeEventListener("resize", update);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  return (
    <div
      className="bg-background"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: offsetX,
          top: offsetY,
          width: DESIGN_WIDTH,
          height: DESIGN_HEIGHT,
          transform: `scale(${scaleX}, ${scaleY})`,
          transformOrigin: "top left",
        }}
      >
        {children}
      </div>
    </div>
  );
}
