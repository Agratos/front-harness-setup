import { HomePage } from '@/pages/home';

import { Providers } from './providers';

export const App = () => {
	return (
		<Providers>
			<main>
				<h1>harness-setup</h1>
				<p>멀티 에이전트 자율 개발 하네스 — FSD 웹프론트 스캐폴드</p>
				<HomePage />
			</main>
		</Providers>
	);
};
