import * as fs from "fs";
import {
    create_embedding_pipeline,
    generate_embedding,
    EMBEDDING_MODEL,
} from "../../src/utils/wiki-embeddings.js";

const INDEX_DIR = "indexes/cppref";

interface CpprefEntry {
    title: string;
    path: string;
    wgPageName: string;
    headers?: string[];
    sample_declaration?: string;
    other_declarations?: number;
}

interface CpprefIndex {
    c: CpprefEntry[];
    cpp: CpprefEntry[];
}

function create_cppref_embedding_content(entry: CpprefEntry): string {
    const parts = [entry.title];
    if (entry.wgPageName) {
        parts.push(entry.wgPageName.replace(/\//g, " "));
    }
    if (entry.headers && entry.headers.length > 0) {
        parts.push(`Headers: ${entry.headers.join(", ")}`);
    }
    if (entry.sample_declaration) {
        parts.push(entry.sample_declaration);
    }
    return parts.join("\n");
}

(async () => {
    console.log("Loading cppref index...");
    const index_path = `${INDEX_DIR}/cppref_index.json`;
    const index_data: CpprefIndex = JSON.parse(await fs.promises.readFile(index_path, { encoding: "utf-8" }));

    const all_entries: Array<{ name: string; entry: CpprefEntry }> = [];
    for (const entry of index_data.c) {
        all_entries.push({ name: `c/${entry.wgPageName}`, entry });
    }
    for (const entry of index_data.cpp) {
        all_entries.push({ name: `cpp/${entry.wgPageName}`, entry });
    }

    console.log(`Loaded ${all_entries.length} cppref entries`);

    console.log("Loading embedding model (this may take a while on first run)...");
    const extractor = await create_embedding_pipeline();

    console.log("Generating embeddings...");
    const embeddings: Record<string, number[]> = {};

    let count = 0;
    for (const { name, entry } of all_entries) {
        const content = create_cppref_embedding_content(entry);
        embeddings[name] = await generate_embedding(content, extractor);
        count++;
        if (count % 100 === 0 || count === all_entries.length) {
            console.log(`  Generated ${count}/${all_entries.length} embeddings...`);
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
