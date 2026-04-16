// ESLint 9 flat config for Quorum (ESM).
//
// Layout:
//   - @eslint/js recommended
//   - typescript-eslint recommended (type-checked)
//   - eslint-config-prettier LAST to disable stylistic rules that conflict with Prettier
//
// Scope: only lints TypeScript sources under `packages/<pkg>/src/**/*.ts`.
// The repo root config files (this file, *.config.ts, etc.) are intentionally
// not linted here — per-package configs may extend this if needed.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      '**/dist/**',
      'node_modules/**',
      '**/node_modules/**',
      '**/*.d.ts',
      'coverage/**',
      '**/coverage/**',
      '.turbo/**',
      '**/.turbo/**',
      // Don't lint this config file with typed rules (it's plain JS and has
      // no tsconfig entry). The file is small and self-contained.
      'eslint.config.js',
    ],
  },
  js.configs.recommended,
  // Typed-checked rules ONLY on package TS sources. Leaving them unscoped
  // would cause ESLint to try typed rules on the flat-config file itself
  // and fail with "You have used a rule which requires type information".
  {
    files: ['packages/**/src/**/*.ts'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Unused vars — prefer the tseslint version, allow leading-underscore escape hatch.
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      // Async correctness — the whole reason we bother with type-checked linting.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',

      // Type-only imports, auto-fixable.
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],

      // require-await is overly strict for handler patterns: MCP tool
      // handlers and commander .action callbacks are declared async to
      // satisfy a Promise-returning contract even when they don't await.
      // The real risks (unhandled rejections, misused promises) are
      // already covered by no-floating-promises + no-misused-promises.
      '@typescript-eslint/require-await': 'off',
    },
  },
  // Keep this last — it turns off rules that conflict with Prettier.
  prettier,
);
