// 无头集成测试:加载打包产物里的 main.cjs,验证服务真实可用
const Module = require('module')
const path = require('path')

const RESOURCES = 'E:\\KimiData\\kimi\\tasks\\2026-11-06\\13-15-45-3b9bf3c8\\duanju-studio\\release\\win-unpacked\\resources'
const MAIN = path.join(RESOURCES, 'app', 'electron', 'main.cjs')

// 让 process.resourcesPath 指向打包产物的 resources 目录
try {
  Object.defineProperty(process, 'resourcesPath', { value: RESOURCES, configurable: true })
} catch (e) {
  console.error('[harness] 无法覆盖 resourcesPath:', e.message)
}

// 拦截 require('electron')
const origResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  if (request === 'electron') return path.join(__dirname, 'electron-stub.cjs')
  return origResolve.call(this, request, ...rest)
}

console.log('[harness] resourcesPath =', process.resourcesPath)
require(MAIN)
console.log('[harness] main.cjs 已加载')
