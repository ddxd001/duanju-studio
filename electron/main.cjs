// ============ 短剧工坊 · 桌面版主进程 ============
// 职责:
//  1. 拉起本地代理与媒体服务(server/image-server.mjs,以 Node 方式运行)
//  2. 起一个本地静态服务托管前端(dist),提供 /generated(含 Range 视频拖拽支持),并把 /api 代理给 7101
//  3. 创建应用窗口
const { app, BrowserWindow } = require('electron')
const http = require('node:http')
const path = require('node:path')
const fs = require('node:fs')
const net = require('node:net')
const { spawn } = require('node:child_process')

const APP_NAME = '短剧工坊'
const STATIC_PORT = 7100
const IMAGE_PORT = 7101

const packaged = app.isPackaged
const DIST_DIR = packaged
  ? path.join(process.resourcesPath, 'app', 'dist')
  : path.join(__dirname, '..', 'dist')
const SERVER_SCRIPT = packaged
  ? path.join(process.resourcesPath, 'server', 'image-server.mjs')
  : path.join(__dirname, '..', 'server', 'image-server.mjs')
// 生成图与缓存视频统一写到用户数据目录(安装目录可能无写权限)
const GENERATED_DIR = path.join(app.getPath('userData'), 'generated')
fs.mkdirSync(GENERATED_DIR, { recursive: true })

let imageChild = null
let staticServer = null

function portBusy(port) {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host: '127.0.0.1' })
    sock.once('connect', () => { sock.destroy(); resolve(true) })
    sock.once('error', () => resolve(false))
    sock.setTimeout(800, () => { sock.destroy(); resolve(false) })
  })
}

async function startImageServer() {
  if (await portBusy(IMAGE_PORT)) {
    console.log(`[${APP_NAME}] 7101 已有本地服务在运行,跳过自启动`)
    return
  }
  imageChild = spawn(process.execPath, [SERVER_SCRIPT], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      IMAGE_SERVER_PORT: String(IMAGE_PORT),
      IMAGE_OUT_DIR: GENERATED_DIR,
    },
    stdio: 'ignore',
    windowsHide: true,
  })
  imageChild.on('error', (e) => console.error(`[${APP_NAME}] 本地服务启动失败:`, e.message))
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
}

function proxyApi(req, res) {
  const headers = { 'Content-Type': req.headers['content-type'] || 'application/json' }
  if (req.headers.origin) headers.Origin = req.headers.origin
  const upstream = http.request(
    { host: '127.0.0.1', port: IMAGE_PORT, path: req.url, method: req.method, headers },
    (up) => {
      res.writeHead(up.statusCode || 502, up.headers)
      up.pipe(res)
    },
  )
  upstream.on('error', () => {
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: '本地媒体服务未启动,请重启应用' }))
  })
  req.pipe(upstream)
}

function serveFile(req, res, filePath) {
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      return res.end('not found')
    }
    const contentType = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream'
    const range = req.headers.range
    if (range) {
      const m = range.match(/bytes=(\d*)-(\d*)/)
      if (m) {
        const start = m[1] ? parseInt(m[1], 10) : 0
        const end = m[2] ? parseInt(m[2], 10) : stat.size - 1
        if (start >= stat.size || end >= stat.size || start > end) {
          res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` })
          return res.end()
        }
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': end - start + 1,
          'Content-Type': contentType,
        })
        return fs.createReadStream(filePath, { start, end }).pipe(res)
      }
    }
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stat.size,
      'Accept-Ranges': 'bytes',
    })
    fs.createReadStream(filePath).pipe(res)
  })
}

function startStaticServer(port) {
  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0])
      if (urlPath.startsWith('/api/')) return proxyApi(req, res)
      if (urlPath.startsWith('/generated/')) {
        const rel = urlPath.replace(/^\/generated\/+/, '')
        const f = path.resolve(GENERATED_DIR, rel)
        if (!f.startsWith(path.resolve(GENERATED_DIR))) {
          res.writeHead(403)
          return res.end()
        }
        return serveFile(req, res, f)
      }
      const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '')
      let f = path.resolve(DIST_DIR, rel)
      if (!f.startsWith(path.resolve(DIST_DIR))) {
        res.writeHead(403)
        return res.end()
      }
      if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST_DIR, 'index.html')
      serveFile(req, res, f)
    })
    srv.once('error', reject)
    srv.listen(port, '127.0.0.1', () => resolve(srv))
  })
}

async function createWindow() {
  await startImageServer()
  try {
    staticServer = await startStaticServer(STATIC_PORT)
  } catch {
    staticServer = await startStaticServer(0)
  }
  const port = staticServer.address().port

  const win = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 1024,
    minHeight: 700,
    title: APP_NAME,
    autoHideMenuBar: true,
    backgroundColor: '#0b0b10',
    webPreferences: { contextIsolation: true },
  })
  win.loadURL(`http://127.0.0.1:${port}/`)
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.whenReady().then(createWindow)
  app.on('window-all-closed', () => {
    if (imageChild) imageChild.kill()
    if (staticServer) staticServer.close()
    app.quit()
  })
}
