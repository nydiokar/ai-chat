import eslint from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tseslintParser from '@typescript-eslint/parser';
import unusedImports from 'eslint-plugin-unused-imports';

export default [
  // Base ESLint configuration
  eslint.configs.recommended,
  
  // TypeScript ESLint configuration
  {
    files: ['src/**/*.{js,jsx,ts,tsx}'],
    ignores: ['**/dist/**', '**/build/**', '**/node_modules/**'],
    languageOptions: {
      globals: {
        // Testing globals
        describe: 'readonly',
        it: 'readonly',
        before: 'readonly',
        after: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        // Node.js globals
        process: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        Buffer: 'readonly',
        // Browser globals used in Node environment
        crypto: 'readonly',
        NodeJS: 'readonly',
      },
      parser: tseslintParser,
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: './',
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      'unused-imports': unusedImports,
    },
    rules: {
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
        'warn',
        { 
          'vars': 'all', 
          'varsIgnorePattern': '^_', 
          'args': 'after-used', 
          'argsIgnorePattern': '^_' 
        }
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-unused-vars': 'error',
      'no-empty': ['error', { 'allowEmptyCatch': true }], // Allow empty catch blocks
      'no-control-regex': 'off', // Disable control character check in regex
      'no-unused-vars': 'off', // Use @typescript-eslint version instead
      'no-undef': 'error',
      'no-useless-catch': 'error'
    }
  }
];
