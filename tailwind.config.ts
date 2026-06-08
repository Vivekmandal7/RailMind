import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        base: "#0B0D11",
        panel: "#14171F",
        panel2: "#1A1E27",
        border: "#242A35",
        text: "#E7EAF0",
        muted: "#99A1AD",
        amber: "#F5B027",
        cyan: "#3AD0DE",
        risk: "#FF5C5C",
        safe: "#37D99A"
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"]
      },
      boxShadow: {
        glow: "0 0 12px rgba(58,208,222,0.55)",
        glowAmber: "0 0 14px rgba(245,176,39,0.55)",
        glowRisk: "0 0 16px rgba(255,92,92,0.6)"
      },
      keyframes: {
        pulseRisk: {
          "0%,100%": { opacity: "1" },
          "50%": { opacity: "0.35" }
        }
      },
      animation: {
        pulseRisk: "pulseRisk 1.1s ease-in-out infinite"
      }
    }
  },
  plugins: []
};

export default config;
