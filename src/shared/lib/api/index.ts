// shared/lib/api — HTTP/응답 계약 인프라 (그룹 배럴)
export { ApiError, type ApiErrorKind, isApiError } from './api-error';
export { axiosApi, type AxiosApiConfig, createAxiosInstance, setAuthToken } from './axios-api';
export {
	defaultResponseAdapter,
	getResponseAdapter,
	type ResponseAdapter,
	selectResult,
	setResponseAdapter,
} from './response-adapter';
export {
	getDefaultServerErrorMessage,
	isServerResponse,
	SERVER_RESULT_CODE,
	type ServerResponse,
	validateServerMutationResponse,
} from './server-response';
export type { ApiResponseBase } from './types';
