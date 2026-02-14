// Scoring is layered via composition: NgramScorer handles ngram/IDF scoring, Index adds multi-signal bonuses.
//
// NgramScorer provides IDF-weighted character-trigram cosine similarity between query and title. IDF weighting
// ensures common trigrams (like " st" from "std::") contribute less. The threshold (0.39) filters garbage results.
//
// Index adds multiple additive bonus signals on top of the ngram score:
//   - Token bonus: exact/prefix word-level matches, scaled by coverage (query length / title length) so that
//     short queries matching long titles are penalized. Prefix matches require 4+ chars to avoid noise.
//   - Alias bonus: runs the full ngram scorer against entry aliases (e.g. "vector" -> "std::vector"). Weighted
//     at 0.8x to prefer primary titles. Takes max of alias bonus vs exact title bonus (not sum) because they
//     represent the same signal - "the query matches a known name for this entry".
//   - Content bonus: weak signal from page body text (headers, descriptions). Exists to break ties when
//     multiple entries have similar title scores. Only counts tokens 3+ chars to skip articles/prepositions.
//   - Embedding bonus: semantic similarity from pre-computed article embeddings (all-MiniLM-L6-v2). This is
//     purely additive re-ranking - threshold filtering uses the pre-embedding "fuzzy_score" so that embeddings
//     can't promote entries that don't have a reasonable textual match. The query embedding is computed once
//     per search_get_top_5_async call. Embeddings are optional and loaded from JSON files generated offline.
//
// Title normalization is domain-specific and provided by consumers. For example, the cppref normalizer handles
// comma-separated overload lists like "operator==, !=, <, <=>(std::optional)" by splitting into individual
// searchable entries and reconstructing the common prefix/suffix. It also strips template parameters and C++
// version tags.

import { strict as assert } from "assert";
import * as fs from "fs";

import { M } from "../utils/debugging-and-logging.js";
import {
    FeatureExtractionPipeline,
    get_or_create_embedding_pipeline,
    generate_embedding,
    dot_product_similarity,
} from "../utils/embeddings.js";

export interface IndexEntry {
    title: string;
    aliases?: string[];
    content?: string;
    boost?: number;
}

const DEBUG = false;

function max<T>(arr: T[], f: (_: T) => number = (x: T) => x as unknown as number) {
    if (arr.length == 0) {
        assert(false);
    } else {
        return arr.slice(1).reduce((previous, current) => (f(current) > f(previous) ? current : previous), arr[0]);
    }
}

export function tokenize(str: string) {
    // ~ is included, along with alphanumeric characters (and _?)
    return str
        .toLowerCase()
        .split(/[^a-z0-9~]+/gi)
        .filter(s => s != "");
}

function raw_ngrams(str: string, n: number) {
    const arr = [];
    for (let i = 0; i <= str.length - n; i++) {
        arr.push(str.slice(i, i + n));
    }
    return arr;
}

function log_base(base: number, x: number) {
    return Math.log(x) / Math.log(base);
}

function no_duplicates<T>(arr: T[]) {
    return new Set(arr).size == arr.length;
}

// ---------------------------------------------------------------------------------------------------------------------

function add_to_inverted_index<K>(index: Map<K, number[]>, key: K, value: number) {
    let list = index.get(key);
    if (!list) {
        list = [];
        index.set(key, list);
    }
    list.push(value);
}

const MAGIC_NGRAM_SIMILARITY_THRESHOLD = 0.39;

type EntryScore = {
    score: number;
    debug_info: unknown[];
};

interface NgramData {
    ngrams: Set<string>;
    magnitude: number;
}

// Encapsulates all ngram/IDF scoring logic. Constructed with already-processed entry data.
// Pre-computes per-entry ngram sets, IDF-weighted magnitudes, and an inverted trigram index.
class NgramScorer {
    private ngram_idf: Record<string, number> = {};
    private default_idf!: number;
    private threshold: number;
    private title_data_cache: Map<string, NgramData> = new Map();
    private inverted_index: Map<string, number[]> = new Map();

