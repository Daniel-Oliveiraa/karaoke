import { Avatar, Button } from "@kantai/ui";
import {
  BatteryIcon,
  CrownIcon,
  PlayCircleIcon,
  PlusIcon,
  QrCodeIcon,
  SparklesIcon,
  StarIcon,
  WifiIcon,
} from "./icons";

const AUDIENCE = ["Ana", "Bruno", "Carla", "Diego"];

const RANKING = [
  { pos: 1, name: "Pedro", pts: 325 },
  { pos: 2, name: "Ana", pts: 290 },
  { pos: 3, name: "João", pts: 265 },
  { pos: 4, name: "Carlos", pts: 240 },
  { pos: 5, name: "Maria", pts: 195 },
];

function RankRow({ pos, name, pts }: { pos: number; name: string; pts: number }) {
  const isFirst = pos === 1;
  return (
    <div className="flex items-center gap-2 py-1.5">
      <span
        className={
          isFirst
            ? "flex h-5.5 w-5.5 shrink-0 items-center justify-center rounded-full bg-warning/20 text-warning"
            : "flex h-5.5 w-5.5 shrink-0 items-center justify-center rounded-full bg-surface-elevated text-[11px] font-semibold text-foreground-muted"
        }
      >
        {isFirst ? <CrownIcon className="h-3.5 w-3.5" /> : pos}
      </span>
      <Avatar name={name} size={20} className="text-[9px]" />
      <span className="flex-1 truncate text-[12px] font-medium text-foreground">
        {name}
      </span>
      <span className="shrink-0 text-[12px] font-semibold text-foreground-muted">
        {pts} pts
      </span>
    </div>
  );
}

