// vitest 전역 셋업 — @testing-library/jest-dom 매처를 vitest expect 에 등록합니다.
// vite.config.ts 의 test.setupFiles 가 매 테스트 파일 전에 이 파일을 로드합니다.
import '@testing-library/jest-dom/vitest';

// ── jsdom 미구현 API 스텁 ────────────────────────────────────────────────
// Mantine 은 이 저장소의 **선언된 의존성**이고 docs/fsd/app.md 는 제품 단계에서
// MantineProvider 를 붙이라고 안내한다. 그런데 jsdom 에는 matchMedia 가 없어서,
// provider 를 붙이는 순간 모든 렌더 테스트가 `window.matchMedia is not a function` 으로
// 무너졌다(실측 사고 — 스택이 react/@mantine 내부라 자기 구현 잘못으로 오인하기 쉽다).
// 스캐폴드가 제품 단계 진입을 미리 준비해 둔다.
if (!window.matchMedia) {
	window.matchMedia = ((query: string) => ({
		matches: false,
		media: query,
		onchange: null,
		addListener: () => {},
		removeListener: () => {},
		addEventListener: () => {},
		removeEventListener: () => {},
		dispatchEvent: () => false,
	})) as unknown as typeof window.matchMedia;
}

// Mantine 의 일부 컴포넌트(Select·Combobox 등)가 ResizeObserver 를 사용한다. jsdom 에는 없다.
if (!globalThis.ResizeObserver) {
	globalThis.ResizeObserver = class {
		observe() {}
		unobserve() {}
		disconnect() {}
	} as unknown as typeof ResizeObserver;
}
