# features 레이어

## 1. 책임 / 정의

`features` 는 **사용자 인터랙션 단위**의 UI 입니다. 검색·필터, 폼 제출, 토글, 컨텍스트 메뉴 등
"사용자가 무언가를 한다"는 행위 하나가 한 슬라이스가 됩니다.

- 도메인 데이터는 **`entities` 의 쿼리/뮤테이션 훅**을 가져다 씁니다 (피처는 API 를 정의하지 않습니다).
- 공용 컴포넌트는 `@/shared/ui` 에서, 화면 배치(조합)는 `widgets`/`pages` 가 담당합니다.

> ⭐ **실재 예시: [`src/features/example-list/`](../../src/features/example-list/)** — 엔티티 공개 훅만
> 소비하는 최소 피처입니다. 이 문서의 그 외 `example-*` 스니펫은 작성 템플릿입니다.

---

## 2. 슬라이스 구조 (세그먼트)

피처 슬라이스는 **`ui/` + `index.ts`** 가 기본이고, 폼·로컬 상태·헬퍼가 있으면 `model/`(+ `lib/`)을 둡니다.
**`api/` 는 두지 않습니다** — 서버 호출은 entities 에 있고, 피처는 그 훅을 소비합니다.

```
src/features/<feature>/
├── ui/
│   ├── <feature>.tsx          ← 컴포넌트 (단일이면 index.tsx 도 가능)
│   └── <feature>.module.css   ← CSS Modules 스타일
├── model/                     ← 폼·로컬상태·타입·훅 (선택)
│   ├── form.ts                    ← zod 스키마 + 초기값 + 폼 타입(z.infer)
│   ├── <feature>.types.ts         ← 피처 전용 타입 (선택)
│   ├── <feature>.store.ts         ← Zustand 로컬 상태
│   └── use-<feature>.ts           ← 피처 전용 훅
├── lib/                       ← 순수 유틸 (선택)
└── index.ts                   ← public API 배럴
```

> 피처가 많아지면 도메인으로 묶습니다: `features/<group>/<feature>/` (예: `admin/login-policy/row-action`).

---

## 3. ui — 컴포넌트 (+ CSS Modules)

- **명명 함수 컴포넌트** (`export function Xxx(props: Props)`). props 로 데이터·콜백을 받습니다.
- 스타일은 **CSS Modules**: `import classes from './x.module.css'` → `className={classes.x}`.
- 서버 데이터는 `@/entities` 훅으로, 공용 컴포넌트는 `@/shared/ui` 로 가져옵니다.

```tsx
// ui/example-search.tsx
import { Flex } from '@mantine/core';
import type { UseFormReturnType } from '@mantine/form';

import { useExampleOptionsQuery } from '@/entities/example';

import type { ExampleSearchValues } from '../model/form';

import classes from './example-search.module.css';

type Props = {
	form: UseFormReturnType<ExampleSearchValues>;
	onSubmit?: () => void;
};

export function ExampleSearch({ form, onSubmit }: Props) {
	const { data: options = [] } = useExampleOptionsQuery();

	return (
		<form onSubmit={form.onSubmit(() => onSubmit?.())}>
			<Flex className={classes.wrapper}>
				{/* form.getInputProps('keyword') 로 입력 연결, options 로 select 데이터 채움 */}
			</Flex>
		</form>
	);
}
```

> 폼 인스턴스(`useForm`)는 **부모(widget/page)가 소유**하고, 피처는 `form` 을 props 로 받아 입력만 그립니다.
> 컴포넌트는 `Props` 를 `type` 으로 정의하고 `React.FC` 를 쓰지 않습니다(`naming.md`).

---

## 4. model — 폼 / 로컬 상태 / 훅

**폼 스키마** (`model/form.ts`): `zod` 스키마 + `z.infer` 타입 + `getInitial...Values()` 초기값.

```ts
// model/form.ts
import { z } from 'zod';

export const exampleSearchSchema = z.object({
	keyword: z.string().nullable(),
	categoryCode: z.string().nullable(),
});

export type ExampleSearchValues = z.infer<typeof exampleSearchSchema>;

export const getInitialExampleSearchValues = (): ExampleSearchValues => ({
	keyword: null,
	categoryCode: null,
});
```

> 폼 피처는 `zod` + `@mantine/form` + `mantine-form-zod-resolver` 를 사용합니다(베이스에 설치됨).
> 폼이 없는 단순 피처는 `model/` 을 생략합니다.

폼 인스턴스는 **부모(widget/page)** 가 만들어 피처에 `form` 으로 내려줍니다. zod 스키마는 `zodResolver` 로 연결합니다.

```ts
// 부모(widget/page) — 폼 생성 + 검증 연결
import { useForm } from '@mantine/form';
import { zodResolver } from 'mantine-form-zod-resolver';

import { exampleSearchSchema, getInitialExampleSearchValues, type ExampleSearchValues } from '@/features/example-search';

const form = useForm<ExampleSearchValues>({
	initialValues: getInitialExampleSearchValues(),
	validate: zodResolver(exampleSearchSchema),
});
// → <ExampleSearch form={form} onSubmit={() => { /* form.values 로 entity 훅 호출 */ }} />
```

**로컬 상태** (`model/<feature>.store.ts`): 피처에 국한된 Zustand 스토어(plain `create`).

```ts
// model/example-edit.store.ts
import { create } from 'zustand';

type ExampleEditState = {
	editingId: number | null;
	startEdit: (id: number) => void;
	stopEdit: () => void;
};

export const useExampleEditStore = create<ExampleEditState>((set) => ({
	editingId: null,
	startEdit: (editingId) => set({ editingId }),
	stopEdit: () => set({ editingId: null }),
}));
```

> 폼 타입은 `form.ts` 의 `z.infer` 로 충분하지만, 그 외 피처 전용 타입(뷰모델·props 계약 등)은
> `model/<feature>.types.ts` 에 둡니다.

---

## 5. Public API 규약 (배럴)

`index.ts` 로 **컴포넌트(ui) + 폼 헬퍼·타입(model)** 만 노출합니다. 세그먼트 내부 파일 직접 import 금지.

```ts
// index.ts
export { ExampleSearch } from './ui';
export { exampleSearchSchema, getInitialExampleSearchValues, type ExampleSearchValues } from './model/form';
```

```ts
// ✅ 올바른 사용
import { ExampleSearch } from '@/features/example-search';

// ❌ 금지 — 세그먼트 직접 접근
import { ExampleSearch } from '@/features/example-search/ui/example-search';
```

---

## 6. Import 규칙

```
shared(0) < entities(1) < features(2) < widgets(3) < pages(4) < app(5)
```

`features` 에서는 `@/shared/` 와 `@/entities/` import 만 허용됩니다. `@/widgets/`, `@/pages/`, `@/app/`
import 는 **금지**되며, 위반 시 `node scripts/check-arch.js` 가 오류를 반환합니다.

---

## 7. 네이밍

- **파일·폴더**: `kebab-case` — `example-search.tsx`, `example-search.module.css`, `form.ts`(또는 `<feature>.form.ts`), `<feature>.types.ts`, `<feature>.store.ts`, `use-<feature>.ts`
- **컴포넌트**: `PascalCase` (예: `ExampleSearch`)
- **훅·함수**: `camelCase` (예: `useExampleEditStore`, `getInitialExampleSearchValues`)
- **타입**: `PascalCase`
- `interface`·`React.FC`·`export default` 금지(`naming.md`).
