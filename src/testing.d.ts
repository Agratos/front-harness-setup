// 테스트 매처 타입 보강 — @testing-library/jest-dom 매처(toBeInTheDocument 등)를
// vitest 의 expect 타입에 전역으로 추가합니다. (런타임 등록은 vitest.setup.ts 가 담당)
import '@testing-library/jest-dom/vitest';
