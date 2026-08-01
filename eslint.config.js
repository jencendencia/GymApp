// Flat config for ESLint 10 (legacy .eslintrc.* is no longer supported).
// Mirrors the previous .eslintrc.cjs rules without requiring @eslint/js or globals.
// no-undef is intentionally off: TypeScript (tsc --noEmit) already catches
// undefined variables in the same CI pipeline.
const tseslint = require('@typescript-eslint/eslint-plugin')
const tsParser = require('@typescript-eslint/parser')

// eslint-plugin-react-hooks isn't installed; provide a no-op so the existing
// `// eslint-disable-next-line react-hooks/exhaustive-deps` comments resolve.
const reactHooksStub = {
  rules: {
    'exhaustive-deps': {
      create() {
        return {}
      },
    },
  },
}

const shared = tseslint.configs.recommended

module.exports = [
  {
    ignores: ['dist/**', 'release/**', 'node_modules/**', 'dist-electron/**'],
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
      globals: {
        // Browser + Node globals (previously provided by env: browser/node)
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        URL: 'readonly',
        Blob: 'readonly',
        File: 'readonly',
        FileReader: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        Uint8Array: 'readonly',
        ArrayBuffer: 'readonly',
        crypto: 'readonly',
        fetch: 'readonly',
        alert: 'readonly',
        confirm: 'readonly',
        prompt: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        require: 'readonly',
        module: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        HTMLCanvasElement: 'readonly',
        HTMLVideoElement: 'readonly',
        HTMLInputElement: 'readonly',
        HTMLImageElement: 'readonly',
        HTMLElement: 'readonly',
        PublicKeyCredential: 'readonly',
        navigatorCredentials: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      'react-hooks': reactHooksStub,
    },
    rules: {
      ...(shared?.rules || {}),
      'no-undef': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
    },
  },
]
