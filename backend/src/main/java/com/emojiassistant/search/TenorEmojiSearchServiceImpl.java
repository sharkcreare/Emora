package com.emojiassistant.search;

import com.emojiassistant.config.NetworkSearchProperties;
import com.emojiassistant.entity.Emoji;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;

/**
 * Tenor v2 API 搜索实现。
 *
 * <p>接口：GET {baseUrl}/search?q=&key=&limit=&contentfilter=&media_filter=gif
 * 兼容新旧两种响应结构：新版 media_formats.gif.url，旧版 media[0].gif.url。
 * 密钥在 application.yml 的 network-search.tenor.api-key 配置。
 */
@Service
public class TenorEmojiSearchServiceImpl extends AbstractNetworkEmojiSearchService {

    public TenorEmojiSearchServiceImpl(NetworkSearchProperties props, ObjectMapper objectMapper,
                                      NetworkSourceHealth health) {
        super(props, objectMapper, health);
    }

    @Override
    public String name() {
        return "TENOR";
    }

    @Override
    public boolean enabled() {
        return props.isEnabled() && props.getTenor() != null && !props.getTenor().getApiKey().isBlank();
    }

    @Override
    public List<Emoji> search(String keyword, int limit) {
        NetworkSearchProperties.Tenor cfg = props.getTenor();
        String url = cfg.getBaseUrl() + "/search?q=" + enc(keyword) + "&key=" + enc(cfg.getApiKey())
                + "&limit=" + limit + "&contentfilter=" + cfg.getContentFilter() + "&media_filter=gif";
        String body = get(url);
        if (body == null) {
            return List.of();
        }
        try {
            JsonNode root = objectMapper.readTree(body);
            List<Emoji> list = new ArrayList<>();
            for (JsonNode item : root.path("results")) {
                String sourceId = item.path("id").asText("");
                if (sourceId.isEmpty()) {
                    continue;
                }
                String title = item.path("title").asText("");
                String gifUrl = extractGifUrl(item);
                if (gifUrl.isEmpty()) {
                    continue;
                }
                list.add(buildEmoji(syntheticId(sourceId), title.isEmpty() ? keyword : title, gifUrl, keyword, name()));
            }
            log.debug("[TENOR] 搜索 '{}' 返回 {} 条", keyword, list.size());
            return list;
        } catch (Exception e) {
            log.warn("[TENOR] 响应解析失败（降级为本地结果）: {}", e.getMessage());
            return List.of();
        }
    }

    /** 新版 API 用 media_formats，旧版用 media[] */
    private String extractGifUrl(JsonNode item) {
        JsonNode mediaFormats = item.path("media_formats");
        if (mediaFormats.isObject() && !mediaFormats.isMissingNode()) {
            String url = mediaFormats.path("gif").path("url").asText("");
            if (!url.isEmpty()) {
                return url;
            }
        }
        JsonNode media = item.path("media");
        if (media.isArray() && media.size() > 0) {
            return media.get(0).path("gif").path("url").asText("");
        }
        return "";
    }
}
