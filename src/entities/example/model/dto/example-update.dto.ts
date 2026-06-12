/* mutation 입력 (생성/수정) — 서버 계약 그대로 (snake_case, Y/N) */
export type ExampleUpdateRequestDto = {
	exam_id: number;
	exam_name: string;
	use_yn: 'Y' | 'N';
};
