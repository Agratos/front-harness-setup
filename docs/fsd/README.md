# FSD 문서 인덱스

이 디렉터리는 harness-setup 프로젝트의 **Feature-Sliced Design(FSD)** 아키텍처 규약을 담습니다.

---

## 레이어 순서 다이어그램

의존 방향은 **위 → 아래** 단방향입니다. 하위 레이어는 상위 레이어를 import 할 수 없습니다.

```
┌─────────────────────────────────────┐
│               app  (5)              │  ← 진입점, 전역 프로바이더, 라우터
├─────────────────────────────────────┤
│              pages  (4)             │  ← 라우트 단위 화면
├─────────────────────────────────────┤
│             widgets  (3)            │  ← 독립적인 UI 블록
├─────────────────────────────────────┤
│            features  (2)            │  ← 사용자 인터랙션 단위 UI
├─────────────────────────────────────┤
│            entities  (1)            │  ← 도메인 타입 · 상태 · API
├─────────────────────────────────────┤
│             shared  (0)             │  ← 범용 유틸 · UI · 설정
└─────────────────────────────────────┘

의존 방향:  app → pages → widgets → features → entities → shared
```

숫자가 낮을수록 하위 레이어입니다. 각 레이어는 자신보다 **낮은 번호의 레이어만** import 할 수 있습니다.

---

## 문서 목록

| 문서                         | 설명                                                             |
| ---------------------------- | ---------------------------------------------------------------- |
| [shared.md](./shared.md)     | shared 레이어 — 범용 유틸, UI, 설정                              |
| [entities.md](./entities.md) | entities 레이어 — 도메인 타입·상태·API, 서버 모델 생성 절차 포함 |
| [features.md](./features.md) | features 레이어 — 사용자 인터랙션 단위 UI                        |
| [widgets.md](./widgets.md)   | widgets 레이어 — 독립적인 UI 블록                                |
| [pages.md](./pages.md)       | pages 레이어 — 라우트 단위 화면                                  |
| [app.md](./app.md)           | app 레이어 — 진입점, 전역 프로바이더                             |
| [naming.md](./naming.md)     | 파일·심볼 네이밍, 배럴 규약, 슬라이스 폴더 구조 종합             |

---

## 작성 모델 — 실재 예시 + 문서 템플릿

`src/` 에는 **컴파일·테스트·게이트를 통과하는 실재 예시 슬라이스**가 시드되어 있습니다
(사양서 확정 4: 예시는 실제 코드로 존재):

| 레이어 | 실재 예시 | 보여주는 것 |
| --- | --- | --- |
| entities | [`src/entities/example/`](../../src/entities/example/) | DTO↔Mapper↔Types + query/mutation 3종 + mapper 단위 테스트 |
| features | [`src/features/example-list/`](../../src/features/example-list/) | 엔티티 공개 훅 소비 (DTO 무지) |
| pages | [`src/pages/home/`](../../src/pages/home/) | feature 조립 (로직 없음) |

- 새 슬라이스는 **실재 예시의 구조를 그대로 복제**한 뒤 실제 도메인 이름으로 바꿔 작성합니다.
- 레이어 문서의 코드 스니펫은 보조 템플릿입니다 — 실재 예시와 문서가 어긋나면 **실재 예시가 우선**이고,
  문서를 같은 커밋에서 고칩니다 (사양서 "재발 방지 규칙 1").
- 표준 작성 절차는 [entities.md](./entities.md) §6 (서버 API → 엔티티 7단계) 입니다.

---

## 아키텍처 게이트

아래 두 도구가 레이어 규칙을 **자동으로 강제**합니다. CI 및 로컬 개발 모두에서 통과해야 합니다.

### check-arch.js

```bash
node scripts/check-arch.js
```

`src/**/*.{ts,tsx}` 를 스캔해 상위 레이어 import 위반을 검출합니다.  
예: `shared` 파일이 `@/features/...` 를 import 하면 `FSD_LAYER_IMPORT` 오류가 발생합니다.

### eslint simple-import-sort

`eslint.config.js` 의 `simple-import-sort/imports` 규칙이 import 그룹 순서를 강제합니다.

```
1. node: 내장 모듈
2. react, 외부 패키지
3. @/shared/
4. @/entities/
5. @/features/
6. @/widgets/
7. @/pages/
8. @/  (기타 앱 내부)
9. 상대 경로 (../)
10. 상대 경로 (./)
11. CSS / 이미지
```

import 순서가 위 그룹을 따르지 않으면 `yarn lint` 가 오류를 반환합니다.

---

## 빠른 시작

새 슬라이스를 추가할 때는 해당 레이어 문서를 먼저 읽고, 아래 게이트를 모두 통과시킨 뒤 PR 을 올립니다.

```bash
yarn typecheck          # TypeScript 타입 검사
yarn lint               # ESLint (import 순서 포함)
node scripts/check-arch.js  # FSD 레이어 경계 검사
yarn test:run           # 단위 테스트 (테스트 0개면 통과 — passWithNoTests)
```
