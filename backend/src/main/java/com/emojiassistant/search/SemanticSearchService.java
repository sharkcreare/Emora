package com.emojiassistant.search;

import ai.djl.huggingface.tokenizers.Encoding;
import ai.djl.huggingface.tokenizers.HuggingFaceTokenizer;
import ai.onnxruntime.OnnxTensor;
import ai.onnxruntime.OnnxValue;
import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtSession;
import com.emojiassistant.entity.Emoji;
import com.emojiassistant.mapper.EmojiMapper;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * AI 语义搜索（本地 ONNX 向量模型，零 API、离线可用）。
 *
 * <p>用 bge-small-zh-v1.5（int8 量化，MIT 协议，随 jar 内置）把每个表情的
 * 「名称 + 标签 + 语义描述」编码成 512 维向量；查询时按 BGE 官方要求加中文检索指令前缀
 * 「为这个句子生成表示以用于检索相关文章：」再编码，按余弦相似度返回最相关的表情。
 *
 * <p>模型文件缺失或加载失败时自动回退到内置 TF-IDF 语义层，保证现有功能不受影响。
 * 对外接口（search / rebuild / DEFAULT_LIMIT）保持不变，调用方无需改动。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class SemanticSearchService {

    /** 语义结果上限（合并进搜索页的数量） */
    public static final int DEFAULT_LIMIT = 24;

    /** 展示分数校准区间：原始余弦相似度（约 0.30~0.65）对用户不直观，
     *  在结果集内 min-max 归一化到 [0.55, 0.92]，排序不变、角标更有说服力 */
    private static final float SCORE_MIN = 0.55f;
    private static final float SCORE_MAX = 0.92f;

    /** bge 中文检索官方建议：查询句加指令前缀（文档不加），显著提升检索质量 */
    private static final String QUERY_INSTRUCTION = "为这个句子生成表示以用于检索相关文章：";
    private static final int MAX_SEQ = 512;

    /** 内置模型资源路径（classpath，随 jar 打包 → 真正本地离线） */
    private static final String MODEL_RESOURCE = "/models/bge-small-zh-v1.5/model_int8.onnx";
    private static final String TOKENIZER_RESOURCE = "/models/bge-small-zh-v1.5/tokenizer.json";

    private final EmojiMapper emojiMapper;

    /* ---------- ONNX 引擎（best effort） ---------- */
    private volatile OrtEnvironment ortEnv;
    private volatile OrtSession ortSession;
    private volatile HuggingFaceTokenizer tokenizer;
    /** 模型要求的输入名（input_ids / attention_mask / token_type_ids …） */
    private volatile Map<String, ai.onnxruntime.NodeInfo> inputInfo = Map.of();
    /** 输出名 → 是否需要 CLS 池化（last_hidden_state 需要，sentence_embedding 不需要） */
    private volatile Map<String, Boolean> outputInfo = Map.of();
    private volatile boolean onnxReady = false;

    /* ---------- 向量索引 ---------- */
    private volatile List<IndexedEmoji> index = List.of();

    /* ---------- TF-IDF 回退索引 ---------- */
    private static final Pattern TOKEN = Pattern.compile("[\\p{L}\\p{N}]+");
    private volatile List<TfidfDoc> tfidfIndex = List.of();
    private volatile Map<String, Float> tfidfIdf = Map.of();

    @PostConstruct
    public void init() {
        // TF-IDF 索引毫秒级构建完成，保证后端一启动即可搜索（无需等待模型加载）
        rebuildTfidf();
        log.info("[semantic] TF-IDF 索引就绪（{} 个表情），ONNX 向量索引转入后台构建", tfidfIndex.size());
        // ONNX 模型加载（约 24MB）+ 全量向量化放入后台线程，不阻塞后端启动/健康检查；
        // 期间语义查询自动回退 TF-IDF（见 searchWithScore），构建完成后无缝切换到向量检索
        Thread builder = new Thread(this::initOnnxAndBuildIndex, "semantic-onnx-init");
        builder.setDaemon(true);
        builder.start();
    }

    /** 后台构建 ONNX 向量索引（不阻塞主流程） */
    private void initOnnxAndBuildIndex() {
        initOnnx();
        if (!onnxReady) {
            log.warn("[semantic] ONNX 模型不可用，保持 TF-IDF 语义搜索（共 {} 个表情）", tfidfIndex.size());
            return;
        }
        try {
            List<Emoji> all = emojiMapper.selectList(null);
            List<IndexedEmoji> docs = new ArrayList<>();
            for (Emoji e : all) {
                if (e.getId() == null) continue;
                float[] vec = embed(textOf(e), false);
                if (vec != null) {
                    docs.add(new IndexedEmoji(e, vec));
                }
            }
            index = docs;
            log.info("[semantic] ONNX 向量索引构建完成，共 {} 个表情（bge-small-zh-v1.5 int8）", index.size());
        } catch (Throwable e) {
            log.warn("[semantic] 后台构建向量索引失败，保持 TF-IDF: {}", e.getMessage());
        }
    }

    /** 重建索引（启动、新增/删除表情后调用；语料小，全量重建成本可忽略） */
    public synchronized void rebuild() {
        List<Emoji> all = emojiMapper.selectList(null);
        if (onnxReady) {
            List<IndexedEmoji> docs = new ArrayList<>();
            for (Emoji e : all) {
                if (e.getId() == null) continue;
                float[] vec = embed(textOf(e), false);
                if (vec != null) {
                    docs.add(new IndexedEmoji(e, vec));
                }
            }
            index = docs;
        } else {
            rebuildTfidf();
        }
    }

    /** 一个语义命中：表情 + 相似度分数（0~1，供前端展示"AI 推荐"角标） */
    public record SemanticHit(Emoji emoji, float score) {}

    /** 语义搜索（带分数）：返回与 query 最相关的前 limit 个表情（相似度降序） */
    public List<SemanticHit> searchWithScore(String query, int limit) {
        if (query == null || query.isBlank()) return List.of();
        int max = Math.min(Math.max(limit, 1), 100);
        if (onnxReady) {
            List<SemanticHit> res = searchOnnxScored(query, max);
            // 向量索引仍在后台构建（模型就绪但索引为空）时回退 TF-IDF，避免搜索结果为空
            if (!res.isEmpty() || !index.isEmpty()) return res;
        }
        return searchTfidfScored(query, max);
    }

    /** 语义搜索（仅表情，兼容旧调用方） */
    public List<Emoji> search(String query, int limit) {
        return searchWithScore(query, limit).stream().map(SemanticHit::emoji).toList();
    }

    /* ================= ONNX 向量搜索 ================= */

    private void initOnnx() {
        try {
            byte[] modelBytes = readResource(MODEL_RESOURCE);
            byte[] tokBytes = readResource(TOKENIZER_RESOURCE);
            if (modelBytes == null || tokBytes == null) {
                log.warn("[semantic] 模型资源缺失: {} / {}", MODEL_RESOURCE, TOKENIZER_RESOURCE);
                return;
            }
            // DJL tokenizers 需要文件路径，写入临时文件
            Path tokPath = Files.createTempFile("bge-tokenizer", ".json");
            tokPath.toFile().deleteOnExit();
            Files.write(tokPath, tokBytes);

            tokenizer = HuggingFaceTokenizer.newInstance(tokPath);
            ortEnv = OrtEnvironment.getEnvironment();
            ortSession = ortEnv.createSession(modelBytes, new OrtSession.SessionOptions());

            Map<String, Boolean> outs = new HashMap<>();
            for (Map.Entry<String, ai.onnxruntime.NodeInfo> e : ortSession.getOutputInfo().entrySet()) {
                // sentence_embedding 已是池化向量；last_hidden_state 需要取 CLS
                boolean needsCls = !e.getKey().toLowerCase(Locale.ROOT).contains("sentence_embedding");
                outs.put(e.getKey(), needsCls);
                log.info("[semantic] ONNX 输出: {} (needsCls={})", e.getKey(), needsCls);
            }
            outputInfo = outs;
            inputInfo = ortSession.getInputInfo();
            log.info("[semantic] ONNX 输入: {}", inputInfo.keySet());
            onnxReady = true;
        } catch (Throwable e) {
            log.warn("[semantic] ONNX 初始化失败，将回退 TF-IDF: {}", e.getMessage());
            onnxReady = false;
        }
    }

    private List<SemanticHit> searchOnnxScored(String query, int max) {
        float[] qv = embed(QUERY_INSTRUCTION + query, true);
        if (qv == null) return List.of();
        List<IndexedEmoji> snapshot = index;
        List<SemanticHit> hits = new ArrayList<>(snapshot.size());
        for (IndexedEmoji d : snapshot) {
            float sim = cosine(qv, d.vector);
            if (sim > 0) {
                hits.add(new SemanticHit(d.emoji, sim));
            }
        }
        hits.sort(Comparator.comparingDouble(SemanticHit::score).reversed());
        if (hits.size() > max) hits = new ArrayList<>(hits.subList(0, max));
        return calibrateScores(hits);
    }

    /** 展示分数校准：把原始相似度归一化到 [SCORE_MIN, SCORE_MAX]，排序不受影响 */
    private static List<SemanticHit> calibrateScores(List<SemanticHit> hits) {
        if (hits.size() < 2) return hits;
        float lo = Float.MAX_VALUE, hi = Float.MIN_VALUE;
        for (SemanticHit h : hits) {
            lo = Math.min(lo, h.score());
            hi = Math.max(hi, h.score());
        }
        float range = hi - lo;
        final float base = lo;
        if (range <= 1e-6f) {
            float mid = (SCORE_MIN + SCORE_MAX) / 2f;
            return hits.stream().map(h -> new SemanticHit(h.emoji(), mid)).toList();
        }
        return hits.stream()
                .map(h -> new SemanticHit(h.emoji(), SCORE_MIN + (h.score() - base) / range * (SCORE_MAX - SCORE_MIN)))
                .toList();
    }

    /** 文本 → 512 维归一化向量（失败返回 null） */
    private float[] embed(String text, boolean isQuery) {
        try {
            Encoding enc = tokenizer.encode(text);
            long[] ids = enc.getIds();
            if (ids.length == 0) return null;
            // tokenizer.json 未配 truncation，手动截断（保留 [CLS]，尾部截掉）
            if (ids.length > MAX_SEQ) {
                ids = Arrays.copyOf(ids, MAX_SEQ);
            }
            long[] mask = new long[ids.length];
            Arrays.fill(mask, 1L);

            Map<String, OnnxTensor> inputs = new HashMap<>();
            inputs.put("input_ids", OnnxTensor.createTensor(ortEnv, new long[][]{ids}));
            inputs.put("attention_mask", OnnxTensor.createTensor(ortEnv, new long[][]{mask}));
            if (inputInfo.containsKey("token_type_ids")) {
                inputs.put("token_type_ids", OnnxTensor.createTensor(ortEnv, new long[1][ids.length]));
            }

            try (OrtSession.Result results = ortSession.run(inputs)) {
                // 选择输出：优先 sentence_embedding，否则第一个输出并按需 CLS 池化
                String chosen = outputInfo.keySet().stream()
                        .filter(n -> n.toLowerCase(Locale.ROOT).contains("sentence_embedding"))
                        .findFirst()
                        .orElse(outputInfo.keySet().iterator().next());
                try (OnnxTensor tensor = (OnnxTensor) results.get(chosen).orElseThrow()) {
                    Object value = tensor.getValue();
                    float[] vec;
                    if (value instanceof float[][]) {
                        float[][] m = (float[][]) value;
                        if (m.length == 0 || m[0].length == 0) return null;
                        vec = outputInfo.get(chosen)
                                ? m[0]
                                : m[0]; // sentence_embedding: [1, dim]
                    } else if (value instanceof float[][][]) {
                        // last_hidden_state: [1, seq, dim] → CLS 池化取第一行
                        float[][][] m = (float[][][]) value;
                        if (m.length == 0 || m[0].length == 0) return null;
                        vec = m[0][0];
                    } else {
                        return null;
                    }
                    return normalize(vec);
                }
            }
        } catch (Exception e) {
            log.debug("[semantic] 向量计算失败: {}", e.getMessage());
            return null;
        }
    }

    private static float[] normalize(float[] v) {
        float norm = 0f;
        for (float x : v) norm += x * x;
        norm = (float) Math.sqrt(norm);
        if (norm <= 0) return null;
        float[] out = new float[v.length];
        for (int i = 0; i < v.length; i++) out[i] = v[i] / norm;
        return out;
    }

    private static float cosine(float[] a, float[] b) {
        if (a == null || b == null || a.length != b.length) return 0f;
        float dot = 0f;
        for (int i = 0; i < a.length; i++) dot += a[i] * b[i];
        return dot; // 已归一化，余弦 = 点积
    }

    /* ================= TF-IDF 回退（原实现保留） ================= */

    private void rebuildTfidf() {
        List<Emoji> all = emojiMapper.selectList(null);
        List<TfidfDoc> docs = new ArrayList<>();
        for (Emoji e : all) {
            if (e.getId() == null) continue;
            Map<String, Integer> feats = tfidfFeatures(textOf(e));
            if (feats.isEmpty()) continue;
            docs.add(new TfidfDoc(e, feats));
        }
        Map<String, Integer> df = new HashMap<>();
        for (TfidfDoc d : docs) {
            for (String f : d.features.keySet()) df.merge(f, 1, Integer::sum);
        }
        int n = docs.size();
        Map<String, Float> idfMap = new HashMap<>();
        for (Map.Entry<String, Integer> e : df.entrySet()) {
            idfMap.put(e.getKey(), (float) (Math.log(1.0 + n / (1.0 + e.getValue())) + 1.0));
        }
        for (TfidfDoc d : docs) {
            float norm = 0f;
            for (Map.Entry<String, Integer> f : d.features.entrySet()) {
                float w = f.getValue() * idfMap.getOrDefault(f.getKey(), 4.0f);
                d.weights.put(f.getKey(), w);
                norm += w * w;
            }
            d.norm = (float) Math.sqrt(norm);
        }
        this.tfidfIndex = docs;
        this.tfidfIdf = idfMap;
    }

    private List<SemanticHit> searchTfidfScored(String query, int max) {
        Map<String, Integer> qFeats = tfidfFeatures(query);
        if (qFeats.isEmpty()) return List.of();
        Map<String, Float> qVec = new HashMap<>();
        for (Map.Entry<String, Integer> f : qFeats.entrySet()) {
            Float idfW = tfidfIdf.get(f.getKey());
            if (idfW != null) qVec.put(f.getKey(), f.getValue() * idfW);
        }
        if (qVec.isEmpty()) return List.of();
        float qNorm = 0f;
        for (float w : qVec.values()) qNorm += w * w;
        if (qNorm <= 0) return List.of();
        qNorm = (float) Math.sqrt(qNorm);

        List<TfidfDoc> snapshot = tfidfIndex;
        List<SemanticHit> hits = new ArrayList<>();
        for (TfidfDoc d : snapshot) {
            if (d.norm <= 0) continue;
            float dot = 0f;
            for (Map.Entry<String, Float> q : qVec.entrySet()) {
                Float dw = d.weights.get(q.getKey());
                if (dw != null) dot += q.getValue() * dw;
            }
            float score = dot / (qNorm * d.norm);
            if (score > 0) hits.add(new SemanticHit(d.emoji, score));
        }
        hits.sort(Comparator.comparingDouble(SemanticHit::score).reversed());
        if (hits.size() > max) hits = new ArrayList<>(hits.subList(0, max));
        return calibrateScores(hits);
    }

    /* ---------- TF-IDF 特征提取（含语义概念扩展词典） ---------- */

    private static Map<String, Integer> tfidfFeatures(String text) {
        Map<String, Integer> counts = new HashMap<>();
        for (String tok : extractTokens(text)) {
            add(counts, tok, 2);
            addBigrams(counts, tok, 1);
            addUnigrams(counts, tok, 1);
        }
        for (Map.Entry<String, List<String>> e : CONCEPTS.entrySet()) {
            if (text.contains(e.getKey())) {
                for (String rel : e.getValue()) {
                    add(counts, rel, 2);
                    addBigrams(counts, rel, 1);
                }
            }
        }
        return counts;
    }

    private static List<String> extractTokens(String text) {
        List<String> out = new ArrayList<>();
        Matcher m = TOKEN.matcher(text);
        while (m.find()) {
            out.add(m.group().toLowerCase(Locale.ROOT));
        }
        return out;
    }

    private static void addBigrams(Map<String, Integer> counts, String s, int weight) {
        if (s.length() < 2) return;
        for (int i = 0; i + 1 < s.length(); i++) {
            add(counts, s.substring(i, i + 2), weight);
        }
    }

    private static void addUnigrams(Map<String, Integer> counts, String s, int weight) {
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (Character.isLetter(c)) {
                add(counts, String.valueOf(c), weight);
            }
        }
    }

    private static void add(Map<String, Integer> counts, String feature, int weight) {
        counts.merge(feature, weight, Integer::sum);
    }

    /** 名称里的纯数字 ID 噪音（如 000000022），编码时剥离；保留有语义的数字（如 360度） */
    private static final Pattern NUM_NOISE = Pattern.compile("\\d+(?![\\u4e00-\\u9fff])");

    /** 一个表情的文本语料：清洗后的名称 + 标签 + 语义描述 */
    private static String textOf(Emoji e) {
        StringBuilder sb = new StringBuilder();
        if (e.getName() != null) {
            String cleaned = NUM_NOISE.matcher(e.getName()).replaceAll("");
            sb.append(cleaned).append(' ');
        }
        if (e.getTags() != null) {
            String cleanedTags = NUM_NOISE.matcher(e.getTags().replace(',', ' ')).replaceAll("");
            sb.append(cleanedTags).append(' ');
        }
        if (e.getDescription() != null) sb.append(e.getDescription()).append(' ');
        return sb.toString();
    }

    private static byte[] readResource(String name) {
        try (InputStream in = SemanticSearchService.class.getResourceAsStream(name)) {
            if (in == null) return null;
            return in.readAllBytes();
        } catch (Exception e) {
            log.warn("[semantic] 读取资源失败 {}: {}", name, e.getMessage());
            return null;
        }
    }

    /** ONNX 索引中的单个文档 */
    private static final class IndexedEmoji {
        final Emoji emoji;
        final float[] vector;

        IndexedEmoji(Emoji emoji, float[] vector) {
            this.emoji = emoji;
            this.vector = vector;
        }
    }

    /** TF-IDF 索引中的单个文档 */
    private static final class TfidfDoc {
        final Emoji emoji;
        final Map<String, Integer> features;
        final Map<String, Float> weights = new HashMap<>();
        float norm = 0f;

        TfidfDoc(Emoji emoji, Map<String, Integer> features) {
            this.emoji = emoji;
            this.features = features;
        }
    }

    /** 语义扩展词典（TF-IDF 回退路径用，覆盖常见表情场景） */
    private static final Map<String, List<String>> CONCEPTS = buildConcepts();

    private static Map<String, List<String>> buildConcepts() {
        Map<String, List<String>> m = new LinkedHashMap<>();
        m.put("加班", List.of("打工", "工作", "上班", "累", "崩溃", "摸鱼", "辛苦"));
        m.put("上班", List.of("打工", "加班", "工作", "摸鱼", "累", "早起"));
        m.put("工作", List.of("打工", "加班", "上班", "摸鱼", "辛苦"));
        m.put("打工", List.of("上班", "加班", "工作", "摸鱼", "累"));
        m.put("累", List.of("加班", "打工", "疲惫", "困", "崩溃"));
        m.put("崩溃", List.of("无语", "裂开", "心态", "崩了", "累", "加班"));
        m.put("无语", List.of("无奈", "崩溃", "裂开", "翻白眼", "服了", "晕", "不想说话"));
        m.put("无奈", List.of("无语", "崩溃", "裂开", "服了"));
        m.put("生气", List.of("愤怒", "发火", "恼火", "无语", "崩溃", "裂开", "翻白眼"));
        m.put("愤怒", List.of("生气", "发火", "恼火"));
        m.put("嘲讽", List.of("阴阳", "鄙视", "狗头", "挑衅", "看不起", "呵呵", "欠揍"));
        m.put("阴阳", List.of("嘲讽", "狗头", "阴阳怪气"));
        m.put("鄙视", List.of("嘲讽", "看不起", "白眼", "呵呵"));
        m.put("开心", List.of("大笑", "哈哈", "高兴", "快乐", "笑", "666"));
        m.put("高兴", List.of("开心", "大笑", "哈哈", "快乐"));
        m.put("笑", List.of("开心", "大笑", "哈哈", "快乐", "笑死"));
        m.put("猫", List.of("猫咪", "猫猫", "卖萌", "震惊猫", "熊猫头"));
        m.put("狗", List.of("狗狗", "狗头", "汪汪"));
        m.put("熊猫", List.of("熊猫头", "卖萌", "可爱"));
        m.put("摸鱼", List.of("划水", "偷懒", "上班", "打工", "累"));
        m.put("干饭", List.of("吃饭", "饿", "干饭人", "美食"));
        m.put("吃饭", List.of("干饭", "饿", "美食"));
        m.put("点赞", List.of("赞", "666", "牛逼", "厉害", "棒", "大拇指"));
        m.put("震惊", List.of("惊讶", "吃惊", "吓到", "问号", "卧槽"));
        m.put("惊讶", List.of("震惊", "吃惊", "吓到", "问号"));
        m.put("哭", List.of("哭泣", "委屈", "难过", "泪目", "伤心", "想哭"));
        m.put("难过", List.of("哭", "委屈", "伤心", "崩溃"));
        m.put("尴尬", List.of("无语", "汗", "社死", "翻白眼"));
        m.put("晚安", List.of("睡觉", "困", "晚上好", "休息"));
        m.put("困", List.of("睡觉", "晚安", "累", "疲惫"));
        m.put("亲", List.of("亲亲", "亲亲抱抱", "我要亲你", "木马", "mua"));
        m.put("喜欢", List.of("爱你", "亲亲", "女神", "心动"));
        m.put("爱你", List.of("喜欢", "亲亲", "比心", "心动"));
        // 尴尬 / 社死
        m.put("尴尬", List.of("社死", "无语", "汗", "害羞", "不好意思", "丢脸"));
        m.put("社死", List.of("尴尬", "丢脸", "出丑", "害羞", "社恐"));
        m.put("害羞", List.of("尴尬", "不好意思", "脸红", "娇羞"));
        m.put("丢脸", List.of("尴尬", "社死", "出丑", "丢人"));
        // 恋爱 / 单身 / 表白 / 失恋
        m.put("恋爱", List.of("表白", "心动", "喜欢", "甜蜜", "秀恩爱", "酸臭味"));
        m.put("单身", List.of("单身狗", "狗粮", "秀恩爱", "酸臭味", "恋爱"));
        m.put("表白", List.of("恋爱", "喜欢", "心动", "亲亲", "mua", "女神"));
        m.put("失恋", List.of("分手", "伤心", "不相信爱情", "难过", "单身"));
        m.put("秀恩爱", List.of("单身狗", "狗粮", "恋爱", "酸臭味", "甜蜜"));
        // 考试 / 学习
        m.put("考试", List.of("复习", "学习", "挂科", "及格", "高分", "成绩", "写作业"));
        m.put("学习", List.of("考试", "复习", "看书", "写作业", "上课"));
        m.put("挂科", List.of("考试", "不及格", "重修", "惨", "成绩"));
        m.put("复习", List.of("考试", "学习", "看书", "熬夜", "背书"));
        // 减肥 / 胖
        m.put("减肥", List.of("变胖", "瘦", "节食", "锻炼", "体重", "身材"));
        m.put("胖", List.of("减肥", "变胖", "吃货", "小胖", "吃多了"));
        m.put("瘦", List.of("减肥", "身材", "苗条", "我瘦我先走"));
        // 天气
        m.put("天气", List.of("下雨", "下雪", "热", "冷", "台风", "晴天"));
        m.put("下雨", List.of("天气", "雨天", "淋雨", "湿", "雨伞"));
        m.put("下雪", List.of("天气", "雪天", "冷", "堆雪人"));
        m.put("热", List.of("天气", "热死了", "空调", "出汗", "夏天"));
        m.put("冷", List.of("天气", "好冷", "冻", "保暖", "冬天"));
        // 节日
        m.put("过年", List.of("春节", "红包", "新年", "恭喜发财", "拜年"));
        m.put("红包", List.of("过年", "恭喜发财", "收钱", "抢红包", "发财"));
        m.put("生日", List.of("生日快乐", "蛋糕", "祝福", "许愿"));
        m.put("圣诞", List.of("圣诞节", "礼物", "平安夜", "圣诞老人"));
        m.put("恭喜", List.of("恭喜发财", "红包", "祝贺", "新年快乐"));
        // 购物 / 消费
        m.put("购物", List.of("买买买", "剁手", "逛街", "花钱", "清空购物车"));
        m.put("买买买", List.of("购物", "剁手", "花钱", "清空购物车", "双十一"));
        // 睡眠 / 作息
        m.put("睡觉", List.of("晚安", "困", "睡", "熬夜", "犯困"));
        m.put("起床", List.of("早八", "闹钟", "困", "赖床", "早起"));
        m.put("周末", List.of("放假", "休息", "出去玩", "不上班"));
        // 情绪 / 状态
        m.put("无聊", List.of("没事干", "发呆", "找人聊天", "闲", "犯困"));
        m.put("嫌弃", List.of("鄙视", "看不起", "白眼", "丑拒", "嫌弃"));
        m.put("借钱", List.of("抠门", "没钱", "哭穷", "拒绝", "借我点钱"));
        m.put("摆烂", List.of("躺平", "无所谓", "放弃", "摆烂", "破罐破摔"));
        m.put("选择困难", List.of("纠结", "选择", "犹豫", "穿什么", "选择恐惧"));
        m.put("中二", List.of("变身", "热血", "奥特曼", "咒语", "大招"));
        m.put("蹦迪", List.of("嗨", "摇头", "打节拍", "音乐", "跳舞"));
        return Map.copyOf(m);
    }
}
