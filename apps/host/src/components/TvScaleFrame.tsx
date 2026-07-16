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
 * painel inteiro. v2 (atual): escala CADA eixo pra preencher 100% do
 * viewport. Numa TV o navegador é sempre (quase) tela cheia de um painel
 * 16:9, então a diferença entre os dois fatores é de poucos % — distorção
 * imperceptível, contra barras pretas que incomodam de verdade. (Se um dia
 * aparecer um viewport MUITO fora de 16:9, ex. metade da tela, aí sim
 * reavaliar um teto de distorção.)
 *
 * `position: fixed` + top/left/right/bottom 0 (não usar o shorthand `inset`
 * nem 100vh — navegador de TV antigo lida mal com os dois) garante cobrir a
 * janela toda independente de como ela calcula vh. O viewport de TV também
 * pode "assentar" DEPOIS do load (barra de UI some) sem disparar resize —
 * daí as re-medições com timeout.
 */
export function TvScaleFrame({ children }: { children: React.ReactNode }) {
  const [scaleX, setScaleX] = useState(1);
  const [scaleY, setScaleY] = useState(1);

  useEffect(() => {
    function update() {
      const vw = document.documentElement.clientWidth || window.innerWidth;
      const vh = document.documentElement.clientHeight || window.innerHeight;
      if (vw > 0 && vh > 0) {
        setScaleX(vw / DESIGN_WIDTH);
        setScaleY(vh / DESIGN_HEIGHT);
      }
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
