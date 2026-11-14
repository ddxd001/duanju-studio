import path from "path"
import net from "node:net"
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import react from "@vitejs/plugin-react"
import { defineConfig, type Plugin } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'

const __dirname2 = path.dirname(fileURLToPath(import.meta.url))
const IMAGE_SERVER_PORT = 7101

/** 探测 7101 端口是否已有图像生成服务在监听 */
function isPortListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host: '127.0.0.1' })
    sock.once('connect', () => { sock.destroy(); resolve(true) })
    sock.once('error', () => resolve(false))
    sock.setTimeout(800, () => { sock.destroy(); resolve(false) })
  })
}

/**
 * 图像生成服务自启动插件:
 * 无论通过预览卡片(npm run dev)还是启动脚本打开,
 * 只要 7101 没有服务,就自动拉起 server/image-server.mjs,
 * 前端退出时一并关闭。
 */
function imageServerSidecar(): Plugin {
  let child: ReturnType<typeof spawn> | null = null
  return {
    name: 'duanju-image-server-sidecar',
    async configureServer() {
      if (await isPortListening(IMAGE_SERVER_PORT)) {
        console.log('[短剧工坊] 图像生成服务已在运行,跳过自启动')
        return
      }
      const script = path.join(__dirname2, 'server', 'image-server.mjs')
      child = spawn(process.execPath, [script], { stdio: 'inherit', windowsHide: true })
      child.on('error', (e) => console.error('[短剧工坊] 图像生成服务启动失败:', e.message))
      console.log(`[短剧工坊] 已自动拉起图像生成服务: http://127.0.0.1:${IMAGE_SERVER_PORT}`)
      const stop = () => { child?.kill() }
      process.on('exit', stop)
      process.on('SIGINT', () => { stop(); process.exit(0) })
      process.on('SIGTERM', () => { stop(); process.exit(0) })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [inspectAttr(), react(), imageServerSidecar()],
  server: {
    port: 3000,
    proxy: {
      // 内置图像生成服务(上面的插件会自动拉起);
      // 生成的图片写入 public/generated/,由 Vite 直接提供
      '/api': `http://127.0.0.1:${IMAGE_SERVER_PORT}`,
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
