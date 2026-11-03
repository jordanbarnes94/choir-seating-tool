import js from '@eslint/js';
import vue from 'eslint-plugin-vue';
import globals from 'globals';

export default [
  { ignores: ['dist/', 'src-tauri/', '.smoke/'] },
  js.configs.recommended,
  ...vue.configs['flat/essential'],
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        // Written in by `define` in vite.config.js.
        __APP_VERSION__: 'readonly',
        __APP_HOMEPAGE__: 'readonly',
        __APP_DOWNLOAD__: 'readonly',
        __APP_AUTHOR__: 'readonly',
        __APP_AUTHOR_SITE__: 'readonly',
        __APP_REPOSITORY__: 'readonly'
      }
    },
    rules: {
      // `catch {}` is how the app says a failure (blocked storage, say) does not matter.
      'no-empty': ['error', { allowEmptyCatch: true }]
    }
  },
  {
    files: ['tools/**', 'test/**', '*.config.js'],
    languageOptions: { globals: { ...globals.node } }
  }
];
