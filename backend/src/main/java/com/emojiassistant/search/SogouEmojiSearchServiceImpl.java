package com.emojiassistant.search;

import com.emojiassistant.config.NetworkSearchProperties;
import com.emojiassistant.entity.Emoji;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;

/**
 * 免费搜狗表情包搜索实现（接口盒子聚合：https://cn.apihz.cn/api/img/apihzbqbsougou.php）。
 *
 * <p>无需 API Key（用公开演示凭据 id/key = 88888888），按关键词返回搜狗图床直链数组。
 * 响应：{ "code": 200, "res": [ "https://i03piccdn.sogoucdn.com/xxx", ... ] }
 * 返回链接多无文件扩展名；前端下载时用魔数嗅探扩展名（见 clipboard.ts）。
 *
 * <p>可靠性与 BQB（内置索引）不同：依赖第三方接口盒子的共享频次，仅供个人斗图，网络异常自动降级。
 */
@Service
public class SogouEmojiSearchServiceImpl extends AbstractNetworkEmojiSearchService {

    public SogouEmojiSearchServiceImpl(NetworkSearchProperties props, ObjectMapper objectMapper,
                                      NetworkSourceHealth health) {
        super(props, objectMapper, health);
    }

    @Override
    public String name() {
        return "SOGOU";
    }

    @Override
    public boolean enabled() {
        return props.isEnabled() && props.getSogou() != null && props.getSogou().isEnabled();
    }

    @Override
    public List<Emoji> search(String keyword, int limit) {
        NetworkSearchProperties.Sogou cfg = props.getSogou();
        String url = cfg.getBaseUrl()
                + "?id=" + enc(cfg.getId()) + "&key=" + enc(cfg.getKey())
                + "&page=1&words=" + enc(keyword);
        String body = get(url);
        if (body == null) {
            return List.of();
        }
        try {
            JsonNode root = objectMapper.readTree(body);
            if (root.path("code").asInt() != 200) {
                log.debug("[SOGOU] 接口返回错误: {}", root.path("msg").asText(""));
                return List.of();
            }
            List<Emoji> list = new ArrayList<>(limit);
            for (JsonNode item : root.path("res")) {
                String imgUrl = item.asText("").trim();
                if (imgUrl.isEmpty()) {
                    continue;
                }
                list.add(buildEmoji(syntheticId(imgUrl), keyword, imgUrl, keyword, name()));
                if (list.size() >= limit) {
                    break;
                }
            }
            log.debug("[SOGOU] 搜索 '{}' 返回 {} 条", keyword, list.size());
            return list;
        } catch (Exception e) {
            log.warn("[SOGOU] 响应解析失败（降级为本地结果）: {}", e.getMessage());
            return List.of();
        }
    }
}
