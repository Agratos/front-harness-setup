import type { ApiResponseBase } from '@/shared/lib/api/types';

/**
 * DTO = 서버가 내려주는 "원본" 형태.
 * snake_case, 약어, 문자열 status, Y/N 플래그 등 서버 사정 그대로 둔다.
 * 절대 컴포넌트에서 직접 쓰지 않는다 → 반드시 mapper 를 거쳐 types 로 변환.
 */
export type ExampleItemDto = {
	exam_id: number;
	exam_name: string;
	use_yn: string; // 'Y' | 'N'
	status: string | null; // 서버는 문자열로 내려줌
	reg_dt: string; // 서버 날짜 문자열
};

export type ExampleListResponseDto = ApiResponseBase & {
	result: {
		resultList: ExampleItemDto[];
	};
};

/* 파라미터 있는 list (페이지네이션 + 필터) — 서버 약어/snake_case 그대로 */
export type ExampleListParamsDto = {
	page: number;
	page_size: number;
	use_yn?: 'Y' | 'N';
};

export type ExampleListPagedResponseDto = ApiResponseBase & {
	result: {
		total_count: number;
		resultList: ExampleItemDto[];
	};
};
