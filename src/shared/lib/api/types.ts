/** 서버 응답 envelope 의 공통 베이스 (resultCode/resultMessage). DTO 가 확장해 사용합니다. */
export type ApiResponseBase = {
	resultCode: number;
	resultMessage: string;
};
