import { FeatureExtractionPipeline, pipeline } from "@xenova/transformers";
import type { WikiArticle } from "../modules/wheatley/components/wiki.js";

export const EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";

export async function create_embedding_pipeline() {
    return await pipeline("feature-extraction", EMBEDDING_MODEL);
}

export async function generate_embedding(text: string, extractor: FeatureExtractionPipeline): Promise<number[]> {
    const output = await extractor(text, { pooling: "mean", normalize: true });
    return Array.from(output.data);
}

export function cosine_similarity_vectors(a: number[], b: number[]): number {
    if (a.length !== b.length) {
        return 0;
    }
    let dot = 0;
    let mag_a = 0;
    let mag_b = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        mag_a += a[i] * a[i];
        mag_b += b[i] * b[i];
    }
    if (mag_a === 0 || mag_b === 0) {
        return 0;
    }
    return dot / (Math.sqrt(mag_a) * Math.sqrt(mag_b));
}

export function create_embedding_content(article: WikiArticle): string {
    const content_parts = [article.title];
    if (article.body) {
        content_parts.push(article.body);
    }
    for (const field of article.fields) {
        content_parts.push(`${field.name}: ${field.value}`);
    }
    return content_parts.join("\n");
}
