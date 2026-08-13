package com.emojiassistant.service.impl;

import com.emojiassistant.common.BusinessException;
import com.emojiassistant.config.MinioProperties;
import com.emojiassistant.service.MinioService;
import io.minio.BucketExistsArgs;
import io.minio.MakeBucketArgs;
import io.minio.MinioClient;
import io.minio.PutObjectArgs;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.InputStream;

/**
 * MinIO 上传实现。
 * 本地开发默认 {@code public read} 桶策略以便图片直链访问；
 * 生产环境可改用预签名 URL（{@code getPresignedObjectUrl}）。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class MinioServiceImpl implements MinioService {

    private final MinioClient minioClient;
    private final MinioProperties properties;

    @Override
    public String upload(MultipartFile file, String objectName) {
        try {
            ensureBucket();
            try (InputStream in = file.getInputStream()) {
                minioClient.putObject(PutObjectArgs.builder()
                        .bucket(properties.getBucket())
                        .object(objectName)
                        .stream(in, file.getSize(), -1)
                        .contentType(file.getContentType())
                        .build());
            }
            return properties.getEndpoint() + "/" + properties.getBucket() + "/" + objectName;
        } catch (BusinessException e) {
            throw e;
        } catch (Exception e) {
            log.error("MinIO 上传失败", e);
            throw new BusinessException("文件上传失败（请确认 MinIO 已启动）: " + e.getMessage());
        }
    }

    private void ensureBucket() throws Exception {
        boolean exists = minioClient.bucketExists(
                BucketExistsArgs.builder().bucket(properties.getBucket()).build());
        if (!exists) {
            minioClient.makeBucket(MakeBucketArgs.builder().bucket(properties.getBucket()).build());
        }
    }
}
