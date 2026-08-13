// 读取当前系统剪贴板内容（图片/文本/文件名列表）
const { app, clipboard, nativeImage } = require('electron')

app.whenReady().then(() => {
  const img = clipboard.readImage()
  const txt = clipboard.readText()
  let fileNames = ''
  try {
    const buf = clipboard.readBuffer('FileNameW')
    fileNames = buf ? buf.length + ' bytes' : 'empty'
  } catch (e) {
    fileNames = 'error: ' + e.message
  }
  console.log('[clip] 图片: isEmpty=' + img.isEmpty() + ' size=' + JSON.stringify(img.getSize()))
  console.log('[clip] 文本: ' + JSON.stringify((txt || '').slice(0, 80)))
  console.log('[clip] FileNameW: ' + fileNames)
  app.exit(0)
})