    constructor(
        entries: { parsed_titles: string[]; original_title: string; aliases?: string[] }[],
        options?: { threshold?: number; downweight_patterns?: string[] },
    ) {
        this.threshold = options?.threshold ?? MAGIC_NGRAM_SIMILARITY_THRESHOLD;
        const downweight_patterns = options?.downweight_patterns ?? [];
        const pattern_counts = this.compute_document_frequencies(entries, downweight_patterns);
        this.apply_downweight_patterns(pattern_counts, downweight_patterns);
        this.convert_to_idf(entries.length);
        this.build_inverted_index(entries);
    }

    private compute_document_frequencies(
        entries: { parsed_titles: string[]; original_title: string }[],
        downweight_patterns: string[],
    ): Map<string, number> {
        const pattern_counts = new Map<string, number>();
        for (const entry of entries) {
            for (const pattern of downweight_patterns) {
                if (entry.original_title.includes(pattern)) {
                    pattern_counts.set(pattern, (pattern_counts.get(pattern) ?? 0) + 1);
                }
            }
            const ngram_set = new Set<string>();
            for (const title of entry.parsed_titles) {
                for (const ngram of this.make_ngrams(title)) {
                    ngram_set.add(ngram);
                }
            }
            for (const ngram of ngram_set) {
                if (ngram in this.ngram_idf) {
                    this.ngram_idf[ngram] += 1;
                } else {
                    this.ngram_idf[ngram] = 1;
                }
            }
        }
        return pattern_counts;
    }

    // Downweight pattern ngrams so they only turn up when that's really the best option
    private apply_downweight_patterns(pattern_counts: Map<string, number>, downweight_patterns: string[]) {
        for (const pattern of downweight_patterns) {
            const count = pattern_counts.get(pattern) ?? 0;
            if (count) {
                for (const gram of this.make_ngrams(pattern.toLowerCase())) {
                    this.ngram_idf[gram] -= count - 1;
                }
            }
        }
    }

    private convert_to_idf(document_count: number) {
        for (const ngram in this.ngram_idf) {
            this.ngram_idf[ngram] = log_base(10, document_count / this.ngram_idf[ngram]);
        }
        this.default_idf = log_base(10, document_count);
    }

    private build_inverted_index(entries: { parsed_titles: string[]; aliases?: string[] }[]) {
        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            const entry_trigrams = new Set<string>();
            for (const title of entry.parsed_titles) {
                for (const ngram of this.precompute_title_data(title).ngrams) {
                    entry_trigrams.add(ngram);
                }
            }
            if (entry.aliases) {
                for (const alias of entry.aliases) {
                    for (const ngram of this.precompute_title_data(alias.toLowerCase()).ngrams) {
                        entry_trigrams.add(ngram);
                    }
                }
            }
            for (const ngram of entry_trigrams) {
                add_to_inverted_index(this.inverted_index, ngram, i);
            }
        }
    }

    private make_ngrams(str: string) {
        str = ` ${str.toLowerCase()} `;
        return new Set(raw_ngrams(str, 3));
    }

    private get_idf(ngram: string): number {
        return this.ngram_idf[ngram] ?? this.default_idf;
    }

    private precompute_title_data(title: string): NgramData {
        const cached = this.title_data_cache.get(title);
        if (cached) {
            return cached;
        }
        const ngrams = this.make_ngrams(title);
        let magnitude_sq = 0;
        for (const ngram of ngrams) {
            const idf = this.get_idf(ngram);
            magnitude_sq += idf * idf;
        }
        const data: NgramData = { ngrams, magnitude: Math.sqrt(magnitude_sq) };
        this.title_data_cache.set(title, data);
        return data;
    }

    compute_query_data(query: string): NgramData {
        const ngrams = this.make_ngrams(query);
        let magnitude_sq = 0;
        for (const ngram of ngrams) {
            const idf = this.get_idf(ngram);
            magnitude_sq += idf * idf;
        }
        return { ngrams, magnitude: Math.sqrt(magnitude_sq) };
    }

    get_candidates(query_ngrams: Set<string>): Set<number> {
        const candidates = new Set<number>();
        for (const ngram of query_ngrams) {
            const entries = this.inverted_index.get(ngram);
            if (entries) {
                for (const idx of entries) {
                    candidates.add(idx);
                }
            }
        }
        return candidates;
    }

    score_with_precomputed(query_data: NgramData, title: string): EntryScore {
        const title_data = this.title_data_cache.get(title) ?? this.precompute_title_data(title);
        if (query_data.magnitude === 0 || title_data.magnitude === 0) {
            return { score: -1, debug_info: [] };
        }
        let dot = 0;
        for (const ngram of query_data.ngrams) {
            if (title_data.ngrams.has(ngram)) {
                const idf = this.get_idf(ngram);
                dot += idf * idf;
            }
        }
        return {
            score: dot / (query_data.magnitude * title_data.magnitude),
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            debug_info: DEBUG ? [...query_data.ngrams].filter(n => title_data.ngrams.has(n)) : [],
        };
    }

    meets_threshold(score: number) {
        return score >= this.threshold;
    }

    set_threshold(threshold: number) {
        this.threshold = threshold;
    }
}

