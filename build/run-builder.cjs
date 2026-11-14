// 用编程方式调用 electron-builder(绕开 CLI 的参数解析问题)。
// 注意:本脚本以 ELECTRON_RUN_AS_NODE 模式运行在 Electron 内置 Node 上,
// Electron 会接管 fs 对 *.asar 路径的处理——文件不存在时抛出不带 code 的
// "Invalid package" 错误(而非 ENOENT),导致 electron-builder 的
// orNullIfFileNotExist 失效。这里把该错误补回 ENOENT。
const fs = require('fs')

function toEnoent(e) {
  if (e && typeof e.message === 'string' && e.message.startsWith('Invalid package')) {
    e.code = 'ENOENT'
  }
  return e
}
for (const fn of ['lstat', 'stat', 'open']) {
  const orig = fs[fn]
  fs[fn] = function (p, ...rest) {
    const cb = rest[rest.length - 1]
    if (typeof cb === 'function') {
      rest[rest.length - 1] = (e, ...a) => cb(e && toEnoent(e), ...a)
      return orig.call(this, p, ...rest)
    }
    return orig.call(this, p, ...rest)
  }
  const origSync = fs[`${fn}Sync`]
  fs[`${fn}Sync`] = function (...a) {
    try {
      return origSync.apply(this, a)
    } catch (e) {
      throw toEnoent(e)
    }
  }
  if (fs.promises?.[fn]) {
    const origP = fs.promises[fn].bind(fs.promises)
    fs.promises[fn] = async (...a) => {
      try {
        return await origP(...a)
      } catch (e) {
        throw toEnoent(e)
      }
    }
  }
}

const { build, Platform, Arch } = require('electron-builder')

build({
  targets: Platform.WINDOWS.createTarget(['nsis'], Arch.x64),
  publish: 'never',
})
  .then((files) => {
    console.log('BUILD OK')
    for (const f of files) console.log('  ->', f)
  })
  .catch((e) => {
    console.error('BUILD FAILED:', e.message || e)
    console.error('STACK:', e.stack || '(no stack)')
    process.exit(1)
  })
