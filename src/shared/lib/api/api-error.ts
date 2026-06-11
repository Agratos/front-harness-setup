export type ApiErrorKind = 'NETWORK' | 'HTTP' | 'BUSINESS' | 'CANCELED' | 'UNKNOWN';

type ApiErrorArgs = {
	message: string;
	kind: ApiErrorKind;
	status?: number;
	data?: unknown;
};

/** API 계층의 표준 에러. kind 로 네트워크/HTTP/비즈니스/취소/알수없음을 구분합니다. */
export class ApiError extends Error {
	kind: ApiErrorKind;
	status?: number;
	data?: unknown;

	constructor(args: ApiErrorArgs) {
		super(args.message);

		this.name = 'ApiError';
		this.kind = args.kind;
		this.status = args.status;
		this.data = args.data;

		Object.setPrototypeOf(this, ApiError.prototype);
	}
}

export const isApiError = (error: unknown): error is ApiError => {
	return error instanceof ApiError;
};