const EXACT_TITLE_BONUS = 5.0;
const TOKEN_MATCH_BONUS = 3.0;
const ALIAS_WEIGHT = 0.8;
const CONTENT_TOKEN_WEIGHT = 0.3;
const DEFAULT_EMBEDDING_BONUS = 0.3;

type EmbeddingKeyExtractor<T> = (entry: T) => string | undefined;

export type EnhancedIndexOptions<T> = {
    embedding_key_extractor?: EmbeddingKeyExtractor<T>;
    embedding_bonus?: number; // additive embedding multiplier, default 0.3
    threshold?: number;
    downweight_patterns?: string[];
    stop_words?: Set<string>;
};

type ProcessedEntry<T> = T & { parsed_title: string[] };

interface PrecomputedEntryInfo {
    title_tokens: string[][];
    content_tokens: Set<string> | null;
}

interface SearchQueryData {
    query: string;
    query_lower: string;
    tokens_for_token_bonus: string[];
    content_token_set: Set<string>;
    ngram_data: NgramData;
}

export class Index<T extends IndexEntry> {
    private entries: ProcessedEntry<T>[];
    private scorer: NgramScorer;
    private entry_info: PrecomputedEntryInfo[];
    private content_token_index: Map<string, number[]> = new Map();
    private embeddings: Map<string, number[]> | null = null;
    private embedding_dimension = 0;
    private extractor: FeatureExtractionPipeline | null = null;
    private enhanced_options: EnhancedIndexOptions<T>;

    constructor(entries: T[], normalizer: (_: string) => string[], options?: EnhancedIndexOptions<T>) {
        assert(no_duplicates(entries.map(e => e.title)));
        this.enhanced_options = options ?? {};
        this.entries = entries.map(entry => ({
            ...entry,
            parsed_title: normalizer(entry.title),
        }));
        this.scorer = new NgramScorer(
            this.entries.map(entry => ({
                parsed_titles: entry.parsed_title,
                original_title: entry.title,
                aliases: entry.aliases,
            })),
            { threshold: options?.threshold, downweight_patterns: options?.downweight_patterns },
        );
        this.entry_info = this.entries.map(entry => ({
            title_tokens: entry.parsed_title.map(title => tokenize(title)),
            content_tokens: entry.content ? new Set(tokenize(entry.content)) : null,
        }));
        // Build inverted index for content tokens so content-only matches aren't missed
        for (let i = 0; i < this.entry_info.length; i++) {
            const content_tokens = this.entry_info[i].content_tokens;
            if (content_tokens) {
                for (const token of content_tokens) {
                    if (token.length >= 3) {
                        add_to_inverted_index(this.content_token_index, token, i);
                    }
                }
            }
        }
    }

    private get_all_candidates(query_data: SearchQueryData): Set<number> {
        const candidates = this.scorer.get_candidates(query_data.ngram_data.ngrams);
        for (const query_token of query_data.content_token_set) {
            if (query_token.length >= 3) {
                const entries = this.content_token_index.get(query_token);
                if (entries) {
                    for (const idx of entries) {
                        candidates.add(idx);
                    }
                }
            }
        }
        return candidates;
    }

