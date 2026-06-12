import type { ExampleUpdateRequestDto } from '../dto/example-update.dto';
import type { ExampleUpdateRequest } from '../types/example-update.types';

/* mutation 입력: 클라이언트 → 서버 DTO (camelCase + boolean → snake_case + Y/N) */
export function mapExampleUpdateRequestToDto(request: ExampleUpdateRequest): ExampleUpdateRequestDto {
	return {
		exam_id: request.id,
		exam_name: request.name,
		use_yn: request.isActive ? 'Y' : 'N',
	};
}
