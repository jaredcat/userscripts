import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import ts from 'typescript-eslint';

/** @type {import('eslint').Linter.Config[]} */
export default [
  js.configs.recommended,
  ...ts.configs.recommended,
  prettier,
  {
    files: ['src/**/*.ts'],
    ...ts.configs.recommendedTypeChecked[0],
    languageOptions: {
      ...ts.configs.recommendedTypeChecked[0].languageOptions,
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parserOptions: {
        ...ts.configs.recommendedTypeChecked[0].languageOptions?.parserOptions,
        projectService: true,
      },
    },
    rules: {
      // Security rules
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-script-url': 'error',
      // Type safety
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'error',
      // Code quality
      complexity: ['warn', { max: 15 }],
      'max-lines-per-function': ['warn', { max: 100, skipComments: true }],
      'max-depth': ['warn', { max: 4 }],
      'max-params': ['warn', { max: 5 }],
      // Best practices
      'no-magic-numbers': [
        'warn',
        {
          ignore: [0, 1, -1],
          ignoreArrayIndexes: true,
          ignoreDefaultValues: true,
        },
      ],
      'prefer-const': 'error',
      'no-var': 'error',
      // Error handling
      'no-throw-literal': 'error',
      'prefer-promise-reject-errors': 'error',
    },
  },
  {
    ignores: [
      'dist/',
      '**/*.js',
      '**/*.mjs',
      '**/*.cjs',
      'vite.config.ts',
      'eslint.config.mjs',
      'scripts/**',
    ],
  },
];
