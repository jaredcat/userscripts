import narwhal from 'eslint-config-narwhal';
import globals from 'globals';

/** @type {import('eslint').Linter.Config[]} */
export default [
  ...narwhal({
    typescript: true,
    typechecked: true,
    strict: true,
    stylistic: true,
    prettier: true,
  }),
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Security rules
      'no-script-url': 'error',
      // Type safety
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
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
      // Userscript / browser DOM conventions
      'unicorn/filename-case': 'off',
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
