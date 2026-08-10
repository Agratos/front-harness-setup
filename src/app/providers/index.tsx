import type { PropsWithChildren } from 'react';
import { MantineProvider } from '@mantine/core';
import { QueryClientProvider } from '@tanstack/react-query';

import { queryClient } from '@/shared/lib/react-query/query-client';

/**
 * 앱 전역 프로바이더 합성 지점.
 *
 * MantineProvider 는 Mantine 컴포넌트(테마·스타일)의 전제이므로 최상단에 둔다.
 * 예전에는 "제품 단계에서 추가하라"고 문서로만 안내했는데, 그 결과 UI 를 만드는 모든
 * 프로젝트가 같은 배선(provider + CSS import + jsdom 스텁)을 매번 손으로 다시 했다.
 * 라우터(react-router-dom)는 라우트가 생기는 시점에 이곳에서 감싼다 — docs/fsd/app.md 참고.
 */
export const Providers = ({ children }: PropsWithChildren) => {
	return (
		<MantineProvider>
			<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
		</MantineProvider>
	);
};
