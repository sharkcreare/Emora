package com.emojiassistant.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.emojiassistant.entity.Favorite;
import org.apache.ibatis.annotations.Param;

/**
 * 收藏 Mapper
 */
public interface FavoriteMapper extends BaseMapper<Favorite> {

    /** 删除某用户对某表情的收藏 */
    int deleteByUserAndEmoji(@Param("userId") String userId, @Param("emojiId") Long emojiId);

    /** 判断是否已收藏 */
    long countByUserAndEmoji(@Param("userId") String userId, @Param("emojiId") Long emojiId);

    /** 删除某表情的全部收藏记录（表情删除时清理关联） */
    int deleteByEmojiId(@Param("emojiId") Long emojiId);
}
