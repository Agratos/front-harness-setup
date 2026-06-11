import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';

import { isApiError } from '@/shared/lib/api/api-error';

// 전역 에러 핸들러 seam — 앱(app 레이어)이 모달/토스트 등으로 주입합니다. 기본은 no-op.
// (shared 는 UI 모달 스토어·auth 를 import 할 수 없으므로 의존을 역전시켜 핸들러를 받습니다.)
let globalErrorHandler: (error: unknown) => void = () => {};

/** 앱 진입 시 한 번 호출해 전역 쿼리/뮤테이션 에러 처리를 주입합니다. */
export function setGlobalQueryErrorHandler(handler: (error: unknown) => void): void {
	globalErrorHandler = handler;
}

function handleGlobalError(error: unknown) {
	if (!isApiError(error)) return;
	// 취소/비즈니스 에러는 각 호출부에서 처리 — 전역 핸들러는 네트워크/HTTP/알수없음만.
	if (error.kind === 'CANCELED' || error.kind === 'BUSINESS') return;
	globalErrorHandler(error);
}

export const queryClient = new QueryClient({
	queryCache: new QueryCache({ onError: handleGlobalError }),
	mutationCache: new MutationCache({ onError: handleGlobalError }),
	defaultOptions: {
		queries: {
			retry: false,
			refetchOnWindowFocus: false,
			staleTime: 1000 * 60 * 5,
		},
		mutations: {
			retry: false,
		},
	},
});
