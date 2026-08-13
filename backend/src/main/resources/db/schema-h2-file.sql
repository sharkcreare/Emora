-- H2 文件库表结构（幂等：CREATE TABLE IF NOT EXISTS，重启不丢收藏/最近使用）

CREATE TABLE IF NOT EXISTS emoji (
  id          BIGINT       AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(64)  NOT NULL,
  url         VARCHAR(512) NOT NULL,
  tags        VARCHAR(512) NOT NULL DEFAULT '',
  description VARCHAR(512) NULL,
  category    VARCHAR(32)  NOT NULL DEFAULT 'funny',
  hot_score   INT          NOT NULL DEFAULT 0,
  source      VARCHAR(16)  NOT NULL DEFAULT 'LOCAL',
  create_time TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 兼容已有库：补充 description 列（AI 语义搜索用；IF NOT EXISTS 幂等）
ALTER TABLE emoji ADD COLUMN IF NOT EXISTS description VARCHAR(512) NULL;

CREATE INDEX IF NOT EXISTS idx_category ON emoji (category);
CREATE INDEX IF NOT EXISTS idx_hot ON emoji (hot_score);

CREATE TABLE IF NOT EXISTS category (
  id         BIGINT      AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(32) NOT NULL,
  code       VARCHAR(32) NOT NULL,
  sort_order INT         NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS uk_code ON category (code);

CREATE TABLE IF NOT EXISTS favorite (
  id          BIGINT      AUTO_INCREMENT PRIMARY KEY,
  user_id     VARCHAR(64) NOT NULL DEFAULT 'default-user',
  emoji_id    BIGINT      NOT NULL,
  create_time TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uk_user_emoji ON favorite (user_id, emoji_id);

CREATE TABLE IF NOT EXISTS recent_use (
  id           BIGINT      AUTO_INCREMENT PRIMARY KEY,
  user_id      VARCHAR(64) NOT NULL DEFAULT 'default-user',
  emoji_id     BIGINT      NOT NULL,
  use_count    INT         NOT NULL DEFAULT 0,
  last_used_at TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uk_user_emoji_recent ON recent_use (user_id, emoji_id);

CREATE TABLE IF NOT EXISTS search_history (
  id          BIGINT      AUTO_INCREMENT PRIMARY KEY,
  user_id     VARCHAR(64) NOT NULL DEFAULT 'default-user',
  keyword     VARCHAR(64) NOT NULL,
  create_time TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_time ON search_history (user_id, create_time);
