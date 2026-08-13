-- H2 开发库种子数据（内存库每次启动全新，直接 INSERT）

INSERT INTO category (id, name, code, sort_order) VALUES
  (1, '搞笑', 'funny', 1),
  (2, '动物', 'animal', 2),
  (3, '表情', 'emoji', 3),
  (4, '自定义', 'custom', 4);

INSERT INTO emoji (id, name, url, tags, description, category, hot_score, source, create_time) VALUES
  (1,  '狗头',     '/static/emojis/emoji-01.png', '狗头,阴阳,嘲讽',              '一条狗头，阴阳怪气地嘲讽朋友，欠揍又好笑',                     'funny',  999, 'LOCAL', CURRENT_TIMESTAMP),
  (2,  '黑人问号', '/static/emojis/emoji-02.png', '黑人问号,疑惑,震惊,我服了',   '黑人小哥满脸问号，表示疑惑、震惊、不敢相信',                   'funny',  950, 'LOCAL', CURRENT_TIMESTAMP),
  (3,  '震惊猫',   '/static/emojis/emoji-03.png', '震惊猫,惊讶,猫,我服了',       '猫咪被吓到瞪大双眼，表达震惊和惊讶',                           'animal', 920, 'LOCAL', CURRENT_TIMESTAMP),
  (4,  '裂开',     '/static/emojis/emoji-04.png', '裂开,崩溃,无语,我服了',       '听到老板让我加班时崩溃无语，整个人裂开的表情',                 'emoji',  900, 'LOCAL', CURRENT_TIMESTAMP),
  (5,  '疯狂大笑', '/static/emojis/emoji-05.png', '大笑,哈哈,开心',              '疯狂大笑，表达非常开心快乐，哈哈哈',                           'funny',  880, 'LOCAL', CURRENT_TIMESTAMP),
  (6,  '熊猫头',   '/static/emojis/emoji-06.png', '熊猫,卖萌',                   '可爱的熊猫头，卖萌专用，无辜又可爱',                           'animal', 860, 'LOCAL', CURRENT_TIMESTAMP),
  (7,  '无语',     '/static/emojis/emoji-07.png', '无语,翻白眼',                 '翻白眼无语，表达无奈、无语、不想说话',                         'emoji',  840, 'LOCAL', CURRENT_TIMESTAMP),
  (8,  '摸鱼',     '/static/emojis/emoji-08.png', '摸鱼,打工,划水',              '上班摸鱼划水，打工人的日常，累了就摸鱼',                       'funny',  820, 'LOCAL', CURRENT_TIMESTAMP),
  (9,  '点赞',     '/static/emojis/emoji-09.png', '点赞,赞,666',                 '竖起大拇指点赞，表达赞、666、厉害',                           'emoji',  800, 'LOCAL', CURRENT_TIMESTAMP),
  (10, '干饭',     '/static/emojis/emoji-10.png', '干饭,吃饭,饿',                '干饭人干饭魂，饿了要吃饭，干饭最积极',                         'animal', 780, 'LOCAL', CURRENT_TIMESTAMP);
