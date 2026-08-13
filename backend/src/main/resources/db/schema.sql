-- 表情包助手数据库表结构（MySQL 8，utf8mb4）

CREATE TABLE IF NOT EXISTS emoji (
  id          BIGINT       NOT NULL AUTO_INCREMENT COMMENT '主键',
  name        VARCHAR(64)  NOT NULL COMMENT '表情名称',
  url         VARCHAR(512) NOT NULL COMMENT '图片地址（相对路径或完整 URL）',
  tags        VARCHAR(512) NOT NULL DEFAULT '' COMMENT '逗号分隔的标签，用于搜索',
  description VARCHAR(512) NULL COMMENT '语义描述（AI 语义搜索用，可空）',
  category    VARCHAR(32)  NOT NULL DEFAULT 'funny' COMMENT '分类 code：funny/animal/emoji/custom',
  hot_score   INT          NOT NULL DEFAULT 0 COMMENT '热度分',
  source      VARCHAR(16)  NOT NULL DEFAULT 'LOCAL' COMMENT '来源：LOCAL/UPLOAD/NETWORK',
  create_time DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (id),
  KEY idx_category (category),
  KEY idx_hot (hot_score)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT ='表情包';

-- 兼容已有库：为 emoji 表补充 description 列（重复执行报“列已存在”，由 continue-on-error 容忍）
ALTER TABLE emoji ADD COLUMN description VARCHAR(512) NULL COMMENT '语义描述（AI 语义搜索用，可空）';

CREATE TABLE IF NOT EXISTS category (
  id         BIGINT      NOT NULL AUTO_INCREMENT COMMENT '主键',
  name       VARCHAR(32) NOT NULL COMMENT '分类名',
  code       VARCHAR(32) NOT NULL COMMENT '分类 code，唯一',
  sort_order INT         NOT NULL DEFAULT 0 COMMENT '排序',
  PRIMARY KEY (id),
  UNIQUE KEY uk_code (code)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT ='表情分类';

CREATE TABLE IF NOT EXISTS favorite (
  id          BIGINT      NOT NULL AUTO_INCREMENT COMMENT '主键',
  user_id     VARCHAR(64) NOT NULL DEFAULT 'default-user' COMMENT '用户标识',
  emoji_id    BIGINT      NOT NULL COMMENT '表情 id',
  create_time DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '收藏时间',
  PRIMARY KEY (id),
  UNIQUE KEY uk_user_emoji (user_id, emoji_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT ='收藏';

CREATE TABLE IF NOT EXISTS recent_use (
  id           BIGINT      NOT NULL AUTO_INCREMENT COMMENT '主键',
  user_id      VARCHAR(64) NOT NULL DEFAULT 'default-user' COMMENT '用户标识',
  emoji_id     BIGINT      NOT NULL COMMENT '表情 id',
  use_count    INT         NOT NULL DEFAULT 0 COMMENT '使用次数',
  last_used_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '最近使用时间',
  PRIMARY KEY (id),
  UNIQUE KEY uk_user_emoji (user_id, emoji_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT ='最近使用';

CREATE TABLE IF NOT EXISTS search_history (
  id          BIGINT      NOT NULL AUTO_INCREMENT COMMENT '主键',
  user_id     VARCHAR(64) NOT NULL DEFAULT 'default-user' COMMENT '用户标识',
  keyword     VARCHAR(64) NOT NULL COMMENT '搜索关键词',
  create_time DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '搜索时间',
  PRIMARY KEY (id),
  KEY idx_user_time (user_id, create_time)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT ='搜索历史';
