-- H2 开发库表结构（与 schema.sql 保持字段一致，去掉 MySQL 方言）

DROP TABLE IF EXISTS search_history;
DROP TABLE IF EXISTS recent_use;
DROP TABLE IF EXISTS favorite;
DROP TABLE IF EXISTS emoji;
DROP TABLE IF EXISTS category;

CREATE TABLE emoji (
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

CREATE INDEX idx_category ON emoji (category);
CREATE INDEX idx_hot ON emoji (hot_score);

CREATE TABLE category (
  id         BIGINT      AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(32) NOT NULL,
  code       VARCHAR(32) NOT NULL,
  sort_order INT         NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX uk_code ON category (code);

CREATE TABLE favorite (
  id          BIGINT      AUTO_INCREMENT PRIMARY KEY,
  user_id     VARCHAR(64) NOT NULL DEFAULT 'default-user',
  emoji_id    BIGINT      NOT NULL,
  create_time TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX uk_user_emoji ON favorite (user_id, emoji_id);

CREATE TABLE recent_use (
  id           BIGINT      AUTO_INCREMENT PRIMARY KEY,
  user_id      VARCHAR(64) NOT NULL DEFAULT 'default-user',
  emoji_id     BIGINT      NOT NULL,
  use_count    INT         NOT NULL DEFAULT 0,
  last_used_at TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX uk_user_emoji_recent ON recent_use (user_id, emoji_id);

CREATE TABLE search_history (
  id          BIGINT      AUTO_INCREMENT PRIMARY KEY,
  user_id     VARCHAR(64) NOT NULL DEFAULT 'default-user',
  keyword     VARCHAR(64) NOT NULL,
  create_time TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_user_time ON search_history (user_id, create_time);
