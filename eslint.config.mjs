import typescriptEslint from "@typescript-eslint/eslint-plugin";
import prettier from "eslint-plugin-prettier";
import globals from "globals";
import tsParser from "@typescript-eslint/parser";
import path from "node:path";
import { fileURLToPath } from "node:url";
import js from "@eslint/js";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
    baseDirectory: __dirname,
    recommendedConfig: js.configs.recommended,
    allConfig: js.configs.all,
});

export default [
    {
        ignores: ["**/scratch", "**/*.js", "**/indexes"],
    },
    ...compat.extends("eslint:recommended", "plugin:@typescript-eslint/recommended", "prettier"),
    {
        plugins: {
            "@typescript-eslint": typescriptEslint,
            prettier,
        },

        languageOptions: {
            globals: {
                ...globals.browser,
            },

            parser: tsParser,
            ecmaVersion: "latest",
            sourceType: "module",

            parserOptions: {
                project: "./tsconfig.json",
            },
        },

        rules: {
            "max-len": ["error", 120],
            semi: ["error", "always"],
            "no-unused-vars": ["off"],
            "no-constant-condition": ["off"],

            "semi-spacing": [
                "error",
                {
                    before: false,
                    after: true,
                },
            ],

            "no-empty": [
                "error",
                {
                    allowEmptyCatch: true,
                },
            ],

            "object-curly-spacing": ["error", "always"],
            "comma-spacing": ["error"],
            "computed-property-spacing": ["error"],

            "brace-style": [
                "error",
                "1tbs",
                {
                    allowSingleLine: true,
                },
            ],

            "eol-last": ["error"],
            "semi-style": ["error", "last"],

            "prefer-const": [
                "error",
                {
                    destructuring: "all",
                },
            ],

            curly: ["error"],
            "prettier/prettier": "warn",
            "@typescript-eslint/no-unused-vars": ["off"],
            "@typescript-eslint/no-non-null-assertion": ["off"],
            "@typescript-eslint/no-explicit-any": ["off"],
            "@typescript-eslint/no-unnecessary-type-assertion": ["error"],

            "@typescript-eslint/no-unnecessary-condition": [
                "error",
                {
                    allowConstantLoopConditions: true,
                },
            ],

            "@typescript-eslint/no-this-alias": [
                "error",
                {
                    allowedNames: ["self"],
                },
            ],

            "@typescript-eslint/no-floating-promises": ["error"],
            "@typescript-eslint/no-misused-promises": ["error"],
            "@typescript-eslint/await-thenable": ["error"],

            "@typescript-eslint/naming-convention": [
                "error",
                {
                    selector: "variable",
                    format: ["snake_case", "UPPER_CASE", "snake_case"],
                    leadingUnderscore: "allow",
                },
                {
                    selector: "variable",
                    format: null,
                    modifiers: ["destructured"],
                },
            ],
        },
    },
];
