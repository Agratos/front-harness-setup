import axios, { type AxiosInstance, type AxiosRequestConfig, type AxiosResponse } from 'axios';

import { ApiError } from './api-error';

function getHttpErrorMessage(status: number): string {
	switch (status) {
		case 400:
			return '잘못된 요청입니다. (400)';
		case 401:
			return '인증이 필요합니다. (401)';
		case 403:
			return '접근 권한이 없습니다. (403)';
		case 404:
			return '요청한 리소스를 찾을 수 없습니다. (404)';
		case 408:
			return '요청 시간이 초과되었습니다. (408)';
		case 409:
			return '요청이 충돌했습니다. (409)';
		case 500:
			return '서버 내부 오류가 발생했습니다. (500)';
		case 502:
			return '게이트웨이 오류가 발생했습니다. (502)';
		case 503:
			return '서비스를 사용할 수 없습니다. (503)';
		default:
			return `요청 처리 중 오류가 발생했습니다. (${status})`;
	}
}

const baseURL = import.meta.env.VITE_URL_PATH;

// 인증 토큰 seam — 상위 레이어(app/entities)가 setAuthToken 으로 주입합니다.
// (shared 는 entities 를 import 할 수 없으므로 의존을 역전시켜 토큰을 받습니다.)
let authToken: string | undefined;

/** 로그인/로그아웃 시 토큰을 갱신합니다. undefined 면 Authorization 헤더를 붙이지 않습니다. */
export function setAuthToken(token: string | undefined): void {
	authToken = token;
}

export const createAxiosInstance = (useAuth: boolean): AxiosInstance => {
	const instance = axios.create({ baseURL, timeout: 30000 });

	instance.interceptors.request.use((config) => {
		if (useAuth && authToken) {
			config.headers.Authorization = `Bearer ${authToken}`;
		}
		return config;
	});

	return instance;
};

export type AxiosApiConfig = AxiosRequestConfig & {
	useAuth?: boolean;
	forceNoCache?: boolean;
	signal?: AbortSignal;
};

export const axiosApi = async <T>(config: AxiosApiConfig): Promise<T> => {
	const { method, url, params, data, useAuth = true, forceNoCache = false, signal, ...rest } = config;

	const instance = createAxiosInstance(useAuth);

	const finalParams = method === 'get' && forceNoCache ? { ...(params ?? {}), _cb: Date.now() } : params;

	const axiosConfig: AxiosRequestConfig = { method, url, params: finalParams, data, signal, ...rest };

	try {
		const response: AxiosResponse<T> = await instance(axiosConfig);
		return response.data;
	} catch (error) {
		if (import.meta.env.DEV) {
			console.error(`[API ERROR] ${method?.toUpperCase()} ${url}`, error);
		}

		if (axios.isCancel(error)) {
			throw new ApiError({ kind: 'CANCELED', message: '요청이 취소되었습니다.' });
		}

		if (axios.isAxiosError(error)) {
			if (!error.response) {
				throw new ApiError({ kind: 'NETWORK', message: '서버와 통신할 수 없습니다.' });
			}
			throw new ApiError({
				kind: 'HTTP',
				status: error.response.status,
				message: getHttpErrorMessage(error.response.status),
				data: error.response.data,
			});
		}

		throw new ApiError({ kind: 'UNKNOWN', message: '알 수 없는 오류가 발생했습니다.' });
	}
};

export default axiosApi;
