import { createRoot } from 'react-dom/client';

import { App } from '@/app';

// Mantine 컴포넌트의 스타일 진입점. providers 의 MantineProvider 와 **한 쌍**이다 —
// 빠뜨리면 게이트(typecheck/lint/test)는 전부 통과하는데 화면만 깨진다(루브릭도 못 잡는 종류).
// Mantine 을 쓰지 않는 프로젝트라면 이 줄과 providers 의 MantineProvider 를 함께 지운다.
import '@mantine/core/styles.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
	throw new Error('#root 엘리먼트를 찾을 수 없습니다.');
}

createRoot(rootElement).render(<App />);
