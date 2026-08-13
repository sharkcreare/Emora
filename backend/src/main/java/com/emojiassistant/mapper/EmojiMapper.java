package com.emojiassistant.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.emojiassistant.entity.Emoji;
import org.apache.ibatis.annotations.Param;

import java.util.List;

/**
 * 表情 Mapper（模糊搜索等复杂查询见 resources/mapper/EmojiMapper.xml）
 */
public interface EmojiMapper extends BaseMapper<Emoji> {

    /** 关键词模糊搜索（名称/标签/分类），按热度排序 */
    List<Emoji> searchByKeyword(@Param("keyword") String keyword,
                                @Param("offset") long offset,
                                @Param("limit") long limit);

    /** 关键词搜索结果总数 */
    long countByKeyword(@Param("keyword") String keyword);

    /** 按分类分页查询 */
    List<Emoji> selectByCategory(@Param("category") String category,
                                 @Param("offset") long offset,
                                 @Param("limit") long limit);

    /** 按分类统计总数 */
    long countByCategory(@Param("category") String category);

    /** 热度 +1 */
    int incrementHotScore(@Param("id") Long id);

    /** 按热度取前 N 个 */
    List<Emoji> selectHot(@Param("limit") long limit);

    /** 某用户最近使用的表情（按最近使用时间倒序） */
    List<Emoji> selectRecentByUser(@Param("userId") String userId, @Param("limit") long limit);

    /** 某用户的收藏表情（按收藏时间倒序） */
    List<Emoji> selectFavoritesByUser(@Param("userId") String userId);

    /** 热度时间衰减：超过 10 的每日 ×0.9（定时任务调用） */
    int decayHotScore();
}
