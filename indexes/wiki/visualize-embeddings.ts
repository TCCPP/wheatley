import * as fs from "fs";
import { UMAP } from "umap-js";

const INDEX_DIR = process.argv[2] || "indexes/wiki";

interface EmbeddingsData {
    model_info: {
        model: string;
        dimension: number;
    };
    embeddings: Record<string, number[]>;
}

interface VisualizationPoint {
    x: number;
    y: number;
    name: string;
}

function generate_visualization_html(
    points: VisualizationPoint[],
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
        * {
            box-sizing: border-box;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            margin: 0;
            padding: 0;
            background-color: #f0f2f5;
            height: 100vh;
            overflow: hidden;
        }
        body.dark-mode {
            background-color: #1a1a2e;
        }
        .app-container {
            display: flex;
            height: 100vh;
        }
        .sidebar {
            width: 300px;
            background-color: white;
            border-right: 1px solid #e0e0e0;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }
        body.dark-mode .sidebar {
            background-color: #16213e;
            border-right-color: #0f3460;
        }
        .sidebar-header {
            padding: 16px;
            border-bottom: 1px solid #e0e0e0;
        }
        body.dark-mode .sidebar-header {
            border-bottom-color: #0f3460;
        }
        .sidebar-header h1 {
            margin: 0 0 8px 0;
            font-size: 18px;
            color: #333;
        }
        body.dark-mode .sidebar-header h1 {
            color: #e0e0e0;
        }
        .search-box {
            width: 100%;
            padding: 10px 12px;
            border: 1px solid #ddd;
            border-radius: 6px;
            font-size: 14px;
            outline: none;
            transition: border-color 0.2s;
        }
        .search-box:focus {
            border-color: #4a90d9;
        }
        body.dark-mode .search-box {
            background-color: #0f3460;
            border-color: #1a4d7c;
            color: #e0e0e0;
        }
        .controls {
            padding: 12px 16px;
            border-bottom: 1px solid #e0e0e0;
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
        }
        body.dark-mode .controls {
            border-bottom-color: #0f3460;
        }
        .control-btn {
            padding: 6px 12px;
            border: 1px solid #ddd;
            border-radius: 4px;
            background: #f9f9f9;
            cursor: pointer;
            font-size: 12px;
            transition: all 0.2s;
        }
        .control-btn:hover {
            background: #e9e9e9;
        }
        .control-btn.active {
            background: #4a90d9;
            color: white;
            border-color: #4a90d9;
        }
        body.dark-mode .control-btn {
            background: #0f3460;
            border-color: #1a4d7c;
            color: #e0e0e0;
        }
        body.dark-mode .control-btn:hover {
            background: #1a4d7c;
        }
        body.dark-mode .control-btn.active {
            background: #e94560;
            border-color: #e94560;
        }
        .article-list {
            flex: 1;
            overflow-y: auto;
            padding: 8px;
        }
        .article-item {
            padding: 8px 12px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
            color: #333;
            transition: background 0.2s;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .article-color-dot {
            width: 10px;
            height: 10px;
            border-radius: 50%;
            flex-shrink: 0;
        }
        .article-item:hover {
            background: #f0f0f0;
        }
        .article-item.selected {
            background: #e3f2fd;
        }
        .article-item.highlighted {
            background: #fff3e0;
        }
        body.dark-mode .article-item {
            color: #e0e0e0;
        }
        body.dark-mode .article-item:hover {
            background: #0f3460;
        }
        body.dark-mode .article-item.selected {
            background: #1a4d7c;
        }
        body.dark-mode .article-item.highlighted {
            background: #4a3000;
        }
        .main-content {
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            position: relative;
        }
        .info-bar {
            padding: 12px 16px;
            background: white;
            border-bottom: 1px solid #e0e0e0;
            font-size: 13px;
            color: #666;
        }
        body.dark-mode .info-bar {
            background: #16213e;
            border-bottom-color: #0f3460;
            color: #aaa;
        }
        .info-bar strong {
            color: #333;
        }
        body.dark-mode .info-bar strong {
            color: #e0e0e0;
        }
        #plot {
            flex: 1;
            min-height: 0;
        }
        .detail-panel {
            position: absolute;
            bottom: 20px;
            right: 20px;
            width: 320px;
            background: white;
            border-radius: 8px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.15);
            display: none;
            overflow: hidden;
        }
        body.dark-mode .detail-panel {
            background: #16213e;
            box-shadow: 0 4px 20px rgba(0,0,0,0.4);
        }
        .detail-panel.visible {
            display: block;
        }
        .detail-header {
            padding: 12px 16px;
            background: #4a90d9;
            color: white;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        body.dark-mode .detail-header {
            background: #e94560;
        }
        .detail-title {
            font-weight: 600;
            font-size: 14px;
        }
        .detail-close {
            background: none;
            border: none;
            color: white;
            cursor: pointer;
            font-size: 18px;
            line-height: 1;
            padding: 0;
        }
        .detail-body {
            padding: 12px 16px;
        }
        .detail-row {
            margin-bottom: 8px;
            font-size: 13px;
        }
        .detail-label {
            color: #888;
            font-size: 11px;
            text-transform: uppercase;
            margin-bottom: 2px;
        }
        .detail-value {
            color: #333;
        }
        body.dark-mode .detail-value {
            color: #e0e0e0;
        }
        .neighbors-list {
            list-style: none;
            padding: 0;
            margin: 0;
        }
        .neighbor-item {
            padding: 6px 0;
            cursor: pointer;
            color: #4a90d9;
            font-size: 13px;
            transition: color 0.2s;
        }
        .neighbor-item:hover {
            color: #2a70b9;
        }
        body.dark-mode .neighbor-item {
            color: #e94560;
        }
        body.dark-mode .neighbor-item:hover {
            color: #ff6b8a;
        }
        .hidden-by-filter {
            display: none !important;
        }
    </style>
</head>
<body>
    <div class="app-container">
        <div class="sidebar">
            <div class="sidebar-header">
                <h1>Wiki Embeddings</h1>
                <input type="text" class="search-box" id="searchBox" placeholder="Search articles...">
            </div>
            <div class="controls">
                <button class="control-btn" id="toggleLabels">Labels</button>
                <button class="control-btn" id="darkModeBtn">Dark Mode</button>
                <button class="control-btn" id="resetViewBtn">Reset View</button>
            </div>
            <div class="article-list" id="articleList"></div>
        </div>
        <div class="main-content">
            <div class="info-bar">
                <strong>Model:</strong> ${model_info.model} |
                <strong>Dimension:</strong> ${model_info.dimension} &rarr; 2 (UMAP) |
                <strong>Articles:</strong> ${points.length}
            </div>
            <div id="plot"></div>
            <div class="detail-panel" id="detailPanel">
                <div class="detail-header">
                    <span class="detail-title" id="detailTitle">Article</span>
                    <button class="detail-close" id="detailClose">&times;</button>
                </div>
                <div class="detail-body">
                    <div class="detail-row">
                        <div class="detail-label">Coordinates</div>
                        <div class="detail-value" id="detailCoords"></div>
                    </div>
                    <div class="detail-row">
                        <div class="detail-label">Nearest Neighbors</div>
                        <ul class="neighbors-list" id="neighborsList"></ul>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <script>
        const data = ${data_json};

        let selectedPointIndex = null;
        let showLabels = false;
        let isDarkMode = false;

        // Compute center of all points
        const centerX = data.reduce((sum, p) => sum + p.x, 0) / data.length;
        const centerY = data.reduce((sum, p) => sum + p.y, 0) / data.length;

        // Compute angle from center for each point (0 to 1)
        const pointAngles = data.map(p => {
            const angle = Math.atan2(p.y - centerY, p.x - centerX);
            return (angle + Math.PI) / (2 * Math.PI);
        });

        // Convert angle (0-1) to rainbow color
        function angleToColor(angle) {
            const hue = angle * 360;
            return 'hsl(' + hue + ', 100%, 50%)';
        }

        function buildArticleList(filter = '') {
            const container = document.getElementById('articleList');
            container.innerHTML = '';
            const filterLower = filter.toLowerCase();
            data.forEach((point, idx) => {
                const name = point.name.replace(/\\.md$/, '');
                const matches = !filter || name.toLowerCase().includes(filterLower);
                const item = document.createElement('div');
                item.className = 'article-item';
                if (!matches) item.classList.add('hidden-by-filter');
                if (matches && filter) item.classList.add('highlighted');
                if (idx === selectedPointIndex) item.classList.add('selected');
                const colorDot = document.createElement('span');
                colorDot.className = 'article-color-dot';
                colorDot.style.backgroundColor = angleToColor(pointAngles[idx]);
                item.appendChild(colorDot);
                item.appendChild(document.createTextNode(name));
                item.onclick = () => selectPoint(idx);
                container.appendChild(item);
            });
        }

        function findNearestNeighbors(pointIndex, count = 5) {
            const point = data[pointIndex];
            const distances = data.map((p, i) => ({
                index: i,
                name: p.name,
                distance: Math.sqrt(Math.pow(p.x - point.x, 2) + Math.pow(p.y - point.y, 2))
            }));
            distances.sort((a, b) => a.distance - b.distance);
            return distances.slice(1, count + 1);
        }

        function selectPoint(index) {
            selectedPointIndex = index;
            const point = data[index];
            const panel = document.getElementById('detailPanel');
            document.getElementById('detailTitle').textContent = point.name.replace(/\\.md$/, '');
            document.getElementById('detailCoords').textContent = 'x: ' + point.x.toFixed(3) + ', y: ' + point.y.toFixed(3);

            const neighbors = findNearestNeighbors(index);
            const neighborsList = document.getElementById('neighborsList');
            neighborsList.innerHTML = '';
            neighbors.forEach(n => {
                const li = document.createElement('li');
                li.className = 'neighbor-item';
                li.textContent = n.name.replace(/\\.md$/, '');
                li.onclick = (e) => {
                    e.stopPropagation();
                    selectPoint(n.index);
                };
                neighborsList.appendChild(li);
            });

            panel.classList.add('visible');
            buildArticleList(document.getElementById('searchBox').value);
            updatePlot();
        }

        function updatePlot() {
            const searchTerm = document.getElementById('searchBox').value.toLowerCase();

            const markerSizes = data.map((p, i) => {
                if (i === selectedPointIndex) return 16;
                if (searchTerm && p.name.toLowerCase().includes(searchTerm)) return 12;
                return 8;
            });

            const markerOpacities = data.map((p, i) => {
                if (i === selectedPointIndex) return 1;
                if (searchTerm && !p.name.toLowerCase().includes(searchTerm)) return 0.3;
                return 0.8;
            });

            const trace = {
                x: data.map(p => p.x),
                y: data.map(p => p.y),
                text: data.map(p => p.name.replace(/\\.md$/, '')),
                customdata: data.map((p, i) => i),
                mode: showLabels ? 'markers+text' : 'markers',
                type: 'scatter',
                marker: {
                    size: markerSizes,
                    color: pointAngles,
                    colorscale: 'Rainbow',
                    opacity: markerOpacities,
                    line: {
                        color: data.map((p, i) => i === selectedPointIndex ? '#000' : 'transparent'),
                        width: 2
                    }
                },
                textposition: 'top center',
                textfont: {
                    size: 9,
                    color: isDarkMode ? '#e0e0e0' : '#333'
                },
                hovertemplate: '<b>%{text}</b><br>x: %{x:.3f}<br>y: %{y:.3f}<extra></extra>'
            };

            const layout = {
                xaxis: {
                    title: 'UMAP 1',
                    zeroline: true,
                    gridcolor: isDarkMode ? '#0f3460' : '#e0e0e0',
                    color: isDarkMode ? '#e0e0e0' : '#333'
                },
                yaxis: {
                    title: 'UMAP 2',
                    zeroline: true,
                    gridcolor: isDarkMode ? '#0f3460' : '#e0e0e0',
                    color: isDarkMode ? '#e0e0e0' : '#333'
                },
                hovermode: 'closest',
                plot_bgcolor: isDarkMode ? '#1a1a2e' : '#fafafa',
                paper_bgcolor: isDarkMode ? '#1a1a2e' : 'white',
                margin: { l: 50, r: 20, t: 20, b: 50 }
            };

            const config = {
                responsive: true,
                displayModeBar: true,
                modeBarButtonsToRemove: ['lasso2d', 'select2d'],
                displaylogo: false
            };

            Plotly.react('plot', [trace], layout, config);
        }

        document.getElementById('searchBox').addEventListener('input', (e) => {
            buildArticleList(e.target.value);
            updatePlot();
        });

        document.getElementById('toggleLabels').addEventListener('click', () => {
            showLabels = !showLabels;
            document.getElementById('toggleLabels').classList.toggle('active', showLabels);
            updatePlot();
        });

        document.getElementById('darkModeBtn').addEventListener('click', () => {
            isDarkMode = !isDarkMode;
            document.body.classList.toggle('dark-mode', isDarkMode);
            document.getElementById('darkModeBtn').classList.toggle('active', isDarkMode);
            updatePlot();
        });

        document.getElementById('resetViewBtn').addEventListener('click', () => {
            Plotly.relayout('plot', {
                'xaxis.autorange': true,
                'yaxis.autorange': true
            });
        });

        document.getElementById('detailClose').addEventListener('click', () => {
            selectedPointIndex = null;
            document.getElementById('detailPanel').classList.remove('visible');
            buildArticleList(document.getElementById('searchBox').value);
            updatePlot();
        });

        buildArticleList();
        updatePlot();

        document.getElementById('plot').on('plotly_click', (eventData) => {
            if (eventData.points.length > 0) {
                const pointIndex = eventData.points[0].customdata;
                selectPoint(pointIndex);
            }
        });
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

    console.log("Applying UMAP to reduce dimensions to 2D...");

    // Seeded random number generator for reproducible results
    function mulberry32(seed: number) {
        return function () {
            let t = (seed += 0x6d2b79f5);
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    const umap = new UMAP({
        nComponents: 2,
        nNeighbors: 15,
        minDist: 0.1,
        spread: 1.0,
        nEpochs: 400,
        random: mulberry32(42),
    });

    const embedding = umap.fit(embeddings_matrix);

    const points: VisualizationPoint[] = embedding.map((coords: number[], idx: number) => ({
        x: coords[0],
        y: coords[1],
        name: article_names[idx],
    }));

    console.log("UMAP dimensionality reduction complete.");

    console.log("Generating HTML visualization...");
    const html = generate_visualization_html(points, embeddings_data.model_info);

    const output_path = `${INDEX_DIR}/embeddings-visualization.html`;
    await fs.promises.writeFile(output_path, html);
    console.log(`Saved visualization to ${output_path}`);
    console.log(`Open the file in a web browser to view the interactive visualization.`);
})();
