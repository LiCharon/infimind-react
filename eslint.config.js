import js from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'

export default defineConfig([
  // ecosystem.config.cjs is JSON consumed by the deployment tool, not JavaScript.
  globalIgnores(['dist/**', 'node_modules/**', 'server/data/**', 'ecosystem.config.cjs']),
  {
    files: ['**/*.{js,mjs,cjs,jsx}'],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      // Keep the pre-existing lint backlog visible without blocking adoption of the command.
      'no-control-regex': 'warn',
      'no-dupe-keys': 'warn',
      'no-empty': 'warn',
      'no-irregular-whitespace': 'warn',
      'no-unused-vars': 'warn',
      'no-useless-escape': 'warn',
    },
  },
  {
    files: ['src/**/*.{js,jsx}'],
    ...react.configs.flat.recommended,
    languageOptions: {
      ...react.configs.flat.recommended.languageOptions,
      globals: globals.browser,
    },
    plugins: {
      ...react.configs.flat.recommended.plugins,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      ...reactRefresh.configs.vite.rules,
      'react-refresh/only-export-components': 'warn',
      'react/no-unknown-property': 'warn',
      'react/no-unescaped-entities': 'warn',
      'react/prop-types': 'off',
      'react/react-in-jsx-scope': 'off',
    },
  },
  {
    files: ['*.{js,mjs,cjs}', 'server/**/*.{js,mjs,cjs}'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
    },
  },
])
