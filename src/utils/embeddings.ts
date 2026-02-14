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

export async function generate_embedding(text: string, extractor: FeatureExtractionPipeline): Promise<number[]> {
    const output = await extractor(text, { pooling: "mean", normalize: true });
    return Array.from(output.data);
}

export function round_embeddings(embeddings: Record<string, number[]>, decimals = 5): Record<string, number[]> {
    const factor = Math.pow(10, decimals);
    const rounded: Record<string, number[]> = {};
    for (const [key, values] of Object.entries(embeddings)) {
        rounded[key] = values.map(v => Math.round(v * factor) / factor);
    }
    return rounded;
}

export function serialize_embeddings_data(data: {
    model_info: { model: string; dimension: number };
    embeddings: Record<string, number[]>;
}): string {
    const lines: string[] = [];
    lines.push(`{`);
    lines.push(`    "model_info": ${JSON.stringify(data.model_info)},`);
    lines.push(`    "embeddings": {`);
    const entries = Object.entries(data.embeddings).sort(([a], [b]) => a.localeCompare(b));
    for (let i = 0; i < entries.length; i++) {
        const [key, values] = entries[i];
        const suffix = i < entries.length - 1 ? "," : "";
        lines.push(`        ${JSON.stringify(key)}: [${values.join(",")}]${suffix}`);
    }
    lines.push(`    }`);
    lines.push(`}`);
    return lines.join("\n");
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
