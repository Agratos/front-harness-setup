import { ExampleList } from '@/features/example-list';

/**
 * page = 라우트 단위 화면. feature/widget 을 조립만 하고 비즈니스 로직을 갖지 않는다.
 */
export const HomePage = () => {
	return (
		<section>
			<h2>예시 목록 (FSD 표준 패턴 데모)</h2>
			<ExampleList />
		</section>
	);
};
