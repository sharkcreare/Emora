package com.emojiassistant.service;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.emojiassistant.entity.Emoji;

import java.util.List;

/**
 * 表情业务接口
 */
public interface EmojiService {

    /** 关键词搜索（会记录搜索历史） */
    Page<Emoji> search(String keyword, int page, int size, String userId);

    /** 网络图库浏览（无关键词随机，供「梗图库」标签；网络关闭或无可用来源时返回空列表） */
    List<Emoji> browseNetwork(int count);

    /** 热门表情（Redis 缓存） */
    List<Emoji> hot(int size);

    /** 按分类分页查询 */
    Page<Emoji> byCategory(String category, int page, int size);

    /** 最近使用 */
    List<Emoji> recent(String userId, int size);

    /** 使用一次：热度 +1、写入最近使用、刷新缓存 */
    void recordUse(Long id, String userId);

    /** 新增表情（管理/上传用） */
    Emoji create(Emoji emoji);

    /** 删除表情（仅允许自定义上传的 UPLOAD 记录，同时清理收藏/最近使用关联） */
    void delete(Long id, String userId);
}
