# widgets 레이어

## 1. 책임 / 정의

`widgets` 는 **페이지에 배치되는 독립적인 UI 블록**입니다. 헤더, 사이드 내비, 데이터 테이블, 그래프 카드,
상세 모달 등 재사용 가능한 화면 구성 단위가 한 슬라이스가 됩니다.

- 여러 **`features`** + **`entities`** + **`@/shared/ui`** 를 **조합**해 의미 있는 블록을 만듭니다.
- 페이지(라우트 화면)에서의 배치는 `pages` 가 담당합니다.

> 이 문서의 `example-*` 스니펫은 **작성 템플릿**입니다 — widgets 슬라이스는 아직 `src/` 에 없습니다
> (현재 실재 예시는 entities/features/pages 에 있습니다: `docs/fsd/README.md` 참고).

---

## 2. 슬라이스 구조 (세그먼트)

단순 위젯은 **`ui/` + `index.ts`**, 파트가 여러 개인 복잡한 위젯은 **기능별 하위 폴더**(`table/`·`graph/`·
`detail-modal/` 등)로 나눕니다. 위젯 전용 타입·상태는 `model/`, 순수 유틸은 `lib/` 에 둡니다.

**단순 위젯**

```
src/widgets/<widget>/
├── ui/
│   ├── index.tsx              ← 위젯 컴포넌트 (또는 <widget>.tsx)
│   └── <widget>.module.css
├── model/                     ← 위젯 전용 타입/상태 (선택)
│   └── types.ts
├── lib/                       ← 위젯 전용 유틸 (선택)
└── index.ts                   ← public API 배럴
```

**복잡한 위젯 (여러 파트)**

```
src/widgets/<widget>/
├── table/
│   ├── index.tsx              ← 테이블 파트
│   └── table.module.css
├── detail-modal/
│   ├── index.tsx              ← 모달 파트
│   └── <modal>.module.css
├── graph/                     ← 그래프 파트 (선택)
├── model/                     ← 공유 타입/상태 (선택)
└── index.ts                   ← 각 파트를 re-export
```

---

## 3. 컴포넌트

- **CSS Modules** + 명명 함수 컴포넌트, props 로 데이터·콜백을 받습니다.
- 데이터는 두 방식 중 택일:
  - **(a) 부모/page 가 `entities` 쿼리로 받아 props 로 내려줌** — 데이터 테이블 등에 권장.
  - **(b) 위젯이 직접 `entities` 훅/스토어 사용** — 헤더처럼 전역 상태에 의존할 때.
- `features` 컴포넌트를 합성합니다(예: 테이블 위젯 툴바에 필터 피처를 끼워 넣음).

```tsx
// table/index.tsx (발췌)
import { Box } from '@mantine/core';

import { ContainerTable } from '@/shared/ui/container-table'; // 공용 테이블 래퍼

import type { Example } from '@/entities/example';

import { ExampleFilterToolbar } from '@/features/example-filter';

import classes from './table.module.css';

type Props = { data: Example[]; isFetching: boolean };

export function ExampleTable({ data, isFetching }: Props) {
	return (
		<Box className={classes.container}>
			{/* ContainerTable 로 columns/data 렌더, renderToolbar 에 ExampleFilterToolbar 합성 */}
		</Box>
	);
}
```

> 데이터 테이블은 `mantine-react-table` + 공용 `@/shared/ui` 래퍼(`ContainerTable` 등)를 사용합니다
> (최소 베이스에는 미설치 — 테이블 도입 시 의존성·공용 래퍼 추가). 단순 블록은 Mantine `@mantine/core` 만으로 충분합니다.

---

## 4. Public API 규약 (배럴)

`index.ts` 로 위젯(또는 각 파트)을 노출합니다. 세그먼트/파트 내부 파일 직접 import 금지.

```ts
// index.ts (여러 파트)
export { ExampleTable } from './table';
export { ExampleDetailModal } from './detail-modal';
```

```ts
// index.ts (단순 위젯)
export { ExampleWidget } from './ui';
```

```ts
// ✅ import { ExampleTable } from '@/widgets/example-status';
// ❌ import { ExampleTable } from '@/widgets/example-status/table';  // 파트 내부 직접 접근 금지
```

---

## 5. Import 규칙

```
shared(0) < entities(1) < features(2) < widgets(3) < pages(4) < app(5)
```

`widgets` 에서는 `@/shared/`, `@/entities/`, `@/features/` import 가 허용됩니다. `@/pages/`, `@/app/`
import 는 **금지**되며, 위반 시 `node scripts/check-arch.js` 가 오류를 반환합니다.

---

## 6. 네이밍

- **파일·폴더**: `kebab-case` — `page-header.tsx`(또는 `index.tsx`), `table.module.css`, `model/types.ts`, `lib/use-<x>.ts`
- **컴포넌트**: `PascalCase` (예: `PageHeader`, `ExampleTable`)
- **훅·함수**: `camelCase` (예: `usePageHeader`)
- **타입**: `PascalCase`
- `interface`·`React.FC`·`export default` 금지(`naming.md`).
