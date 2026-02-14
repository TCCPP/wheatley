import { FeatureExtractionPipeline, pipeline } from "@xenova/transformers";
export type { FeatureExtractionPipeline } from "@xenova/transformers";

export const EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";

let shared_pipeline: FeatureExtractionPipeline | null = null;

export async function get_or_create_embedding_pipeline(): Promise<FeatureExtractionPipeline> {
    if (!shared_pipeline) {
        shared_pipeline = await pipeline("feature-extraction", EMBEDDING_MODEL);
    }
    return shared_pipeline;
}

export async function create_embedding_pipeline() {
    return await pipeline("feature-extraction", EMBEDDING_MODEL);
}

export async function generate_embedding(text: string, extractor: FeatureExtractionPipeline): Promise<number[]> {
    const output = await extractor(text, { pooling: "mean", normalize: true });
    return Array.from(output.data);
}

// Embeddings are generated with normalize: true, making them unit vectors (magnitude ≈ 1.0).
// For unit vectors, cosine similarity reduces to just the dot product.
export function dot_product_similarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
        return 0;
    }
    let dot = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
    }
    return dot;
}
