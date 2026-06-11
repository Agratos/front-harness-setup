# pages 레이어

## 1. 책임 / 정의

`pages` 는 **라우트 단위 화면**을 조립하는 오케스트레이터입니다. 한 페이지가:

- **폼 인스턴스**(`useForm` + `zodResolver`)와 **조회 파라미터/상태**를 소유하고,
- **`entities` 쿼리**로 데이터를 가져와,
- **`features`**(검색·필터·다운로드 등)와 **`widgets`**(테이블·그래프 등)에 `form`·`data`·콜백을 **props 로 내려줍니다.**

자체 비즈니스 로직은 최소화하고, 실제 UI 는 features/widgets 가, 데이터는 entities 가 담당합니다.

> ⭐ **실재 예시: [`src/pages/home/`](../../src/pages/home/)** — feature 를 조립만 하는 최소 페이지입니다.
> 이 문서의 그 외 `example-*` 스니펫(폼 소유 패턴 등)은 작성 템플릿입니다.

---

## 2. 슬라이스 구조

페이지는 **flat** 구조입니다 — `ui/`·`model/` 세그먼트를 두지 않습니다(조립만 하므로). 페이지 폴더에
컴포넌트(`index.tsx`)·스타일(`.module.css`)·페이지 전용 헬퍼(`*.columns.ts` 등)를 둡니다.

```
src/pages/<group>/
├── <page>/
│   ├── index.tsx                 ← 페이지 컴포넌트 (<Name>Page)
│   ├── <page>.module.css         ← CSS Modules
│   └── <page>-excel.columns.ts   ← 페이지 전용 헬퍼 (선택)
└── index.ts                      ← 그룹 배럴 (각 <Name>Page re-export)
```

> 그룹이 필요 없으면 `pages/<page>/index.tsx` 로 바로 둬도 됩니다(예: `pages/login`).

---

## 3. 페이지의 역할 — 오케스트레이션

```tsx
// pages/example/example-status/index.tsx
import { useState } from 'react';
import { Flex, Stack } from '@mantine/core';
import { useForm } from '@mantine/form';
import { zodResolver } from 'mantine-form-zod-resolver';

import { useExampleListQuery } from '@/entities/example';

import {
	ExampleSearch,
	exampleSearchSchema,
	getInitialExampleSearchValues,
	type ExampleSearchValues,
} from '@/features/example-search';

import { ExampleTable } from '@/widgets/example-status';

import classes from './example-status.module.css';

export function ExampleStatusPage() {
	// 1) 폼 인스턴스 소유 (zod 스키마로 검증 연결)
	const form = useForm<ExampleSearchValues>({
		initialValues: getInitialExampleSearchValues(),
		validate: zodResolver(exampleSearchSchema),
	});

	// 2) 조회 파라미터 상태 + entities 쿼리로 데이터 fetch
	const [params, setParams] = useState<ExampleSearchValues>(form.values);
	const { data = [], isFetching } = useExampleListQuery(params);

	// 3) 제출 시 파라미터 확정 → 쿼리 재실행
	const onSubmit = form.onSubmit((values) => setParams(values));

	// 4) feature(검색폼) + widget(테이블)에 props 전달
	return (
		<Stack className={classes.wrapper}>
			<Flex className={classes.search}>
				<ExampleSearch form={form} onSubmit={onSubmit} />
			</Flex>
			<ExampleTable data={data} isFetching={isFetching} />
		</Stack>
	);
}
```

- 폼은 **페이지가 소유**하고 검색 피처에 `form` 으로 내려줍니다(`features.md §4`).
- 데이터는 **페이지가 entities 쿼리로 받아** 위젯에 `data` 로 내려줍니다(`widgets.md §3`).

---

## 4. 라우팅 등록

페이지는 `app` 레이어의 라우터에 연결됩니다(`app/providers/react-router/routes`, `docs/fsd/app.md §3.2`).

```tsx
import { ExampleStatusPage } from '@/pages/example';

// routes 트리에 추가
// { path: '/example/status', element: <ExampleStatusPage /> }
```

---

## 5. Public API 규약 (배럴)

그룹 `index.ts` 가 페이지 컴포넌트를 re-export 합니다. 라우터는 `@/pages/<group>` 배럴로 import 합니다.

```ts
// pages/example/index.ts
export { ExampleStatusPage } from './example-status';
```

```ts
// ✅ import { ExampleStatusPage } from '@/pages/example';
// ❌ import { ExampleStatusPage } from '@/pages/example/example-status'; // 그룹 배럴을 거치세요
```

---

## 6. Import 규칙

```
shared(0) < entities(1) < features(2) < widgets(3) < pages(4) < app(5)
```

`pages` 에서는 `@/shared/`, `@/entities/`, `@/features/`, `@/widgets/` import 가 허용됩니다.
`@/app/` import 는 **금지**되며, 위반 시 `node scripts/check-arch.js` 가 오류를 반환합니다.

---

## 7. 네이밍

- **파일·폴더**: `kebab-case` — `example-status/index.tsx`, `example-status.module.css`, `<page>-excel.columns.ts`
- **컴포넌트**: `PascalCase` + `Page` 접미사 (예: `ExampleStatusPage`, `LoginPage`)
- **훅·함수**: `camelCase`
- **타입**: `PascalCase`
- `interface`·`React.FC`·`export default` 금지(`naming.md`).
