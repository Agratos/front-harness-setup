import type { ExampleItemDto, ExampleListParamsDto } from '../dto/example-list.dto';
import type { ExampleItem, ExampleListParams } from '../types/example-list.types';

/* 서버 문자열 status → 클라이언트 number | null 로 정규화하는 helper */
function toNullableNumber(value: string | null): number | null {
	if (value === null || value === '') {
		return null;
	}

	const parsed = Number(value);

	return Number.isNaN(parsed) ? null : parsed;
}

/**
 * DTO(서버) → Type(클라이언트) 변환은 반드시 이 매퍼를 거친다.
 * - 필드명 정규화 (exam_id → id)
 * - 타입 정규화 (use_yn:'Y'|'N' → boolean, status:string → number|null)
 * 순수 함수로 작성 (부수효과 X) → 배열은 .map() 으로 합성.
 */
export function mapExampleItemDtoToExampleItem(dto: ExampleItemDto): ExampleItem {
	return {
		id: dto.exam_id,
		name: dto.exam_name,
		isActive: dto.use_yn === 'Y',
		status: toNullableNumber(dto.status),
		registeredAt: dto.reg_dt,
	};
}

/* 클라이언트 list 파라미터 → 서버 DTO (camelCase + boolean → snake_case + Y/N) */
export function mapExampleListParamsToDto(params: ExampleListParams): ExampleListParamsDto {
	return {
		page: params.page,
		page_size: params.pageSize,
		...(params.isActive === undefined ? {} : { use_yn: params.isActive ? 'Y' : 'N' }),
	};
}
