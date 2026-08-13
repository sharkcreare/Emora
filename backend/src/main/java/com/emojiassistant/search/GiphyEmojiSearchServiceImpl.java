package com.emojiassistant.search;

import com.emojiassistant.config.NetworkSearchProperties;
import com.emojiassistant.entity.Emoji;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;

/**
 * Giphy Sticker API 搜索实现。
 *
 * <p>接口：GET {baseUrl}/search?api_key=&q=&limit=&rating=
 * 返回 data[].images.fixed_width.url（gif）。密钥在 application.yml 的 network-search.giphy.api-key 配置。
 */
@Service
public class GiphyEmojiSearchServiceImpl extends AbstractNetworkEmojiSearchService {

    public GiphyEmojiSearchServiceImpl(NetworkSearchProperties props, ObjectMapper objectMapper,
                                      NetworkSourceHealth health) {
        super(props, objectMapper, health);
    }

    @Override
    public String name() {
        return "GIPHY";
    }

    @Override
    public boolean enabled() {
        return props.isEnabled() && props.getGiphy() != null && !props.getGiphy().getApiKey().isBlank();
    }

    @Override
    public List<Emoji> search(String keyword, int limit) {
        NetworkSearchProperties.Giphy cfg = props.getGiphy();
        String url = cfg.getBaseUrl() + "/search?api_key=" + enc(cfg.getApiKey())
                + "&q=" + enc(keyword) + "&limit=" + limit + "&rating=" + cfg.getRating();
        String body = get(url);
        if (body == null) {
            return List.of();
        }
        try {
            JsonNode root = objectMapper.readTree(body);
            List<Emoji> list = new ArrayList<>();
            for (JsonNode item : root.path("data")) {
                String sourceId = item.path("id").asText("");
                if (sourceId.isEmpty()) {
                    continue;
                }
                String title = item.path("title").asText("");
                String gifUrl = item.path("images").path("fixed_width").path("url").asText("");
                if (gifUrl.isEmpty()) {
                    gifUrl = item.path("images").path("original").path("url").asText("");
                }
                if (gifUrl.isEmpty()) {
                    continue;
                }
                list.add(buildEmoji(syntheticId(sourceId), title.isEmpty() ? keyword : title, gifUrl, keyword, name()));
            }
            log.debug("[GIPHY] 搜索 '{}' 返回 {} 条", keyword, list.size());
            return list;
        } catch (Exception e) {
            log.warn("[GIPHY] 响应解析失败（降级为本地结果）: {}", e.getMessage());
            return List.of();
        }
    }
}
