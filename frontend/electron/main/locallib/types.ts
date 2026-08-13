/** 本地文件夹扫描出的图片文件（渲染层以 Emoji 形式展示，source='FOLDER'） */
export interface LocalFileEmoji {
  /** 唯一 ID：local_ + 路径 hash（稳定、非负数，可作前端 key / 收藏去重） */
  id: string
  /** 文件名（不含扩展名） */
  name: string
  /** locallib:// 协议地址（渲染层 img src 用，主进程读文件返回） */
  url: string
  /** 真实磁盘绝对路径（点击发送时直接传给 clipboard 本地路径分支） */
  localPath: string
  /** 直接父目录名（本地搜索范围之一） */
  parentDir: string
  /** 预留：AI 标签（后续语义搜索/自动打标写入） */
  tags: string
  /** 图片扩展名（小写，无点） */
  ext: string
  /** 文件大小（字节） */
  size: number
  /** 最后修改时间（毫秒） */
  mtime: number
  /** 重复检测：是否被标记为重复（高度相似/相似） */
  duplicate?: boolean
  /** 重复等级：high=高度相似（红角标），similar=相似（黄角标） */
  duplicateLevel?: 'high' | 'similar'
  /** 组代表文件的 id（此文件与它重复/相似） */
  duplicateOf?: string
  /** 与组代表的相似度百分比（0~100；汉明距离换算，md5 精确重复为 100） */
  similarity?: number
}

/** 本地图库整体状态（设置页 + 自定义分类展示用） */
export interface LocalLibraryState {
  /** 已托管的文件夹绝对路径列表 */
  folders: string[]
  /** 忽略名单（从软件移除但保留磁盘文件） */
  ignored: string[]
  /** 全部扫描结果（已排除忽略/隐藏/非图片，按文件夹+名称排序） */
  files: LocalFileEmoji[]
  /** 相似度算法：dHash（默认）/ pHash（DCT，对压缩/旋转更鲁棒） */
  hashType: 'dHash' | 'pHash'
}
