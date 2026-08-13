package com.emojiassistant.controller;

import com.emojiassistant.common.BusinessException;
import com.emojiassistant.common.Result;
import com.emojiassistant.config.AppProperties;
import com.emojiassistant.entity.Emoji;
import com.emojiassistant.service.EmojiService;
import com.emojiassistant.service.LocalFileStorageService;
import com.emojiassistant.service.MinioService;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 用户上传表情：存入 MinIO / 本地磁盘，并自动创建「自定义」分类下的表情记录。
 * 安全防护：Content-Type + 文件头魔数双重校验、大小限制、文件名清洗、按 IP 简单限频。
 */
@RestController
@RequestMapping("/api/upload")
@RequiredArgsConstructor
public class UploadController {

    private static final Set<String> ALLOWED_TYPES = Set.of(
            "image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp");

    /** 单文件上限 20MB（与前端一致） */
    private static final long MAX_FILE_SIZE = 20L * 1024 * 1024;

    /** 每个 IP 每分钟最多上传次数 */
    private static final int MAX_UPLOADS_PER_MINUTE = 20;

    private static final Map<String, Deque<Long>> UPLOAD_QUEUES = new ConcurrentHashMap<>();

    private final MinioService minioService;
    private final LocalFileStorageService localFileStorageService;
    private final EmojiService emojiService;
    private final AppProperties appProperties;

    @PostMapping
    public Result<Emoji> upload(@RequestParam("file") MultipartFile file, HttpServletRequest request) {
        String contentType = file.getContentType();
        if (file.isEmpty() || contentType == null || !ALLOWED_TYPES.contains(contentType.toLowerCase(Locale.ROOT))) {
            throw new BusinessException("仅支持 png / jpg / gif / webp / bmp 图片");
        }
        if (file.getSize() > MAX_FILE_SIZE) {
            throw new BusinessException("图片大小不能超过 20MB");
        }

        String clientIp = clientIpOf(request);
        rateLimit(clientIp);

        byte[] bytes;
        try {
            bytes = file.getBytes();
        } catch (Exception e) {
            throw new BusinessException("读取上传文件失败");
        }

        // 魔数校验：Content-Type 可被伪造，文件头才是真实格式
        String magicExt = magicExtOf(bytes);
        if (magicExt.isEmpty()) {
            throw new BusinessException("文件内容不是有效图片（文件头校验失败）");
        }
        String contentTypeExt = extOfContentType(contentType);
        // Content-Type 与魔数冲突（如伪装成 png 的 exe）一律拒绝
        if (!contentTypeExt.equals(magicExt)) {
            throw new BusinessException("文件类型与内容不符，已拒绝（防止伪装文件）");
        }

        String safeName = sanitizeName(file.getOriginalFilename(), magicExt);
        String ext = extensionOf(safeName);
        String datePath = LocalDate.now().format(DateTimeFormatter.ofPattern("yyyy/MM"));
        String objectName = datePath + "/" + UUID.randomUUID().toString().replace("-", "") + "." + ext;

        // storage-mode=minio 时走对象存储，其余（默认 local）落到本地磁盘，无外部依赖
        String url = "minio".equalsIgnoreCase(appProperties.getStorageMode())
                ? minioService.upload(file, objectName)
                : localFileStorageService.upload(file, objectName);

        Emoji emoji = new Emoji();
        emoji.setName(stripExtension(safeName));
        emoji.setUrl(url);
        emoji.setTags("自定义");
        emoji.setCategory("custom");
        emoji.setSource("UPLOAD");
        return Result.ok(emojiService.create(emoji));
    }

    /** 取真实客户端 IP（穿透常见的 X-Forwarded-For 单层代理） */
    private String clientIpOf(HttpServletRequest request) {
        String forwarded = request.getHeader("X-Forwarded-For");
        if (forwarded != null && !forwarded.isBlank()) {
            String first = forwarded.split(",")[0].trim();
            if (!first.isBlank()) return first;
        }
        String remote = request.getRemoteAddr();
        return remote == null ? "unknown" : remote;
    }

    /** 简单滑动窗口限频：同一 IP 每分钟最多 20 次上传 */
    private void rateLimit(String ip) {
        long now = System.currentTimeMillis();
        Deque<Long> queue = UPLOAD_QUEUES.computeIfAbsent(ip, k -> new ArrayDeque<>());
        synchronized (queue) {
            long windowStart = now - 60_000L;
            while (!queue.isEmpty() && queue.peekFirst() < windowStart) {
                queue.pollFirst();
            }
            if (queue.size() >= MAX_UPLOADS_PER_MINUTE) {
                throw new BusinessException("上传太频繁，请稍后再试");
            }
            queue.addLast(now);
        }
    }

    /** 按文件头魔数嗅探真实图片格式；非图片返回空串 */
    private String magicExtOf(byte[] b) {
        int len = b.length;
        if (len >= 4 && (b[0] & 0xff) == 0x89 && b[1] == 'P' && b[2] == 'N' && b[3] == 'G') return "png";
        if (len >= 3 && b[0] == 'G' && b[1] == 'I' && b[2] == 'F') return "gif";
        if (len >= 3 && (b[0] & 0xff) == 0xff && (b[1] & 0xff) == 0xd8 && (b[2] & 0xff) == 0xff) return "jpg";
        if (len >= 12 && b[0] == 'R' && b[1] == 'I' && b[2] == 'F' && b[3] == 'F'
                && b[8] == 'W' && b[9] == 'E' && b[10] == 'B' && b[11] == 'P') return "webp";
        if (len >= 2 && b[0] == 'B' && b[1] == 'M') return "bmp";
        return "";
    }

    private String extOfContentType(String contentType) {
        return switch (contentType.toLowerCase(Locale.ROOT)) {
            case "image/png" -> "png";
            case "image/jpeg" -> "jpg";
            case "image/gif" -> "gif";
            case "image/webp" -> "webp";
            case "image/bmp" -> "bmp";
            default -> "";
        };
    }

    /** 清洗文件名：去掉路径分隔符/控制字符/系统保留名，空则给默认名 */
    private String sanitizeName(String filename, String defaultExt) {
        String name = filename == null ? "" : filename.trim();
        // 去掉 \ / : * ? " < > | 与所有控制字符
        name = name.replaceAll("[\\\\/:*?\"<>|\\x00-\\x1f]", "");
        if (name.isEmpty() || name.equals(".") || name.equals("..")) {
            return "未命名." + defaultExt;
        }
        return name;
    }

    private String extensionOf(String filename) {
        if (filename == null || !filename.contains(".")) {
            return "png";
        }
        return filename.substring(filename.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT);
    }

    private String stripExtension(String filename) {
        if (filename == null) {
            return "未命名";
        }
        int dot = filename.lastIndexOf('.');
        return dot > 0 ? filename.substring(0, dot) : filename;
    }
}
