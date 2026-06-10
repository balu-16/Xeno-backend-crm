const js = require("@eslint/js");
const tseslint = require("typescript-eslint");

module.exports = tseslint.config(
  { ignores: ["dist", "src/generated", "prisma/seed-neon.js"] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    files: ["**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: __dirname
      }
    },
    rules: {
      "@typescript-eslint/no-extraneous-class": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
      "@typescript-eslint/no-unnecessary-type-conversion": "off",
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { "allowNumber": true }
      ],
      "@typescript-eslint/no-misused-promises": [
        "error",
        { "checksVoidReturn": false }
      ]
    }
  },
  {
    files: ["src/dev/seed-data.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off"
    }
  }
);
