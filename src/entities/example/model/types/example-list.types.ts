/**
 * Types = 클라이언트가 실제로 쓰는 형태.
 * camelCase, boolean, number, ISO 날짜 등 프론트 친화적으로 정규화한다.
 * 컴포넌트/위젯/페이지는 항상 이 타입만 본다 (DTO 를 모른다).
 */
export type ExampleItem = {
	id: number;
	name: string;
	isActive: boolean;
	status: number | null;
	registeredAt: string; // ISO
};

/* 페이지네이션 list 의 클라이언트 파라미터 — camelCase + boolean */
export type ExampleListParams = {
	page: number;
	pageSize: number;
	isActive?: boolean;
};

/* 페이지네이션 list 의 클라이언트 결과 */
export type ExampleListResult = {
	totalCount: number;
	items: ExampleItem[];
};
