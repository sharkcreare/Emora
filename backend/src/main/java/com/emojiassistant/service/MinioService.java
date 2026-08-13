package com.emojiassistant.service;

import org.springframework.web.multipart.MultipartFile;

/**
 * 对象存储服务（MinIO）
 */
public interface MinioService {

    /** 上传文件，返回可访问 URL */
    String upload(MultipartFile file, String objectName);
}
