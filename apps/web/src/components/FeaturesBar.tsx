import { MicIcon, MusicNoteIcon, SmartphoneIcon, UsersIcon } from "./icons";
import type { IconProps } from "./icons";

const FEATURES: {
  icon: (props: IconProps) => React.JSX.Element;
  title: string;
  description: string;
}[] = [
  {
    icon: MicIcon,
    title: "Pontuação por voz real",
    description: "A avaliação considera afinação, ritmo e performance.",
  },
  {
    icon: MusicNoteIcon,
    title: "Catálogo completo",
    description: "Milhares de músicas com letra sincronizada.",
  },
  {
    icon: UsersIcon,
    title: "Para todos os lugares",
    description: "Ideal para bares, festas, reuniões e eventos.",
  },
  {
    icon: SmartphoneIcon,
    title: "Sem instalar nada",
    description: "É só entrar com o código e começar a cantar.",
  },
];

export function FeaturesBar() {
  return (
    <section id="recursos" className="relative -mt-16 px-6 sm:px-8 lg:px-16">
      <div className="mx-auto max-w-[1440px]">
        <div className="grid grid-cols-1 divide-y divide-border rounded-lg border border-border bg-surface/60 shadow-soft backdrop-blur-glass sm:grid-cols-2 sm:divide-y-0 sm:divide-x lg:grid-cols-4">
          {FEATURES.map(({ icon: Icon, title, description }) => (
            <div key={title} className="flex items-start gap-4 p-6 lg:p-8">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary">
                <Icon className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-body font-semibold text-foreground">
                  {title}
                </h3>
                <p className="mt-1 text-caption leading-relaxed text-foreground-muted">
                  {description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
