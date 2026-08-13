package com.emojiassistant.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.emojiassistant.entity.SearchHistory;
import org.apache.ibatis.annotations.Param;

import java.util.List;

public interface SearchHistoryMapper extends BaseMapper<SearchHistory> {

    /** 最近搜索关键词（按关键词去重，取最新一条时间） */
    List<SearchHistory> selectRecent(@Param("userId") String userId, @Param("limit") int limit);

    /** 清空某用户全部搜索历史 */
    int deleteByUser(@Param("userId") String userId);

    /** 超出保留条数的旧记录删除（每天定时任务调用） */
    int trimHistory(@Param("userId") String userId, @Param("keepCount") int keepCount);
}
