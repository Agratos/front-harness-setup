import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import reactCompiler from 'eslint-plugin-react-compiler';
import { builtinModules } from 'node:module';

export default tseslint.config(
	{ ignores: ['dist'] },

	{
		files: ['**/*.{ts,tsx}'],
		languageOptions: {
			// tsconfig target(ES2022)과 정렬.
			ecmaVersion: 2022,
			globals: globals.browser,
		},
		extends: [js.configs.recommended, ...tseslint.configs.recommended, prettier],
		plugins: {
			'react-hooks': reactHooks,
			'react-refresh': reactRefresh,
			'simple-import-sort': simpleImportSort,
			'react-compiler': reactCompiler,
		},
		rules: {
			'@typescript-eslint/no-explicit-any': 'error',

			// React Compiler (React 19 전용)
			...reactCompiler.configs.recommended.rules,

			// React Hooks/Refresh
			...reactHooks.configs.recommended.rules,
			'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

			// Import Sort
			'simple-import-sort/imports': [
				'error',
				{
					groups: [
						[`^node:`, `^(${builtinModules.join('|')})(/|$)`],
						['^react', '^@?\\w'],
						['^@/shared/'],
						['^@/entities/'],
						['^@/features/'],
						['^@/widgets/'],
						['^@/pages/'],
						['^@/'],
						['^\\.\\.(?!/?$)', '^\\.\\./?$'],
						['^\\./(?=.*/)(?!/?$)', '^\\.(?!/?$)', '^\\./?$'],
						['\\.css$', '\\.(svg|png|jpe?g|gif|webp)$'],
					],
				},
			],
			'simple-import-sort/exports': 'error',
		},
	},
);
