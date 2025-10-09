import * as fs from "fs";
// @ts-expect-error tsne-js has no types
import TSNE from "tsne-js";

const INDEX_DIR = "indexes/wiki";

interface EmbeddingsData {
    model_info: {
        model: string;
        dimension: number;
    };
    embeddings: Record<string, number[]>;
}

function generate_visualization_html(
    points: Array<{ x: number; y: number; name: string }>,
    model_info: { model: string; dimension: number },
): string {
    const data_json = JSON.stringify(points);

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Wiki Embeddings Visualization</title>
    <script src="https://cdn.plot.ly/plotly-2.27.0.min.js"></script>
    <style>
        body {
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 20px;
            background-color: #f5f5f5;
        }
        .container {
            max-width: 1400px;
            margin: 0 auto;
            background-color: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        h1 {
            margin-top: 0;
            color: #333;
        }
        .info {
            color: #666;
            margin-bottom: 20px;
            padding: 10px;
            background-color: #f9f9f9;
            border-radius: 4px;
        }
        #plot {
            width: 100%;
            height: 900px;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Wiki Embeddings Visualization</h1>
        <div class="info">
            <strong>Model:</strong> ${model_info.model}<br>
            <strong>Original Dimension:</strong> ${model_info.dimension}<br>
            <strong>Reduced Dimension:</strong> 2 (using t-SNE)<br>
            <strong>Number of Articles:</strong> ${points.length}<br>
            <br>
            <em>Article names are displayed next to each point. Hover for details. Use the toolbar to zoom, pan, and interact with the plot.</em>
        </div>
        <div id="plot"></div>
    </div>

    <script>
        const data = ${data_json};

        // Calculate smart text positions to avoid overlap
        function calculateTextPositions(points) {
            const positions = [];
            const positionOptions = [
                'top right', 'middle right', 'bottom right',
                'top left', 'middle left', 'bottom left',
                'top center', 'bottom center'
            ];

            for (let i = 0; i < points.length; i++) {
                const point = points[i];
                let bestPosition = 'middle right';
                let minNearby = Infinity;

                // Try each position and count nearby points
                for (const pos of positionOptions) {
                    let nearbyCount = 0;
                    const offset = getOffset(pos, 0.15);
                    const labelX = point.x + offset.x;
                    const labelY = point.y + offset.y;

                    for (let j = 0; j < points.length; j++) {
                        if (i === j) continue;
                        const other = points[j];
                        const dx = labelX - other.x;
                        const dy = labelY - other.y;
                        const dist = Math.sqrt(dx * dx + dy * dy);
                        if (dist < 0.15) nearbyCount++;
                    }

                    if (nearbyCount < minNearby) {
                        minNearby = nearbyCount;
                        bestPosition = pos;
                    }
                }

                positions.push(bestPosition);
            }
            return positions;
        }

        function getOffset(position, scale) {
            const offsets = {
                'top right': { x: scale, y: scale },
                'middle right': { x: scale, y: 0 },
                'bottom right': { x: scale, y: -scale },
                'top left': { x: -scale, y: scale },
                'middle left': { x: -scale, y: 0 },
                'bottom left': { x: -scale, y: -scale },
                'top center': { x: 0, y: scale },
                'bottom center': { x: 0, y: -scale }
            };
            return offsets[position] || { x: scale, y: 0 };
        }

        const textPositions = calculateTextPositions(data);

        const trace = {
            x: data.map(p => p.x),
            y: data.map(p => p.y),
            text: data.map(p => p.name.replace(/\\.md$/, '')),
            mode: 'markers+text',
            type: 'scatter',
            marker: {
                size: 8,
                color: data.map((_, i) => i),
                colorscale: 'Viridis',
                showscale: false,
                opacity: 0.7
            },
            textposition: textPositions,
            textfont: {
                size: 9,
                color: '#333'
            },
            hovertemplate: '<b>%{text}</b><br>x: %{x:.3f}<br>y: %{y:.3f}<extra></extra>'
        };

        const layout = {
            title: 'Wiki Articles in 2D Embedding Space',
            xaxis: {
                title: 'Component 1',
                zeroline: true,
                gridcolor: '#e0e0e0'
            },
            yaxis: {
                title: 'Component 2',
                zeroline: true,
                gridcolor: '#e0e0e0'
            },
            hovermode: 'closest',
            plot_bgcolor: '#fafafa',
            paper_bgcolor: 'white'
        };

        const config = {
            responsive: true,
            displayModeBar: true,
            modeBarButtonsToRemove: ['lasso2d', 'select2d'],
            displaylogo: false
        };

        Plotly.newPlot('plot', [trace], layout, config);
    </script>
</body>
</html>`;
}

(async () => {
    console.log("Loading embeddings...");
    const embeddings_path = `${INDEX_DIR}/embeddings.json`;
    const embeddings_data: EmbeddingsData = JSON.parse(
        await fs.promises.readFile(embeddings_path, { encoding: "utf-8" }),
    );

    const article_names = Object.keys(embeddings_data.embeddings);
    const embeddings_matrix = article_names.map(name => embeddings_data.embeddings[name]);

    console.log(`Loaded ${article_names.length} embeddings of dimension ${embeddings_data.model_info.dimension}`);

    console.log("Applying t-SNE to reduce dimensions to 2D...");
    const model = new TSNE({
        dim: 2,
        perplexity: 30.0,
        earlyExaggeration: 4.0,
        learningRate: 100.0,
        nIter: 1000,
        metric: "euclidean",
    });

    model.init({
        data: embeddings_matrix,
        type: "dense",
    });

    model.run();
    const output = model.getOutput();

    const points = output.map((coords: number[], idx: number) => ({
        x: coords[0],
        y: coords[1],
        name: article_names[idx],
    }));

    console.log("t-SNE dimensionality reduction complete.");

    console.log("Generating HTML visualization...");
    const html = generate_visualization_html(points, embeddings_data.model_info);

    const output_path = `${INDEX_DIR}/embeddings-visualization.html`;
    await fs.promises.writeFile(output_path, html);
    console.log(`Saved visualization to ${output_path}`);
    console.log(`Open the file in a web browser to view the interactive visualization.`);
})();
