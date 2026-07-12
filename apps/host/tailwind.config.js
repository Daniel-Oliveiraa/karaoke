/** @type {import('tailwindcss').Config} */
module.exports = {
  presets: [require("@jamroom/config/tailwind-preset")],
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
    "../../packages/ui/src/**/*.{js,ts,jsx,tsx}",
  ],
};
