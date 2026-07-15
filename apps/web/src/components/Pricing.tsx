import { Badge, Button, Card } from "@kantai/ui";
import { CheckIcon } from "./icons";

/**
 * Seção "Planos" da landing. O modelo de cobrança é por dia de uso
 * (pacote pré-pago, sem assinatura recorrente) — decisão registrada no
 * plano do projeto por causa de Pix/boleto. Os valores são placeholders
 * de marketing até a monetização (Fase 3) ser implementada.
 */
const PLANS: {
  name: string;
  price: string;
  priceNote: string;
  description: string;
  features: string[];
  cta: string;
  highlighted?: boolean;
}[] = [
  {
    name: "Passe do Dia",
    price: "R$ 29",
    priceNote: "por dia de uso",
    description: "Para a festa de hoje. Pague só quando usar.",
    features: [
      "Jams ilimitadas por 24h",
      "Participantes ilimitados",
      "Pontuação por voz real",
      "Ranking ao vivo na TV",
    ],
    cta: "Começar agora",
  },
  {
    name: "Pacote Festa",
    price: "R$ 99",
    priceNote: "5 dias, use quando quiser",
    description: "Para quem recebe gente sempre. Os dias não expiram.",
    features: [
      "Tudo do Passe do Dia",
      "5 dias de uso, sem validade",
      "Histórico e ranking das suas Jams",
      "Economia de 32% por dia",
    ],
    cta: "Escolher pacote",
    highlighted: true,
  },
  {
    name: "Eventos & Empresas",
    price: "Sob consulta",
    priceNote: "para bares, eventos e buffets",
    description: "Uso recorrente, várias telas e suporte dedicado.",
    features: [
      "Múltiplas Jams simultâneas",
      "Locação de equipamento (em breve)",
      "Suporte prioritário",
      "Faturamento mensal",
    ],
    cta: "Falar com a gente",
  },
];

export function Pricing() {
  return (
    <section
      id="planos"
      className="bg-background-secondary px-6 py-24 sm:px-8 lg:px-16 lg:py-32"
    >
      <div className="mx-auto max-w-[1440px]">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-extrabold tracking-tight text-foreground sm:text-title">
            Pague pelo dia, não pelo mês
          </h2>
          <p className="mt-4 text-body leading-relaxed text-foreground-muted">
            Sem assinatura, sem fidelidade. Compre um dia de karaokê quando a
            ocasião pedir — no Pix ou no cartão.
          </p>
        </div>

        <div className="mx-auto mt-14 grid max-w-5xl grid-cols-1 gap-6 lg:grid-cols-3">
          {PLANS.map((plan) => (
            <Card
              key={plan.name}
              className={
                plan.highlighted
                  ? "relative flex flex-col border-primary/60 bg-surface p-8 ring-1 ring-primary/40"
                  : "relative flex flex-col p-8"
              }
            >
              {plan.highlighted && (
                <Badge
                  variant="neutral"
                  className="absolute -top-3 left-1/2 -translate-x-1/2 border-primary/40 bg-primary/15 px-3 py-1 text-primary"
                >
                  Mais popular
                </Badge>
              )}

              <h3 className="text-subtitle font-semibold text-foreground">
                {plan.name}
              </h3>
              <p className="mt-2 text-caption text-foreground-muted">
                {plan.description}
              </p>

              <div className="mt-6">
                <span className="text-4xl font-extrabold tracking-tight text-foreground">
                  {plan.price}
                </span>
                <p className="mt-1 text-caption text-foreground-muted">
                  {plan.priceNote}
                </p>
              </div>

              <ul className="mt-6 flex flex-col gap-3">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2.5">
                    <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                    <span className="text-caption leading-relaxed text-foreground-muted">
                      {feature}
                    </span>
                  </li>
                ))}
              </ul>

              <Button
                variant={plan.highlighted ? "primary" : "secondary"}
                className="mt-8 w-full justify-center"
              >
                {plan.cta}
              </Button>
            </Card>
          ))}
        </div>

        <p className="mt-10 text-center text-caption text-foreground-muted">
          Participantes nunca pagam nada — só o anfitrião compra o dia de uso.
        </p>
      </div>
    </section>
  );
}
