import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#20242b",
        paper: "#f6f7f9",
        line: "#e9ecf0",
        brand: "#176bfa"
      },
      boxShadow: {
        soft: "0 8px 32px rgba(24, 32, 44, 0.09)"
      }
    }
  },
  plugins: []
};

export default config;
