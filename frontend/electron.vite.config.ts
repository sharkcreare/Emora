import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'
import { copyFileSync, mkdirSync } from 'node:fs'
import type { Plugin } from 'vite'

/** 把 AI 标签池/标签向量 JSON 复制到 out/main/ai/（worker 与主进程按路径加载） */
function copyAiJson(): Plugin {
  return {
    name: 'copy-ai-json',
    closeBundle() {
      const files = ['categories.json', 'label-embeddings.json']
      const srcDir = resolve('electron/main/ai')
      const outDir = resolve('out/main/ai')
      mkdirSync(outDir, { recursive: true })
      for (const f of files) {
        copyFileSync(resolve(srcDir, f), resolve(outDir, f))
      }
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), copyAiJson()],
    resolve: {
      alias: { '@main': resolve('electron/main') }
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve('electron/main/index.ts'),
          // GIF 压缩 worker：独立入口，主进程用 worker_threads 加载（out/main/gif-worker.js）
          'gif-worker': resolve('electron/main/media/workers/gif-worker.ts'),
          // AI 推理 worker：独立入口，主进程用 worker_threads 加载（out/main/ai-worker.js）
          'ai-worker': resolve('electron/main/ai/worker/ai-worker.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve('electron/preload/index.ts') }
      }
    }
  },
  renderer: {
    root: resolve('src'),
    resolve: {
      alias: {
        '@': resolve('src'),
        '@renderer': resolve('src')
      }
    },
    plugins: [vue(), tailwindcss()],
    build: {
      rollupOptions: {
        input: { index: resolve('src/index.html') }
      }
    }
  }
})
