package com.emojiassistant.search;

import com.emojiassistant.config.NetworkSearchProperties;
import com.emojiassistant.entity.Emoji;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * 萌芽表情包浏览实现（meme.smyhub.com，无需 API Key）。
 *
 * <p>启动时从 {@code https://meme.smyhub.com/memes.json} 拉取全部梗图索引（2600+ 条，50 分类），
 * 缓存在内存中；图片按需从 {@code https://meme.smyhub.com/meme/<path>} 加载。
 *
 * <p>纯浏览来源（无关键词搜索），仅参与「梗图库」标签的随机推荐。
 * 图片版权归原作者，仅供个人斗图使用。
 */
@Service
public class MengyaMemeSearchServiceImpl extends AbstractNetworkEmojiSearchService {

    private static final String MEMES_JSON_URL = "https://meme.smyhub.com/memes.json";
    private static final String IMAGE_BASE_URL = "https://meme.smyhub.com/meme/";

    private final NetworkSearchProperties props;

    private static class MemeItem {
        String category;
        String path;
    }

    private List<MemeItem> items = List.of();

    public MengyaMemeSearchServiceImpl(NetworkSearchProperties props, ObjectMapper objectMapper,
                                       NetworkSourceHealth health) {
        super(props, objectMapper, health);
        this.props = props;
    }

    @PostConstruct
    void loadIndex() {
        try {
            String json = get(MEMES_JSON_URL);
            if (json == null) {
                log.warn("[萌芽] 拉取索引失败（来源停用）: 响应为空");
                return;
            }
            JsonNode root = objectMapper.readTree(json);
            JsonNode categories = root.path("categories");
            if (categories == null || !categories.isArray()) {
                log.warn("[萌芽] 索引格式异常（来源停用）: categories 缺失");
                return;
            }
            List<MemeItem> list = new ArrayList<>();
            for (JsonNode cat : categories) {
                String catName = cat.path("name").asText("");
                JsonNode arr = cat.path("items");
                if (arr == null || !arr.isArray()) continue;
                for (JsonNode item : arr) {
                    String path = item.path("path").asText("");
                    if (path.isEmpty()) continue;
                    MemeItem mi = new MemeItem();
                    mi.category = catName;
                    mi.path = path;
                    list.add(mi);
                }
            }
            items = List.copyOf(list);
            log.info("[萌芽] 梗图索引加载完成：{} 张（{} 分类）", items.size(), categories.size());
        } catch (Exception e) {
            log.warn("[萌芽] 梗图索引加载失败（来源停用）: {}", e.getMessage());
            items = List.of();
        }
    }

    @Override
    public String name() {
        return "MEMENGYA";
    }

    @Override
    public boolean enabled() {
        return props.isEnabled() && props.getMengya() != null && props.getMengya().isEnabled();
    }

    /** 纯浏览来源，不支持关键词搜索 */
    @Override
    public List<Emoji> search(String keyword, int limit) {
        return List.of();
    }

    /** 随机浏览：等距步长抽样，保证分类多样性 */
    @Override
    public List<Emoji> browse(int count) {
        if (items.isEmpty() || count <= 0) {
            return List.of();
        }
        int n = Math.min(count, 200);
        int total = items.size();
        java.security.SecureRandom rnd = new java.security.SecureRandom();
        int start = rnd.nextInt(total);
        int stride = Math.max(1, total / n);
        List<Emoji> result = new ArrayList<>(n);
        for (int i = 0; i < n; i++) {
            result.add(buildMemeEmoji(items.get((start + i * stride) % total)));
        }
        log.debug("[萌芽] 浏览随机返回 {} 条", result.size());
        return result;
    }

    private Emoji buildMemeEmoji(MemeItem item) {
        String url = IMAGE_BASE_URL + java.net.URLEncoder.encode(item.path, java.nio.charset.StandardCharsets.UTF_8);
        String name = item.category + " 表情";
        return buildEmoji(syntheticId("mengya:" + item.path), name, url, item.category, name());
    }
}
