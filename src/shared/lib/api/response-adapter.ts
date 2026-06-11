/* eslint-disable @typescript-eslint/no-explicit-any */
import { getDefaultServerErrorMessage, isServerResponse, SERVER_RESULT_CODE } from './server-response';

/**
 * 백엔드 "응답 계약" 을 한 곳에 격리하는 단일 교체 지점(seam).
 *
 * 기본값(defaultResponseAdapter)은 표준 계약을 구현합니다:
 *   { resultCode, resultMessage, result }, 성공 = 200
 *
 * ⭐ 백엔드가 다르면(REST bare json / 다른 키·코드) 이 파일에서 setResponseAdapter(...) 로
 *    어댑터만 교체하면 끝입니다 (query/mutation/엔티티 코드 무수정).
 */
export type ResponseAdapter = {
	/** 응답이 envelope 형태인지 */
	isEnvelope: (value: unknown) => boolean;
	/** 성공 응답인지 */
	isSuccess: (response: any) => boolean;
	/** envelope 에서 실제 payload 추출 */
	unwrap: <T = unknown>(response: any) => T;
	/** 실패 시 사용자 메시지 */
	getErrorMessage: (response: any) => string;
};

export const defaultResponseAdapter: ResponseAdapter = {
	isEnvelope: isServerResponse,
	isSuccess: (response) => response?.resultCode === SERVER_RESULT_CODE.SUCCESS,
	unwrap: (response) => response?.result,
	getErrorMessage: (response) =>
		response?.resultMessage || getDefaultServerErrorMessage(response?.resultCode ?? -1),
};

let activeAdapter: ResponseAdapter = defaultResponseAdapter;

/** 앱 진입 전 한 번 호출해 백엔드 계약을 갈아끼웁니다. */
export function setResponseAdapter(adapter: ResponseAdapter) {
	activeAdapter = adapter;
}

export function getResponseAdapter(): ResponseAdapter {
	return activeAdapter;
}

/**
 * React Query `select` 헬퍼. 성공이면 project(payload), 실패면 fallback 을 반환합니다.
 * 엔티티는 envelope 의 resultCode 를 몰라도 됩니다 (계약 의존 제거).
 *
 * 예) select: (res) => selectResult(res, (p) => p.resultList.map(mapper), [])
 */
export function selectResult<TResponse, TOut>(
	response: TResponse,
	project: (payload: any) => TOut,
	fallback: TOut,
): TOut {
	if (!activeAdapter.isSuccess(response)) {
		return fallback;
	}

	return project(activeAdapter.unwrap(response));
}
