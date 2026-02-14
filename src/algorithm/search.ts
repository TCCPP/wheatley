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
//     per search_get_top_5_async call and cached in query_embedding_cache, which is read synchronously by
//     score_entry (called via the synchronous search_get_top_5 in Index). Embeddings are optional and
//     loaded from JSON files generated offline.
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
    cosine_similarity_vectors,
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

function intersect<T>(a: Set<T>, b: Set<T>) {
    return new Set([...a].filter(item => b.has(item)));
}

function raw_ngrams(str: string, n: number) {
    const arr = [];
    for (let i = 0; i <= str.length - n; i++) {
        arr.push(str.slice(i, i + n));
    }
    return arr;
}

function cosine_similarity(a_ngrams: Set<string>, b_ngrams: Set<string>, f: (_: string) => number) {
    let dot = 0;
    let a_mag = 0;
    let b_mag = 0;
    for (const ngram of new Set([...a_ngrams, ...b_ngrams])) {
        if (a_ngrams.has(ngram) && b_ngrams.has(ngram)) {
            dot += f(ngram) * f(ngram);
        }
        if (a_ngrams.has(ngram)) {
            a_mag += f(ngram) * f(ngram);
        }
        if (b_ngrams.has(ngram)) {
            b_mag += f(ngram) * f(ngram);
        }
    }
    if (a_mag == 0 || b_mag == 0) {
        return -1;
    }
    return dot / (Math.sqrt(a_mag) * Math.sqrt(b_mag));
}

function cosine_similarity_idf(
    a_ngrams: Set<string>,
    b_ngrams: Set<string>,
    ngram_idf: Record<string, number>,
    default_idf: number,
) {
    return cosine_similarity(a_ngrams, b_ngrams, s => {
        if (s in ngram_idf) {
            return ngram_idf[s];
        } else {
            return default_idf;
        }
    });
}

function log_base(base: number, x: number) {
    return Math.log(x) / Math.log(base);
}

function no_duplicates<T>(arr: T[]) {
    return new Set(arr).size == arr.length;
}

// ---------------------------------------------------------------------------------------------------------------------

const MAGIC_NGRAM_SIMILARITY_THRESHOLD = 0.39;

type EntryScore = {
    score: number;
    fuzzy_score?: number; // pre-embedding score, used for threshold checking
    debug_info: unknown[];
};

// Encapsulates all ngram/IDF scoring logic. Constructed with already-processed entry data.
class NgramScorer {
    private ngram_idf: Record<string, number> = {};
    private default_idf: number;
    private threshold: number;

    constructor(
        entries: { parsed_titles: string[]; original_title: string }[],
        options?: { threshold?: number; downweight_patterns?: string[] },
    ) {
        this.threshold = options?.threshold ?? MAGIC_NGRAM_SIMILARITY_THRESHOLD;
        const downweight_patterns = options?.downweight_patterns ?? [];
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
        // Downweight pattern ngrams so they only turn up when that's really the best option
        for (const pattern of downweight_patterns) {
            const count = pattern_counts.get(pattern) ?? 0;
            if (count) {
                for (const gram of this.make_ngrams(pattern.toLowerCase())) {
                    this.ngram_idf[gram] -= count - 1;
                }
            }
        }
        // Convert document frequencies to IDF
        const document_count = entries.length;
        for (const ngram in this.ngram_idf) {
            this.ngram_idf[ngram] = log_base(10, document_count / this.ngram_idf[ngram]);
        }
        this.default_idf = log_base(10, document_count);
    }

    make_ngrams(str: string) {
        str = ` ${str.toLowerCase()} `;
        return new Set(raw_ngrams(str, 3));
    }

    score(query: string, title: string): EntryScore {
        const query_ngrams = this.make_ngrams(query);
        const title_ngrams = this.make_ngrams(title);
        const score = cosine_similarity_idf(query_ngrams, title_ngrams, this.ngram_idf, this.default_idf);
        return {
            score,
            debug_info: [...intersect(query_ngrams, title_ngrams)],
        };
    }

    meets_threshold(score: number) {
        return score >= this.threshold;
    }

    set_threshold(threshold: number) {
        this.threshold = threshold;
    }
}

// Enhanced multi-signal scoring constants
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

