/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import svgr from 'vite-plugin-svgr';
import tsconfigPaths from 'vite-tsconfig-paths';

// 평가 고정 포트(scripts/eval-playwright.mjs / .claude/commands/evaluate.md 와 일치).
// dev·평가 모두 동일 포트를 사용해 "포트 단일 진실 공급원" 을 유지합니다.
const DEV_PORT = 8000;

export default defineConfig({
	plugins: [
		react({
			babel: {
				plugins: [['babel-plugin-react-compiler', {}]],
			},
		}),
		tsconfigPaths(),
		svgr(),
	],
	server: {
		port: DEV_PORT,
		host: true,
	},
	test: {
		// UI 하네스: 컴포넌트 렌더 테스트를 위해 DOM 환경(jsdom)을 사용합니다.
		environment: 'jsdom',
		globals: true,
		setupFiles: ['./vitest.setup.ts'],
		include: ['src/**/*.{test,spec}.{ts,tsx}'],
		// 테스트 0개는 게이트 실패로 간주합니다 (passWithNoTests 금지).
		// v1 에서 스모크 테스트가 조용히 삭제된 뒤에도 게이트가 통과했던 구멍을 막는 장치입니다.
	},
});
