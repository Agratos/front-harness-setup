import { useExampleListQuery } from '@/entities/example';

/**
 * feature = 사용자 인터랙션/유스케이스 단위 UI.
 * 엔티티의 공개 훅(클라이언트 타입)만 소비한다 — DTO/mapper 는 모른다.
 */
export const ExampleList = () => {
	const { data: items = [], isPending, isError } = useExampleListQuery();

	if (isPending) {
		return <p>예시 목록을 불러오는 중입니다…</p>;
	}

	if (isError) {
		return <p>서버 미연결 상태입니다 — 예시 목록을 불러올 수 없습니다.</p>;
	}

	if (items.length === 0) {
		return <p>표시할 예시 데이터가 없습니다.</p>;
	}

	return (
		<ul>
			{items.map((item) => (
				<li key={item.id}>
					{item.name} {item.isActive ? '(사용)' : '(미사용)'}
				</li>
			))}
		</ul>
	);
};
