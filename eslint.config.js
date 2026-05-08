import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default [
  {
      ignores: ['dist', 'src-tauri/target/**', 'src-tauri/nsis/*.cjs'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
  reactRefresh.configs.vite,
  {
      files: ['scripts/**/*.cjs'],
      languageOptions: {
          ecmaVersion: 2022,
          sourceType: 'commonjs',
          globals: globals.node,
      },
      rules: {
          '@typescript-eslint/no-require-imports': 'off',
      },
  },
    {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
      rules: {
          'react-hooks/set-state-in-effect': 'off',
      },
  },
]
