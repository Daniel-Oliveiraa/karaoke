import {
  MicIcon,
  PlusIcon,
  QrCodeIcon,
  TrophyIcon,
  UsersIcon,
} from "./icons";
import type { IconProps } from "./icons";

const STEPS: {
  icon: (props: IconProps) => React.JSX.Element;
  title: string;
  description: string;
}[] = [
  {
    icon: PlusIcon,
    title: "Crie uma Jam",
    description: "O anfitrião cria a sessão em segundos.",
  },
  {
    icon: QrCodeIcon,
    title: "Compartilhe o código",
    description: "Mostre o QR Code ou o código da Jam na TV.",
  },
  {
    icon: UsersIcon,
    title: "Todos entram",
    description: "Participantes acessam pelo celular, sem cadastro.",
  },
  {
    icon: MicIcon,
    title: "Cantem juntos",
    description: "Escolham músicas, cantem e divirtam-se!",
  },
  {
    icon: TrophyIcon,
    title: "Ranking ao vivo",
    description: "Pontuação em tempo real e disputa pelo topo.",
  },
];

export function HowItWorks() {
  return (
    <section id="como-funciona" className="px-6 py-24 sm:px-8 lg:px-16 lg:py-32">
      <div className="mx-auto max-w-[1440px]">
        <h2 className="text-center text-3xl font-extrabold tracking-tight text-foreground sm:text-title">
          Como funciona
        </h2>

        <div className="relative mt-16 grid grid-cols-1 gap-y-12 sm:grid-cols-2 lg:grid-cols-5 lg:gap-x-6 lg:gap-y-0">
          <div
            aria-hidden
            className="absolute left-[10%] right-[10%] top-8 hidden border-t-2 border-dashed border-border lg:block"
          />
          {STEPS.map(({ icon: Icon, title, description }, index) => (
            <div key={title} className="relative flex flex-col items-center text-center">
              <div className="relative z-10 flex h-16 w-16 items-center justify-center rounded-2xl border border-border bg-surface text-primary">
                <Icon className="h-6 w-6" />
              </div>
              <p className="mt-5 text-body font-semibold text-foreground">
                <span className="text-primary">{index + 1}</span> {title}
              </p>
              <p className="mt-2 max-w-[220px] text-caption leading-relaxed text-foreground-muted">
                {description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
