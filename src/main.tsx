import { createRoot } from 'react-dom/client';

import { App } from '@/app';

const rootElement = document.getElementById('root');
if (!rootElement) {
	throw new Error('#root 엘리먼트를 찾을 수 없습니다.');
}

createRoot(rootElement).render(<App />);
