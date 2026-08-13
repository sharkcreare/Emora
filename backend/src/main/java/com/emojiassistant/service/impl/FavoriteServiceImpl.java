package com.emojiassistant.service.impl;

import com.emojiassistant.common.BusinessException;
import com.emojiassistant.entity.Emoji;
import com.emojiassistant.entity.Favorite;
import com.emojiassistant.mapper.EmojiMapper;
import com.emojiassistant.mapper.FavoriteMapper;
import com.emojiassistant.service.FavoriteService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

/**
 * 收藏业务实现
 */
@Service
@RequiredArgsConstructor
public class FavoriteServiceImpl implements FavoriteService {

    private final FavoriteMapper favoriteMapper;
    private final EmojiMapper emojiMapper;

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void add(Long emojiId, String userId) {
        if (emojiId == null || emojiMapper.selectById(emojiId) == null) {
            throw new BusinessException("表情不存在");
        }
        if (favoriteMapper.countByUserAndEmoji(userId, emojiId) > 0) {
            return; // 已收藏，幂等
        }
        Favorite favorite = new Favorite();
        favorite.setUserId(userId);
        favorite.setEmojiId(emojiId);
        favoriteMapper.insert(favorite);
    }

    @Override
    public void remove(Long emojiId, String userId) {
        favoriteMapper.deleteByUserAndEmoji(userId, emojiId);
    }

    @Override
    public List<Emoji> list(String userId) {
        return emojiMapper.selectFavoritesByUser(userId);
    }
}
