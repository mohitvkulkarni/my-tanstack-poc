// import react from '@vitejs/plugin-react'
// import { defineConfig } from 'vite'

// // https://vite.dev/config/
// export default defineConfig({
//   plugins: [react()],
// })
import path from "path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite"; // Add this line

export default defineConfig({
  plugins: [react(), tailwindcss()], // Add tailwindcss() here
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
