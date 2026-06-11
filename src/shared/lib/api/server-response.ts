import { ApiError } from './api-error';

/** 표준 서버 envelope: { resultCode, resultMessage, result }. */
export type ServerResponse<T = unknown> = {
	resultCode: number;
	resultMessage: string;
	result: T;
};

export const SERVER_RESULT_CODE = {
	SUCCESS: 200,
	COMMON_ERROR: 300,
	BAD_REQUEST: 400,
	AUTH_ERROR: 403,
	AUTHENTICATION_TIMEOUT: 419,
	DELETE_ERROR: 700,
	SERVER_DEPENDENCY_EXISTS: 710,
	SAVE_ERROR: 800,
	INPUT_CHECK_ERROR: 900,
} as const;

export function isServerResponse(value: unknown): value is ServerResponse {
	if (typeof value !== 'object' || value === null) return false;
	return 'resultCode' in value && 'resultMessage' in value && 'result' in value;
}

export function getDefaultServerErrorMessage(resultCode: number): string {
	switch (resultCode) {
		case SERVER_RESULT_CODE.SUCCESS:
			return '성공했습니다.';
		case SERVER_RESULT_CODE.COMMON_ERROR:
			return '요청 처리 중 오류가 발생했습니다.';
		case SERVER_RESULT_CODE.BAD_REQUEST:
			return '잘못된 요청입니다.';
		case SERVER_RESULT_CODE.AUTH_ERROR:
			return '인가된 사용자가 아닙니다.';
		case SERVER_RESULT_CODE.AUTHENTICATION_TIMEOUT:
			return '이미 로그인이 만료되었거나 정보가 유효하지 않습니다.';
		case SERVER_RESULT_CODE.DELETE_ERROR:
			return '삭제 중 내부 오류가 발생했습니다.';
		case SERVER_RESULT_CODE.SERVER_DEPENDENCY_EXISTS:
			return '서버에 종속된 프로세스가 존재합니다.';
		case SERVER_RESULT_CODE.SAVE_ERROR:
			return '저장 시 내부 오류가 발생했습니다.';
		case SERVER_RESULT_CODE.INPUT_CHECK_ERROR:
			return '입력값 무결성 오류입니다.';
		default:
			return '알 수 없는 서버 오류가 발생했습니다.';
	}
}

/** mutation 응답이 envelope 이면 성공코드를 검증하고, 실패 시 ApiError(BUSINESS) 를 던집니다. */
export function validateServerMutationResponse<T>(response: T): T {
	if (!isServerResponse(response)) return response;

	if (response.resultCode !== SERVER_RESULT_CODE.SUCCESS) {
		throw new ApiError({
			kind: 'BUSINESS',
			status: response.resultCode,
			data: response,
			message: response.resultMessage || getDefaultServerErrorMessage(response.resultCode),
		});
	}

	return response;
}
