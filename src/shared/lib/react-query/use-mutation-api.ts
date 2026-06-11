import { type MutationFunction, useMutation, type UseMutationOptions } from '@tanstack/react-query';

import type { ApiError } from '@/shared/lib/api/api-error';
import { axiosApi } from '@/shared/lib/api/axios-api';

type RequestConfig = {
	type: 'post' | 'put' | 'patch' | 'delete';
	url: string;
	useAuth?: boolean;
	forceNoCache?: boolean;
	sendType?: 'body' | 'query';
	headers?: Record<string, string>;
	/** 명시적 query 파라미터. 생략하면 sendType 에 따라 mutate() 입력이 사용됩니다. */
	params?: unknown;
	/** 명시적 body. 폼 인코딩(URLSearchParams/FormData) 등 입력을 가공해야 할 때 사용합니다. */
	data?: unknown;
};

type UseMutationApiParams<ResponseData, InputParams> = {
	/**
	 * 정적 객체, 또는 mutate() 입력을 받아 요청 설정을 만드는 함수입니다.
	 * 함수형은 입력을 폼 데이터로 가공하거나 URL/헤더를 입력에 따라 바꿔야 할 때 씁니다.
	 */
	api: RequestConfig | ((input: InputParams) => RequestConfig);
	options?: Omit<UseMutationOptions<ResponseData, ApiError, InputParams>, 'mutationFn'>;
};

/** 생성·수정·삭제 mutation 헬퍼. 컴포넌트가 DTO 를 모르도록 wrapper 훅을 두는 것을 권장합니다. */
export const useMutationApi = <ResponseData, InputParams>({
	api,
	options,
}: UseMutationApiParams<ResponseData, InputParams>) => {
	const mutationFn: MutationFunction<ResponseData, InputParams> = async (input: InputParams) => {
		// 함수형 api 면 입력으로 요청 설정을 만든다(폼 인코딩 등). 정적 객체면 그대로 사용.
		const resolvedApi = typeof api === 'function' ? api(input) : api;
		const { type, url, useAuth = true, forceNoCache = false, sendType = 'body', headers = {}, params, data } = resolvedApi;

		return axiosApi<ResponseData>({
			method: type,
			url,
			// 명시적 params/data 가 있으면 그대로, 없으면 sendType 에 따라 mutate() 입력을 보낸다.
			params: params ?? (sendType === 'query' ? input : undefined),
			data: data ?? (sendType === 'body' ? input : undefined),
			useAuth,
			forceNoCache,
			headers,
		});
	};

	return useMutation<ResponseData, ApiError, InputParams>({
		mutationFn,
		...options,
	});
};
