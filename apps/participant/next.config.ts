import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@jamroom/ui", "@jamroom/shared-types"],
  // Next 16 bloqueia assets de dev acessados por outra origem (ex: celular
  // entrando pelo IP da máquina na rede local). Se o IP da máquina mudar
  // (DHCP), atualizar aqui também.
  allowedDevOrigins: ["192.168.15.14"],
};

export default nextConfig;
