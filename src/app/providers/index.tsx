import type { PropsWithChildren } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';

import { queryClient } from '@/shared/lib/react-query/query-client';

/**
 * 앱 전역 프로바이더 합성 지점.
 * 라우터/Mantine 등은 제품 단계에서 이곳에 추가한다 (docs/fsd/app.md 참고).
 */
export const Providers = ({ children }: PropsWithChildren) => {
	return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
};
