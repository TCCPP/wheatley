import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        include: ["test/**/*.ts", "**/__tests__/**/*.ts"],
        exclude: ["**/node_modules/**"],
    },
});
