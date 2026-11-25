// 测试桩:在 ELECTRON_RUN_AS_NODE 环境下替代 electron 模块,
// 用来无头验证打包后的 main.cjs(静态服务/代理/子进程拉起全部真实执行,
// 只跳过真实窗口创建)
const path = require('path')

module.exports = {
  app: {
    isPackaged: true,
    getPath: () => path.join(__dirname, 'userData-test'),
    requestSingleInstanceLock: () => true,
    whenReady: () => Promise.resolve(),
    on: () => {},
    quit: () => process.exit(0),
  },
  BrowserWindow: class {
    constructor(opts) {
      console.log('[stub] BrowserWindow', JSON.stringify({ w: opts.width, h: opts.height, title: opts.title }))
    }
    loadURL(u) {
      console.log('[stub] loadURL:', u)
    }
  },
}
