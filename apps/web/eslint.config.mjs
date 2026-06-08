import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // Disable overly-strict rules introduced in eslint-config-next@16
  // that flag valid async data-fetch patterns inside useEffect.
  {
    rules: {
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/use-memo": "off",
      // Allow _underscore-prefixed names to be intentionally unused
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          "argsIgnorePattern":   "^_",
          "varsIgnorePattern":   "^_",
          "caughtErrorsIgnorePattern": "^_",
        },
      ],
    },
  },
]);

export default eslintConfig;
