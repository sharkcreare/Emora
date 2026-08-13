package com.emojiassistant.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.emojiassistant.entity.RecentUse;
import org.apache.ibatis.annotations.Param;

/**
 * 最近使用 Mapper
 */
public interface RecentUseMapper extends BaseMapper<RecentUse> {

    /** 使用次数 +1（不存在则插入），依赖 (user_id, emoji_id) 唯一键 */
    int upsertUse(@Param("userId") String userId, @Param("emojiId") Long emojiId);
}
