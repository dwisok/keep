import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // TAPE — surveillance-tape DA (charcoal + warm phosphor)
        bg: "#0B0D0B", // base charbon, sous-ton phosphore chaud
        panel: "#111511", // console / panneaux
        hairline: "#212821", // filets / splice
        ink: "#E8F0E4", // phosphore premier plan
        dim: "#6E7A6C", // static / secondaire
        buy: "#4CE07E",
        sell: "#FF5A3C",
        pool: "#56C8E8",
        xfer: "#EFB13C", // seed
      },
      fontFamily: {
        mono: ['ui-monospace', '"SF Mono"', '"Cascadia Mono"', '"JetBrains Mono"', 'Menlo', 'Consolas', 'monospace'],
        // condensed display face for tape wordmarks / big headlines
        disp: ['Haettenschweiler', '"Arial Narrow"', 'Impact', '"Franklin Gothic Medium"', 'sans-serif'],
      },
      borderRadius: {
        DEFAULT: "2px",
      },
    },
  },
  plugins: [],
};
export default config;
