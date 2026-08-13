package com.emojiassistant.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * 表情包
 */
@Data
@TableName("emoji")
public class Emoji {

    @TableId(type = IdType.AUTO)
    private Long id;

    /** 名称 */
    private String name;

    /** 图片地址（相对路径或完整 URL） */
    private String url;

    /** 逗号分隔的标签 */
    private String tags;

    /** 语义描述（AI 语义搜索用，可空）：一句话描述表情表达的情绪/场景 */
    private String description;

    /** AI 语义搜索相似度（0~1，仅搜索响应返回供前端展示"AI 推荐"角标，不入库） */
    @TableField(exist = false)
    private Double semanticScore;

    /** 分类 code：funny / animal / emoji / custom */
    private String category;

    /** 热度分 */
    private Integer hotScore;

    /** 来源：LOCAL / UPLOAD / NETWORK */
    private String source;

    private LocalDateTime createTime;
}
