/* mutation 입력 (클라이언트 측) — camelCase + boolean. 서버 전송 직전에 mapper 로 DTO 화한다. */
export type ExampleUpdateRequest = {
	id: number;
	name: string;
	isActive: boolean;
};
