import type { QueryClient, QueryKey, UseQueryOptions } from '@tanstack/react-query';
import { useQuery } from '@tanstack/react-query';

import type { ApiError } from '@/shared/lib/api/api-error';

import { createQueryApiOptions, type TRequestConfig } from './query-api';
import { queryClient as globalQueryClient } from './query-client';

/**
 * 호출 시점 동적 params 가 필요한 list/detail 용 훅.
 *
 * `queryApi(...)` 는 등록 시점에 key/params 가 고정되므로, 페이지네이션·필터 등
 * 호출마다 params 가 바뀌는 케이스는 이 훅을 씁니다.
 *
 * - `key` 에 params 를 포함하면 react-query 가 파라미터별로 캐싱을 분리합니다.
 * - 반환은 `useQuery` 결과 그대로 (data, isPending, error, ...).
 *
 * 제네릭: useQueryApi<응답DTO, 입력파라미터, 변환된 결과타입>
 */
export function useQueryApi<ResponseData, InputParams, TransformedData = ResponseData>(args: {
	key: QueryKey;
	api: TRequestConfig<InputParams>;
	options?: Omit<UseQueryOptions<ResponseData, ApiError, TransformedData>, 'queryKey' | 'queryFn'>;
}) {
	const { key, api, options } = args;
	const queryOptions = createQueryApiOptions<ResponseData, InputParams>({ key, api });

	return useQuery<ResponseData, ApiError, TransformedData>({
		...queryOptions,
		staleTime: Infinity,
		retry: false,
		...options,
	});
}

export function prefetchQueryApi<ResponseData, InputParams>(args: {
	queryClient?: QueryClient;
	key: QueryKey;
	api: TRequestConfig<InputParams>;
}) {
	const { queryClient = globalQueryClient, key, api } = args;
	const queryOptions = createQueryApiOptions<ResponseData, InputParams>({ key, api });

	return queryClient.prefetchQuery(queryOptions);
}