export function Hero() {
  return (
    <section id="top" className="relative overflow-hidden pt-16 pb-28 lg:pb-40">
      {/* Glow atmosférico de fundo, sutil, sem competir com o conteúdo */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(60% 50% at 15% 10%, rgba(124,58,237,0.16), transparent 60%), radial-gradient(45% 40% at 85% 25%, rgba(59,130,246,0.14), transparent 60%)",
        }}
      />

      <div className="mx-auto max-w-[1440px] px-6 sm:px-8 lg:px-16">
        <div className="grid grid-cols-1 items-center gap-16 lg:grid-cols-2 lg:gap-8">
          {/* Coluna esquerda: headline, subheadline, CTAs, prova social */}
          <div className="max-w-xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 text-caption font-semibold tracking-wide text-primary">
              <SparklesIcon className="h-3.5 w-3.5" />
              KARAOKÊ INTELIGENTE
            </div>

            <h1 className="mt-6 text-[2.75rem] font-extrabold leading-[1.05] tracking-tight text-foreground sm:text-6xl lg:text-hero">
              Transforme qualquer TV em{" "}
              <span className="bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
                um karaokê.
              </span>
            </h1>

            <p className="mt-6 text-lg leading-relaxed text-foreground-muted">
              Abra uma Jam, convide todo mundo e cantem juntos. Pontuação por{" "}
              <span className="font-semibold text-foreground">voz real</span>{" "}
              e{" "}
              <span className="font-semibold text-foreground">
                ranking ao vivo
              </span>
              .
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button variant="primary" className="gap-2.5 px-6 py-3.5 text-body">
                <PlusIcon className="h-5 w-5" />
                Criar Jam agora
              </Button>
              <Button
                variant="secondary"
                className="gap-2.5 px-6 py-3.5 text-body"
              >
                <PlayCircleIcon className="h-5 w-5" />
                Assistir demonstração
              </Button>
            </div>

            <div className="mt-10 flex items-center gap-4">
              <div className="flex -space-x-3">
                {AUDIENCE.map((name) => (
                  <Avatar
                    key={name}
                    name={name}
                    size={40}
                    className="border-2 border-background"
                  />
                ))}
              </div>
              <div>
                <div className="flex items-center gap-0.5 text-warning">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <StarIcon key={i} className="h-3.5 w-3.5" />
                  ))}
                </div>
                <p className="mt-0.5 text-caption text-foreground-muted">
                  Mais de 2.500 jams criadas
                </p>
              </div>
            </div>
          </div>

          {/* Coluna direita: mockup TV + celular + ranking */}
          <div className="relative lg:pb-16 lg:pl-10">
            {/* TV */}
            <div className="rounded-[22px] border border-border bg-surface p-3 shadow-soft">
              <div className="relative aspect-[16/10] overflow-hidden rounded-2xl">
                {/* "foto" de palco simulada via gradientes — roxo/azul/magenta */}
                <div
                  className="absolute inset-0"
                  style={{
                    background:
                      "radial-gradient(120% 90% at 78% 15%, rgba(124,58,237,0.55), transparent 55%), radial-gradient(90% 70% at 60% 100%, rgba(59,130,246,0.35), transparent 60%), radial-gradient(70% 60% at 90% 70%, rgba(217,70,239,0.28), transparent 60%), #0b0b10",
                  }}
                />
                {/* silhueta simplificada do cantor */}
                <svg
                  aria-hidden
                  viewBox="0 0 200 200"
                  className="absolute right-[8%] top-[8%] h-[78%] w-auto text-black/70"
                >
                  <ellipse cx="100" cy="55" rx="26" ry="30" fill="currentColor" />
                  <path
                    d="M55 195 C55 130 70 95 100 95 C130 95 145 130 145 195 Z"
                    fill="currentColor"
                  />
                  <rect
                    x="94"
                    y="60"
                    width="10"
                    height="55"
                    rx="5"
                    fill="currentColor"
                    transform="rotate(-18 99 87)"
                  />
                </svg>
                <div
                  aria-hidden
                  className="absolute inset-x-0 bottom-0 h-1/3"
                  style={{
                    background:
                      "linear-gradient(to top, rgba(0,0,0,0.55), transparent)",
                  }}
                />

                {/* cantor atual */}
                <div className="absolute left-5 top-4">
                  <p className="text-[13px] font-semibold text-foreground">
                    Pedro
                  </p>
                  <p className="text-[11px] text-foreground-muted">
                    cantando agora
                  </p>
                </div>

                {/* letra sincronizada — no desktop desloca para a direita
                    para não ficar atrás do mockup do celular */}
                <div className="absolute bottom-20 left-5 max-w-[62%] lg:left-[32%] lg:max-w-[40%]">
                  <p className="text-base font-bold leading-tight text-foreground sm:text-xl lg:text-2xl">
                    Hoje a noite
                  </p>
                  <p className="bg-gradient-to-r from-primary to-secondary bg-clip-text text-base font-bold leading-tight text-transparent sm:text-xl lg:text-2xl">
                    não tem fim
                  </p>
                  <p className="mt-1 text-base font-bold leading-tight text-foreground-muted/70 sm:text-xl lg:text-2xl">
                    Pode chegar
                  </p>
                  <p className="text-base font-bold leading-tight text-foreground-muted/70 sm:text-xl lg:text-2xl">
                    pra cá
                  </p>
                </div>

                {/* ranking ao vivo */}
                <div className="absolute right-3 top-3 hidden w-[190px] rounded-xl border border-white/10 bg-background/70 p-3 backdrop-blur-glass sm:block">
                  <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-foreground-muted">
                    <Avatar name="R" size={16} className="text-[8px]" />
                    Ranking da Jam
                  </div>
                  <div className="divide-y divide-border/60">
                    {RANKING.map((row) => (
                      <RankRow key={row.pos} {...row} />
                    ))}
                  </div>
                </div>

                {/* barra inferior: próxima música + código da jam.
                    No desktop, o padding-left abre espaço para o mockup
                    do celular que cobre o canto inferior esquerdo da TV. */}
                <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-4 bg-background/85 px-5 py-3 backdrop-blur-glass lg:pl-[215px]">
                  <div>
                    <p className="text-[11px] text-foreground-muted">Próxima</p>
                    <p className="text-[13px] font-semibold text-foreground">
                      Evidências{" "}
                      <span className="font-normal text-foreground-muted">
                        · Ana
                      </span>
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="text-[11px] text-foreground-muted">
                        Entre na Jam
                      </p>
                      <p className="text-base font-bold tracking-wide text-foreground">
                        4832
                      </p>
                      <p className="hidden text-[10px] text-foreground-muted sm:block">
                        ou escaneie o QR code
                      </p>
                    </div>
                    <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-white text-background">
                      <QrCodeIcon className="h-7 w-7" />
                    </div>
                  </div>
                </div>
              </div>
              {/* pé da TV */}
              <div className="mx-auto mt-2 h-2 w-24 rounded-b-lg bg-border" />
            </div>

            {/* Celular do participante — no mobile fica abaixo da TV (sem
                esconder conteúdo); no desktop sobrepõe o canto inferior
                esquerdo da TV, área liberada pela letra e pela barra. */}
            <div className="relative z-10 mx-auto mt-6 w-[190px] rounded-[26px] border border-border bg-surface p-2 shadow-soft lg:absolute lg:-bottom-4 lg:left-0 lg:mt-0">
              <div className="overflow-hidden rounded-[19px] bg-background-secondary">
                <div className="flex items-center justify-between px-4 pt-2.5 text-[10px] text-foreground-muted">
                  <span>20:41</span>
                  <div className="flex items-center gap-1">
                    <WifiIcon className="h-3 w-3" />
                    <BatteryIcon className="h-3 w-3" />
                  </div>
                </div>

                <div className="px-4 pb-4 pt-3">
                  <p className="text-[11px] text-foreground-muted">Jam</p>
                  <p className="text-2xl font-extrabold tracking-wide text-foreground">
                    4832
                  </p>

                  <div className="mt-4 flex items-center gap-2 rounded-xl border border-border bg-surface p-2">
                    <Avatar name="Pedro" size={28} />
                    <div className="leading-tight">
                      <p className="text-[10px] text-foreground-muted">Você é</p>
                      <p className="text-[12px] font-semibold text-foreground">
                        Pedro
                      </p>
                    </div>
                  </div>

                  <div className="mt-4">
                    <p className="text-[10px] text-foreground-muted">
                      Sua posição
                    </p>
                    <p className="text-3xl font-extrabold text-foreground">
                      #2
                    </p>
                  </div>

                  <Button
                    variant="primary"
                    className="mt-4 w-full justify-center gap-2 py-2.5 text-[13px]"
                  >
                    <PlusIcon className="h-4 w-4" />
                    Adicionar música
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
