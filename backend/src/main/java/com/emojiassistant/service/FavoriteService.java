package com.emojiassistant.service;

import com.emojiassistant.entity.Emoji;

import java.util.List;

/**
 * 收藏业务接口
 */
public interface FavoriteService {

    /** 收藏 */
    void add(Long emojiId, String userId);

    /** 取消收藏 */
    void remove(Long emojiId, String userId);

    /** 收藏列表（含表情信息） */
    List<Emoji> list(String userId);
}
