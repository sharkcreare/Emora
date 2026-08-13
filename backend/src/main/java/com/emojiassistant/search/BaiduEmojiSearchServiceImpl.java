package com.emojiassistant.search;

import com.emojiassistant.config.NetworkSearchProperties;
import com.emojiassistant.entity.Emoji;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;

/**
 * 百度图库实时通道（接口盒子 apihzbqbbaidu，IP 直连集群，免 Key）。
 *
 * <p>按关键词从百度图库实时检索中文表情包，图片为百度图床直链（imgN.baidu.com），
 * 内容随搜索实时更新，比内置静态 BQB 库新得多。接口盒子域名（cn.apihz.cn）时常不可达，
 * 故按 {@code base-urls} 配置的普通集群 IP 线路顺序重试，首个可用即返回。
 *
 * <p>免 Key（公开演示凭据 id/key = 88888888）、免费无上限；响应：
 * {@code {"code":200,"res":["https://img1.baidu.com/..."]}}，未命中/接口异常自动降级为空列表。
 */
@Service
public class BaiduEmojiSearchServiceImpl extends AbstractNetworkEmojiSearchService {

    private static final String PATH = "/api/img/apihzbqbbaidu.php";

    public BaiduEmojiSearchServiceImpl(NetworkSearchProperties props, ObjectMapper objectMapper,
                                       NetworkSourceHealth health) {
        super(props, objectMapper, health);
    }

    /** 已有 base-urls 线路级重试，外层不再重复重试（避免请求翻倍） */
    @Override
    protected int retryCount() {
        return 0;
    }

    @Override
    public String name() {
        return "BAIDU";
    }

    /** 单线路短超时：快速切换到下一 IP，避免某条线路卡死拖慢整个搜索 */
    @Override
    protected long requestTimeoutMillis() {
        return Math.min(props.getTimeoutMs(), 2500);
    }

    @Override
    public boolean enabled() {
        return props.isEnabled() && props.getBaidu() != null && props.getBaidu().isEnabled();
    }

    @Override
    public List<Emoji> search(String keyword, int limit) {
        String kw = keyword == null ? "" : keyword.trim();
        if (kw.isEmpty()) {
            return List.of();
        }
        NetworkSearchProperties.Baidu cfg = props.getBaidu();
        int pageSize = Math.min(Math.max(limit, 1), 100);
        for (String base : cfg.getBaseUrls()) {
            String url = base + PATH
                    + "?id=" + enc(cfg.getId()) + "&key=" + enc(cfg.getKey())
                    + "&limit=" + pageSize + "&page=1&words=" + enc(kw);
            String body = get(url);
            if (body == null) {
                continue;
            }
            List<Emoji> list = parse(body, kw);
            if (list != null) {
                log.debug("[BAIDU] 搜索 '{}' 返回 {} 条（{}）", keyword, list.size(), base);
                return list;
            }
        }
        return List.of();
    }

    /** 解析响应；code!=200 或解析失败返回 null（由调用方换下一线路重试） */
    private List<Emoji> parse(String body, String keyword) {
        try {
            JsonNode root = objectMapper.readTree(body);
            if (root.path("code").asInt() != 200) {
                log.debug("[BAIDU] 接口返回错误: {}", root.path("msg").asText(""));
                return null;
            }
            List<Emoji> list = new ArrayList<>();
            for (JsonNode item : root.path("res")) {
                String imgUrl = item.asText("").trim();
                if (imgUrl.isEmpty()) {
                    continue;
                }
                list.add(buildEmoji(syntheticId(imgUrl), keyword, imgUrl, keyword, name()));
            }
            return list;
        } catch (Exception e) {
            log.warn("[BAIDU] 响应解析失败: {}", e.getMessage());
            return null;
        }
    }
}
