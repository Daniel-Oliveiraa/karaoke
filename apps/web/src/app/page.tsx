import { DemoSection } from "@/components/DemoSection";
import { Faq } from "@/components/Faq";
import { FeaturesBar } from "@/components/FeaturesBar";
import { Footer } from "@/components/Footer";
import { Hero } from "@/components/Hero";
import { HowItWorks } from "@/components/HowItWorks";
import { Navbar } from "@/components/Navbar";
import { Pricing } from "@/components/Pricing";

// Estrutura documentada da Landing (docs/layoutDesc_extracted.txt):
// Hero → Como funciona → Benefícios → Demonstração → Planos → FAQ → Footer.
// A FeaturesBar (benefícios) fica ancorada ao Hero por design (-mt overlap).
export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <Navbar />
      <main className="flex-1">
        <Hero />
        <FeaturesBar />
        <HowItWorks />
        <DemoSection />
        <Pricing />
        <Faq />
      </main>
      <Footer />
    </div>
  );
}
