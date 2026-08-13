package com.emojiassistant.search;

import com.emojiassistant.config.NetworkSearchProperties;
import com.emojiassistant.entity.Emoji;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * 中文动态图库搜索实现（ChineseBQB 开源仓，无需任何 API Key）。
 *
 * <p>安装包内置完整图片索引 {@code data/chinesebqb-index.json}（由 tools/fetch-bqb-index.mjs 生成），
 * 启动时加载到内存做关键词匹配，图片本体按需从 jsdelivr CDN 拉取：
 * {@code https://cdn.jsdelivr.net/gh/zhaoolee/ChineseBQB@master/<path>}
 *
 * <p>与 Giphy/Tenor 不同：本来源无需外部 Key，开箱即用；内容为中文梗图，文件名即导入（米姆库）。
 * 图片版权归原作者，仅供个人斗图使用。
 */
@Service
public class ChineseBqbSearchServiceImpl extends AbstractNetworkEmojiSearchService {

    private static final String INDEX = "data/chinesebqb-index.json";
    private static final String CDN_BASE = "https://cdn.jsdelivr.net/gh/zhaoolee/ChineseBQB@master/";

    private final NetworkSearchProperties props;

    /** 索引条目：p=相对路径, s=系列中文, u=子系列中文, n=文件名中文 */
    private static class Entry {
        String p = "";
        String s = "";
        String u = "";
        String n = "";
        /** 拼接后的检索文本（小写，用于子串匹配） */
        String hay = "";
    }

    private List<Entry> entries = List.of();

    public ChineseBqbSearchServiceImpl(NetworkSearchProperties props, ObjectMapper objectMapper,
                                       NetworkSourceHealth health) {
        super(props, objectMapper, health);
        this.props = props;
    }

    @PostConstruct
    void loadIndex() {
        try {
            ClassPathResource res = new ClassPathResource(INDEX);
            if (!res.exists()) {
                return;
            }
            JsonNode arr = objectMapper.readTree(res.getInputStream());
            if (arr == null || !arr.isArray()) {
                return;
            }
            List<Entry> list = new ArrayList<>(arr.size());
            for (JsonNode node : arr) {
                Entry e = new Entry();
                e.p = node.path("p").asText("");
                e.s = node.path("s").asText("");
                e.u = node.path("u").asText("");
                e.n = node.path("n").asText("");
                if (e.p.isEmpty()) {
                    continue;
                }
                e.hay = (e.n + " " + e.s + " " + e.u).toLowerCase(Locale.ROOT);
                list.add(e);
            }
            entries = List.copyOf(list);
            log.info("[BQB] 中文图库索引加载完成：{} 张（classpath:{}）", entries.size(), INDEX);
        } catch (Exception e) {
            log.warn("[BQB] 中文图库索引加载失败（该来源停用）: {}", e.getMessage());
            entries = List.of();
        }
    }

    @Override
    public String name() {
        return "BQB";
    }

    @Override
    public boolean enabled() {
        return props.isEnabled() && props.getChinesebqb() != null && props.getChinesebqb().isEnabled();
    }

    @Override
    public List<Emoji> search(String keyword, int limit) {
        if (entries.isEmpty()) {
            return List.of();
        }
        String kw = keyword == null ? "" : keyword.trim();
        if (kw.isEmpty()) {
            return List.of();
        }
        String[] terms = kw.toLowerCase(Locale.ROOT).split("\\s+");
        if (terms.length == 0) {
            return List.of();
        }

        List<Object[]> hits = new ArrayList<>();   // [entry, score]
        for (Entry e : entries) {
            boolean allMatch = true;
            int score = 0;
            for (String term : terms) {
                if (term.isEmpty()) {
                    continue;
                }
                if (!e.hay.contains(term)) {
                    allMatch = false;
                    break;
                }
                score += termScore(e, term);
            }
            if (!allMatch) {
                continue;
            }
            // GIF 动图略靠前（更符合"梗图"预期），短文件名（核心梗）优先
            if (e.p.toLowerCase(Locale.ROOT).endsWith(".gif")) {
                score += 8;
            }
            score -= e.n.length();
            hits.add(new Object[]{e, score});
        }
        hits.sort((a, b) -> (Integer) b[1] - (Integer) a[1]);
        List<Emoji> result = new ArrayList<>(Math.min(hits.size(), limit));
        for (int i = 0; i < hits.size() && i < limit; i++) {
            result.add(buildBqbEmoji((Entry) hits.get(i)[0]));
        }
        log.debug("[BQB] 搜索 '{}' 命中 {} 条", keyword, hits.size());
        return result;
    }

    /** 无关键词浏览：「梗图库」标签随机抽图。等距步长扫全库，保证系列/内容足够多样 */
    @Override
    public List<Emoji> browse(int count) {
        if (entries.isEmpty() || count <= 0) {
            return List.of();
        }
        int n = Math.min(count, 200);
        int total = entries.size();
        java.security.SecureRandom rnd = new java.security.SecureRandom();
        int start = rnd.nextInt(total);
        int stride = Math.max(1, total / n);
        List<Emoji> result = new ArrayList<>(n);
        for (int i = 0; i < n; i++) {
            result.add(buildBqbEmoji(entries.get((start + i * stride) % total)));
        }
        log.debug("[BQB] 浏览随机返回 {} 条", result.size());
        return result;
    }

    /** 命中位置越"实"得分越高：文件名字面命中 > 子系列 > 系列 */
    private static int termScore(Entry e, String term) {
        if (e.n.toLowerCase(Locale.ROOT).contains(term)) {
            return e.n.toLowerCase(Locale.ROOT).startsWith(term) ? 120 : 100;
        }
        if (e.s.toLowerCase(Locale.ROOT).contains(term)) {
            return 55;
        }
        return 40;
    }

    private Emoji buildBqbEmoji(Entry e) {
        // 逐个路径段 URL 编码（保留斜杠），兼容中文/emoji/空格路径，再走 jsdelivr CDN
        String[] segs = e.p.split("/");
        StringBuilder url = new StringBuilder(CDN_BASE);
        for (int i = 0; i < segs.length; i++) {
            if (i > 0) {
                url.append('/');
            }
            url.append(java.net.URLEncoder.encode(segs[i], StandardCharsets.UTF_8));
        }
        String name = e.n.isEmpty() ? "BQB表情" : e.n;
        String tags = (e.s.isEmpty() ? "" : e.s) + (e.u.isEmpty() ? "" : "," + e.u);
        return buildEmoji(syntheticId(e.p), name, url.toString(), tags, name());
    }
}
