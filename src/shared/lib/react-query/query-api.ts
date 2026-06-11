import type { QueryClient, QueryFunctionContext, QueryKey, UseQueryOptions } from '@tanstack/react-query';
import { useQuery } from '@tanstack/react-query';

import type { ApiError } from '@/shared/lib/api/api-error';
import { axiosApi } from '@/shared/lib/api/axios-api';

import { queryClient as globalQueryClient } from './query-client';

export type RequestType = 'get' | 'post';

export type TRequestConfig<InputParams> = {
	url: string;
	params?: InputParams;
	useAuth?: boolean;
	forceNoCache?: boolean;
	type?: RequestType;
	headers?: Record<string, string>;
};

export function createQueryApiOptions<ResponseData, InputParams>(args: {
	key: QueryKey;
	api: TRequestConfig<InputParams>;
}) {
	const { key, api } = args;

	const queryFn = async ({ signal }: QueryFunctionContext): Promise<ResponseData> => {
		const { url, params, useAuth = true, forceNoCache = false, type = 'get', headers = {} } = api;

		return axiosApi<ResponseData>({
			method: type,
			url,
			...(type === 'get' ? { params } : { data: params }),
			useAuth,
			forceNoCache,
			signal,
			headers,
		});
	};

	return { queryKey: key, queryFn } as const;
}

/**
 * 등록형(무파라미터/고정 파라미터) 쿼리 헬퍼.
 * `[useQueryHook, prefetch]` 튜플을 반환합니다. 동적 params 에는 `useQueryApi` 를 쓰세요.
 * 제네릭: queryApi<응답DTO, 입력파라미터, 변환된 결과타입>
 */
export function queryApi<ResponseData, InputParams, TransformedData = ResponseData>(args: {
	key: QueryKey;
	api: TRequestConfig<InputParams>;
	options?: Omit<UseQueryOptions<ResponseData, ApiError, TransformedData>, 'queryKey' | 'queryFn'>;
	queryClient?: QueryClient;
}) {
	const { key, api, options, queryClient = globalQueryClient } = args;
	const opts = createQueryApiOptions<ResponseData, InputParams>({ key, api });

	function useQueryHook() {
		return useQuery<ResponseData, ApiError, TransformedData>({
			...opts,
			staleTime: Infinity,
			retry: false,
			...options,
		});
	}

	function prefetchApi() {
		return queryClient.prefetchQuery(opts);
	}

	return [useQueryHook, prefetchApi] as const;
}