export class Index<T extends IndexEntry> {
    private entries: ProcessedEntry<T>[];
    private scorer: NgramScorer;
    private embeddings: Map<string, number[]> | null = null;
    private embedding_dimension = 0;
    private extractor: FeatureExtractionPipeline | null = null;
    private query_embedding_cache: number[] | null = null;
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
            })),
            { threshold: options?.threshold, downweight_patterns: options?.downweight_patterns },
        );
    }

    private compute_token_bonus(query: string, parsed_titles: string[]): number {
        const query_tokens = tokenize(query).filter(t => !this.enhanced_options.stop_words?.has(t));
        if (query_tokens.length === 0) {
            return 0;
        }
        let best_bonus = 0;
        for (const title of parsed_titles) {
            const title_tokens = tokenize(title);
            let match_score = 0;
            for (const query_token of query_tokens) {
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
                const match_ratio = match_score / query_tokens.length;
                const coverage = Math.min(1.0, query.length / title.length);
                const bonus = match_ratio * TOKEN_MATCH_BONUS * (0.5 + 0.5 * coverage);
                best_bonus = Math.max(best_bonus, bonus);
            }
        }
        return best_bonus;
    }

    private compute_alias_bonus(query: string, entry: ProcessedEntry<T>): number {
        if (!entry.aliases || entry.aliases.length === 0) {
            return 0;
        }
        const query_lower = query.toLowerCase();
        let best_bonus = 0;
        for (const alias of entry.aliases) {
            const alias_score = this.scorer.score(query, alias.toLowerCase()).score;
            let bonus = alias_score * ALIAS_WEIGHT;
            if (alias.toLowerCase() === query_lower) {
                bonus += EXACT_TITLE_BONUS;
            }
            best_bonus = Math.max(best_bonus, bonus);
        }
        return best_bonus;
    }

    private compute_content_bonus(query: string, entry: T): number {
        if (!entry.content) {
            return 0;
        }
        const query_tokens = new Set(tokenize(query));
        const content_tokens = new Set(tokenize(entry.content));
        let bonus = 0;
        for (const query_token of query_tokens) {
            if (query_token.length >= 3 && content_tokens.has(query_token)) {
                bonus += CONTENT_TOKEN_WEIGHT;
            }
        }
        return bonus;
    }

    private compute_exact_title_bonus(query: string, parsed_titles: string[]): number {
        const query_lower = query.toLowerCase();
        for (const title of parsed_titles) {
            if (title === query_lower) {
                return EXACT_TITLE_BONUS;
            }
        }
        return 0;
    }

    private compute_embedding_bonus(fuzzy_combined: number, entry: T): number {
        if (!this.embeddings || !this.query_embedding_cache || !this.enhanced_options.embedding_key_extractor) {
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
        const similarity = cosine_similarity_vectors(this.query_embedding_cache, article_embedding);
        return fuzzy_combined + similarity * (this.enhanced_options.embedding_bonus ?? DEFAULT_EMBEDDING_BONUS);
    }

    private score_base(query: string, entry: ProcessedEntry<T>) {
        const scores: EntryScore[] = [];
        for (const title of entry.parsed_title) {
            if (tokenize(title).length == 0) {
                // TODO: slow
                continue;
            }
            scores.push(this.scorer.score(query, title));
        }
        return max(scores, s => s.score);
    }

    private score_entry(query: string, entry: ProcessedEntry<T>) {
        const base_result = this.score_base(query, entry);
        const token_bonus = this.compute_token_bonus(query, entry.parsed_title);
        const alias_bonus = this.compute_alias_bonus(query, entry);
        const content_bonus = this.compute_content_bonus(query, entry);
        const exact_title_bonus = this.compute_exact_title_bonus(query, entry.parsed_title);
        const fuzzy_combined =
            base_result.score +
            token_bonus +
            content_bonus +
            Math.max(alias_bonus, exact_title_bonus) +
            (entry.boost ?? 0);
        const final_score = this.compute_embedding_bonus(fuzzy_combined, entry);
        return {
            score: final_score,
            fuzzy_score: fuzzy_combined,
            debug_info: base_result.debug_info,
        };
    }

    search_get_top_5(query: string) {
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
        const candidates: candidate_entry[] = [];
        for (const page of this.entries) {
            const { score, fuzzy_score, debug_info } = this.score_entry(query, page);
            candidates.push({
                page,
                score,
                fuzzy_score,
                debug_info,
            });
        }
        candidates.sort((a, b) => b.score - a.score);
        /* eslint-disable @typescript-eslint/no-unnecessary-condition */
        if (DEBUG) {
            console.log(query);
        }
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
        if (this.extractor) {
            try {
                this.query_embedding_cache = await generate_embedding(query, this.extractor);
            } catch (e) {
                M.warn("Failed to generate query embedding", e);
                this.query_embedding_cache = null;
            }
        }
        const results = this.search_get_top_5(query);
        this.query_embedding_cache = null;
        return results;
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
