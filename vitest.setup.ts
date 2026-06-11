// vitest 전역 셋업 — @testing-library/jest-dom 매처를 vitest expect 에 등록합니다.
// vite.config.ts 의 test.setupFiles 가 매 테스트 파일 전에 이 파일을 로드합니다.
import '@testing-library/jest-dom/vitest';