    private build_query_data(query: string): SearchQueryData {
        const query_tokens_raw = tokenize(query);
        return {
            query,
            query_lower: query.toLowerCase(),
            tokens_for_token_bonus: this.enhanced_options.stop_words
                ? query_tokens_raw.filter(t => !this.enhanced_options.stop_words!.has(t))
                : query_tokens_raw,
            content_token_set: new Set(query_tokens_raw),
            ngram_data: this.scorer.compute_query_data(query),
        };
    }

    private compute_token_bonus(query_data: SearchQueryData, entry_idx: number, parsed_titles: string[]): number {
        if (query_data.tokens_for_token_bonus.length === 0) {
            return 0;
        }
        const info = this.entry_info[entry_idx];
        let best_bonus = 0;
        for (let i = 0; i < parsed_titles.length; i++) {
            const title_tokens = info.title_tokens[i];
            let match_score = 0;
            for (const query_token of query_data.tokens_for_token_bonus) {
                for (const title_token of title_tokens) {
                    if (title_token === query_token) {
                        match_score += 1;
                        break;
                    } else if (title_token.startsWith(query_token) && query_token.length >= 4) {
                        match_score += 0.5;
                        break;
                    }
                }
            }
            if (match_score > 0) {
                const match_ratio = match_score / query_data.tokens_for_token_bonus.length;
                const coverage = Math.min(1.0, query_data.query.length / parsed_titles[i].length);
                const bonus = match_ratio * TOKEN_MATCH_BONUS * (0.5 + 0.5 * coverage);
                best_bonus = Math.max(best_bonus, bonus);
            }
        }
        return best_bonus;
    }

    private compute_alias_bonus(query_data: SearchQueryData, entry: ProcessedEntry<T>): number {
        if (!entry.aliases || entry.aliases.length === 0) {
            return 0;
        }
        let best_bonus = 0;
        for (const alias of entry.aliases) {
            const alias_lower = alias.toLowerCase();
            const alias_score = this.scorer.score_with_precomputed(query_data.ngram_data, alias_lower).score;
            let bonus = alias_score * ALIAS_WEIGHT;
            if (alias_lower === query_data.query_lower) {
                bonus += EXACT_TITLE_BONUS;
            }
            best_bonus = Math.max(best_bonus, bonus);
        }
        return best_bonus;
    }

    private compute_content_bonus(query_data: SearchQueryData, entry_idx: number): number {
        const content_tokens = this.entry_info[entry_idx].content_tokens;
        if (!content_tokens) {
            return 0;
        }
        let bonus = 0;
        for (const query_token of query_data.content_token_set) {
            if (query_token.length >= 3 && content_tokens.has(query_token)) {
                bonus += CONTENT_TOKEN_WEIGHT;
            }
        }
        return bonus;
    }

    private compute_exact_title_bonus(query_lower: string, parsed_titles: string[]): number {
        for (const title of parsed_titles) {
            if (title === query_lower) {
                return EXACT_TITLE_BONUS;
            }
        }
        return 0;
    }

    private compute_embedding_bonus(fuzzy_combined: number, entry: T, query_embedding: number[] | null): number {
        if (!this.embeddings || !query_embedding || !this.enhanced_options.embedding_key_extractor) {
            return fuzzy_combined;
        }
        const key = this.enhanced_options.embedding_key_extractor(entry);
        if (!key) {
            return fuzzy_combined;
        }
        const article_embedding = this.embeddings.get(key);
        if (!article_embedding) {
            return fuzzy_combined;
        }
        const similarity = dot_product_similarity(query_embedding, article_embedding);
        return fuzzy_combined + similarity * (this.enhanced_options.embedding_bonus ?? DEFAULT_EMBEDDING_BONUS);
    }

    private score_base(query_data: SearchQueryData, entry_idx: number, entry: ProcessedEntry<T>) {
        const info = this.entry_info[entry_idx];
        const scores: EntryScore[] = [];
        for (let i = 0; i < entry.parsed_title.length; i++) {
            if (info.title_tokens[i].length === 0) {
                continue;
            }
            scores.push(this.scorer.score_with_precomputed(query_data.ngram_data, entry.parsed_title[i]));
        }
        return max(scores, s => s.score);
    }

