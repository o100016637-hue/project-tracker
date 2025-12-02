import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './', // <--- 這就是關鍵的修正配置
  build: {
    rollupOptions: {
      // 排除掉所有以 'firebase/' 開頭的導入
      external: [/^firebase\/.*/],
    },
  },
});