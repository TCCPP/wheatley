import * as fs from "fs";
import { globIterate } from "glob";
import { parse_article, WIKI_ARTICLES_PATH, WikiArticle } from "../../src/components/wiki.js";
import {
    create_embedding_pipeline,
    generate_embedding,
    create_embedding_content,
    EMBEDDING_MODEL,
} from "../../src/utils/wiki-embeddings.js";

const INDEX_DIR = "indexes/wiki";

(async () => {
    console.log("Loading wiki articles...");
    const articles: Record<string, WikiArticle> = {};
    for await (const file_path of globIterate(`${WIKI_ARTICLES_PATH}/**/*.md`, { withFileTypes: true })) {
        const content = await fs.promises.readFile(file_path.fullpath(), { encoding: "utf-8" });
        try {
            const [article] = parse_article(file_path.name, content, str => str);
            articles[file_path.name] = article;
        } catch (e: any) {
            console.error(`Failed to parse article ${file_path.name}: ${e.message}`);
        }
    }
    console.log(`Loaded ${Object.keys(articles).length} articles`);

    console.log("Loading embedding model (this may take a while on first run)...");
    const extractor = await create_embedding_pipeline();

    console.log("Generating embeddings...");
    const embeddings: Record<string, number[]> = {};

    let count = 0;
    for (const [name, article] of Object.entries(articles)) {
        const content = create_embedding_content(article);
        embeddings[name] = await generate_embedding(content, extractor);
        count++;
        console.log(`  Generated ${count}/${Object.keys(articles).length} embeddings...`);
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
