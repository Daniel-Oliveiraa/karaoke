"use client";

import { useEffect, useState } from "react";

const DESIGN_WIDTH = 1920;
const DESIGN_HEIGHT = 1080;

/**
 * Todo o design da tela da TV foi desenhado e validado num quadro fixo de
 * 1920x1080 (docs/jam-layout.png, CLAUDE.md). Navegadores embutidos de Smart
 * TV costumam reportar um viewport diferente do físico (zoom padrão, DPI
 * distinto, ou simplesmente não respeitam bem a meta viewport) — o efeito é
 * texto/rodapé cortados ou esticados, porque o CSS em rem/vh assume que o
 * viewport bate com 1920x1080.
 *
 * Em vez de tentar acertar cada tela com media queries (não dá pra validar
 * sem acesso à TV real), renderiza sempre o quadro de design no tamanho
 * físico exato e aplica um único `transform: scale()` (mesma proporção nos
 * dois eixos — nunca estica) pra caber no viewport real, com barras pretas
 * nas bordas se a proporção não for exatamente 16:9. Mesma técnica usada por
 * apps de TV como Netflix/YouTube TV.
 */
export function TvScaleFrame({ children }: { children: React.ReactNode }) {
  const [scale, setScale] = useState(1);

  useEffect(() => {
    function update() {
      setScale(
        Math.min(window.innerWidth / DESIGN_WIDTH, window.innerHeight / DESIGN_HEIGHT)
      );
    }
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return (
    <div className="flex h-screen w-screen items-center justify-center overflow-hidden bg-background">
      <div
        style={{
          width: DESIGN_WIDTH,
          height: DESIGN_HEIGHT,
          transform: `scale(${scale})`,
          transformOrigin: "center center",
        }}
      >
        {children}
      </div>
    </div>
  );
}
