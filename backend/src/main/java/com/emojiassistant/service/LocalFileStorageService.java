package com.emojiassistant.service;

import com.emojiassistant.common.BusinessException;
import com.emojiassistant.config.AppProperties;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

/**
 * 本地磁盘存储：desktop / dev 模式无 MinIO 时的上传降级方案。
 * 文件写入 app.upload-dir，返回相对路径 /uploads/xxx，由 WebConfig 静态映射提供访问。
 */
@Service
@RequiredArgsConstructor
public class LocalFileStorageService {

    private final AppProperties appProperties;

    /** 上传文件，返回可访问的相对 URL（如 /uploads/2026/08/xxx.png） */
    public String upload(MultipartFile file, String objectName) {
        try {
            Path dir = Path.of(appProperties.getUploadDir());
            Files.createDirectories(dir);
            Path target = dir.resolve(objectName).normalize();
            if (!target.startsWith(dir)) {
                throw new BusinessException("非法的存储路径");
            }
            Files.createDirectories(target.getParent());
            file.transferTo(target.toAbsolutePath());
            return "/uploads/" + objectName;
        } catch (IOException e) {
            throw new BusinessException("本地存储写入失败: " + e.getMessage());
        }
    }
}
