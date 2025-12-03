import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './', // 保持相對路徑，避免白屏
  // 注意：我們移除了 build: { rollupOptions: { external: ... } } 區塊
  // 這樣 Vite 就會正確地將 Firebase 打包進去，瀏覽器就不會報錯了。
});
