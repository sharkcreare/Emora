package com.emojiassistant.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * 搜索历史（后续可做热词统计、搜索联想）
 */
@Data
@TableName("search_history")
public class SearchHistory {

    @TableId(type = IdType.AUTO)
    private Long id;

    private String userId;

    private String keyword;

    private LocalDateTime createTime;
}
