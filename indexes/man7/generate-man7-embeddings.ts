import * as fs from "fs";
import { get_or_create_embedding_pipeline, generate_embedding, EMBEDDING_MODEL } from "../../src/utils/embeddings.js";

const INDEX_DIR = "indexes/man7";

interface Man7Entry {
    page_title: string;
    path: string;
    short_description?: string;
    synopsis?: string;
}

function create_man7_embedding_content(entry: Man7Entry): string {
    const parts = [entry.page_title];
    if (entry.short_description) {
        parts.push(entry.short_description);
    }
    return parts.join("\n");
}

(async () => {
    console.log("Loading man7 index...");
    const index_path = `${INDEX_DIR}/man7_index.json`;
    const index_data: Man7Entry[] = JSON.parse(await fs.promises.readFile(index_path, { encoding: "utf-8" }));

    console.log(`Loaded ${index_data.length} man7 entries`);

    console.log("Loading embedding model (this may take a while on first run)...");
    const extractor = await get_or_create_embedding_pipeline();

    console.log("Generating embeddings...");
    const embeddings: Record<string, number[]> = {};

    let count = 0;
    for (const entry of index_data) {
        const content = create_man7_embedding_content(entry);
        embeddings[entry.page_title] = await generate_embedding(content, extractor);
        count++;
        if (count % 100 === 0 || count === index_data.length) {
            console.log(`  Generated ${count}/${index_data.length} embeddings...`);
        }
    }

    console.log(`Saving embeddings`);
    const embedding_dimension = embeddings[Object.keys(embeddings)[0]].length;
    const output_data = {
        model_info: {
            model: EMBEDDING_MODEL,
            dimension: embedding_dimension,
        },
        embeddings,
    };
    const output_path = `${INDEX_DIR}/embeddings.json`;
    await fs.promises.writeFile(output_path, JSON.stringify(output_data, null, 2));
    console.log(`Saved embeddings to ${output_path}`);
    console.log(`Model: ${EMBEDDING_MODEL}, Dimension: ${embedding_dimension}`);
})();
