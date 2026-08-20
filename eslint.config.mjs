import nextPlugin from "@next/eslint-plugin-next";
import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

// Deliberately the non-type-checked preset. The type-aware rules are the valuable half of
// typescript-eslint, but they need a full program per package and turn a two-second lint into a
// thirty-second one — and `pnpm check` runs `tsc` across every package anyway, so the type errors
// they would catch are already caught. What is left here is the class of mistake the compiler is
// happy with: an unused import, a `case` that falls through, a regex that can never match. Fast
// enough to run on every build is worth more than exhaustive.
export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/.next/**",
      "**/node_modules/**",
      "stores/**",
      "test-results/**",
      "web/next-env.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.es2022 },
    },
    rules: {
      // This codebase leans on `any` at the boundaries where it is talking to a browser page, a
      // Lighthouse result, or an unvalidated JSON blob — places where a real type would be a
      // fiction. Flagging every one of them would mean a hundred warnings nobody reads.
      "@typescript-eslint/no-explicit-any": "off",
      // `catch {}` with a comment explaining why the error is irrelevant is a deliberate pattern
      // here (see killRunTree's ESRCH handling); the rule cannot tell it from a real swallow.
      "no-empty": ["error", { allowEmptyCatch: true }],
      // An unused parameter is often documentation of a callback's shape, and a caught error that
      // is intentionally ignored is the pattern above. An unused *variable* is usually a leftover,
      // so that half stays on.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { args: "none", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
    },
  },
  {
    files: ["web/**/*.ts", "web/**/*.tsx"],
    // The Next and react-hooks plugins are registered rather than imported through
    // `eslint-config-next`, which drags in a react/import/jsx-a11y stack this repo does not
    // otherwise use. Registering them also makes the `eslint-disable-next-line
    // @next/next/no-img-element` comments already in web/ resolve — an unknown rule in a disable
    // directive is itself an ESLint error, so a partial setup is worse than none.
    plugins: { "@next/next": nextPlugin, "react-hooks": reactHooks },
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      // Pages-Router-only. With no pages/ directory it prints a "cannot be found" banner on every
      // run, which trains people to skim past lint output.
      "@next/next/no-html-link-for-pages": "off",
      // The one hooks rule that catches a real bug rather than a style preference: a conditional
      // hook silently corrupts state. `exhaustive-deps` is left off — this codebase has several
      // deliberate single-shot effects where adding the dependency would loop.
      "react-hooks/rules-of-hooks": "error",
    },
  },
);