    private score_entry(
        query_data: SearchQueryData,
        entry_idx: number,
        entry: ProcessedEntry<T>,
        query_embedding: number[] | null,
    ) {
        const base_result = this.score_base(query_data, entry_idx, entry);
        const token_bonus = this.compute_token_bonus(query_data, entry_idx, entry.parsed_title);
        const alias_bonus = this.compute_alias_bonus(query_data, entry);
        const content_bonus = this.compute_content_bonus(query_data, entry_idx);
        const exact_title_bonus = this.compute_exact_title_bonus(query_data.query_lower, entry.parsed_title);
        const fuzzy_combined =
            base_result.score +
            token_bonus +
            content_bonus +
            Math.max(alias_bonus, exact_title_bonus) +
            (entry.boost ?? 0);
        const final_score = this.compute_embedding_bonus(fuzzy_combined, entry, query_embedding);
        return {
            score: final_score,
            fuzzy_score: fuzzy_combined,
            debug_info: base_result.debug_info,
        };
    }

    search_get_top_5(query: string, query_embedding: number[] | null = null) {
        if (query.trim().length === 0) {
            return [];
        }
        type candidate_entry = {
            page: ProcessedEntry<T>;
            score: number;
            fuzzy_score: number;
            debug_info: unknown[];
        };
        assert(query.length < 100);
        const query_data = this.build_query_data(query);
        const candidate_indices = this.get_all_candidates(query_data);
        const candidates: candidate_entry[] = [];
        for (const idx of candidate_indices) {
            const page = this.entries[idx];
            const { score, fuzzy_score, debug_info } = this.score_entry(query_data, idx, page, query_embedding);
            candidates.push({ page, score, fuzzy_score, debug_info });
        }
        candidates.sort((a, b) => b.score - a.score);
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (DEBUG) {
            console.log(query);
        }
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (DEBUG) {
            for (const candidate of candidates.slice(0, 3)) {
                console.log(
                    candidate.score,
                    candidate.page.parsed_title.join(", "),
                    "////",
                    candidate.debug_info.join(", "),
                );
            }
        }
        // Use fuzzy_score for threshold (pre-embedding score) to avoid embeddings promoting garbage
        return candidates
            .slice(0, 5)
            .filter(candidate => this.scorer.meets_threshold(candidate.fuzzy_score))
            .map(candidate => ({ ...candidate.page, score: candidate.score }));
    }

    search(query: string) {
        return this.search_get_top_5(query).at(0) ?? null;
    }

    async load_embeddings(path: string) {
        try {
            if (!fs.existsSync(path)) {
                M.info(`Embeddings not found at ${path}, using fuzzy search only`);
                return;
            }
            const data = JSON.parse(await fs.promises.readFile(path, "utf-8")) as {
                embeddings: Record<string, number[]>;
                model_info: { model: string; dimension: number };
            };
            this.embeddings = new Map(Object.entries(data.embeddings));
            this.embedding_dimension = data.model_info.dimension;
            M.info(`Loaded ${this.embeddings.size} embeddings from ${path} (dim=${this.embedding_dimension})`);
            this.extractor = await get_or_create_embedding_pipeline();
            M.info("Embedding pipeline ready");
        } catch (e) {
            M.warn(`Failed to load embeddings from ${path}`, e);
            this.embeddings = null;
            this.extractor = null;
        }
    }

    set_threshold(threshold: number) {
        this.scorer.set_threshold(threshold);
    }

    async search_get_top_5_async(query: string) {
        let query_embedding: number[] | null = null;
        if (this.extractor) {
            try {
                query_embedding = await generate_embedding(query, this.extractor);
            } catch (e) {
                M.warn("Failed to generate query embedding", e);
            }
        }
        return this.search_get_top_5(query, query_embedding);
    }

    async search_async(query: string) {
        return (await this.search_get_top_5_async(query)).at(0) ?? null;
    }

    async search_with_suggestions(query: string): Promise<{
        result: (ProcessedEntry<T> & { score: number }) | null;
        suggestions: (ProcessedEntry<T> & { score: number })[];
    }> {
        const results = await this.search_get_top_5_async(query);
        return {
            result: results[0] ?? null,
            suggestions: results.slice(1, 4),
        };
    }
}
