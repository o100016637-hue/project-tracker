import { defineConfig } from 'vite';
    import react from '@vitejs/plugin-react';

    export default defineConfig({
      plugins: [react()],
      build: {
        rollupOptions: {
          // FIX: 這是解決 Firebase 導入路徑問題的關鍵配置
          // 排除掉所有以 'firebase/' 開頭的導入，讓它們在運行時從正確的模塊載入。
          external: [/^firebase\/.*/],
        },
      },
    });