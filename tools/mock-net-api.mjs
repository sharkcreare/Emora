// 本地 mock 网络图库 API（Giphy/Tenor 形状的响应），用于无外网环境联调。
// 用法：node tools/mock-net-api.mjs  （监听 127.0.0.1:9999）
import http from 'node:http'

const PORT = 9999
const IMG = (n) => `http://127.0.0.1:${PORT}/img/${n}.gif`

http
  .createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`)
    res.setHeader('Content-Type', 'application/json; charset=utf-8')

    if (url.pathname.startsWith('/v1/stickers/search')) {
      // Giphy 形状：data[].id / title / images.fixed_width.url
      const data = [
        { id: 'giphy-cat-1', title: '猫猫震惊.gif', images: { fixed_width: { url: IMG('cat1') }, original: { url: IMG('cat1') } } },
        { id: 'giphy-dog-1', title: '', images: { fixed_width: { url: IMG('dog') }, original: { url: IMG('dog') } } }
      ]
      res.end(JSON.stringify({ data }))
      return
    }
    if (url.pathname === '/v2/search') {
      // Tenor 形状：results[].id / title / media_formats.gif.url（兼容 media[]）
      const results = [
        { id: 'tenor-cat-1', title: '裂开猫', media_formats: { gif: { url: IMG('t1') } } },
        { id: 'tenor-dog-1', title: '', media: [{ gif: { url: IMG('t2') } }] }
      ]
      res.end(JSON.stringify({ results }))
      return
    }
    res.statusCode = 404
    res.end('{}')
  })
  .listen(PORT, '127.0.0.1', () => console.log(`mock net api listening on 127.0.0.1:${PORT}`))
