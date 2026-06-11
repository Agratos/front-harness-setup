# app 레이어

`app` 은 FSD 최상위 레이어입니다. 애플리케이션 진입점, 전역 프로바이더(테마·쿼리·라우터), 전역 스타일,
공통 레이아웃을 관리하며, 도메인 로직 없이 하위 레이어를 조립해 앱을 부트스트랩합니다.

> 이 파일이 app 레이어의 **단일 문서**입니다 — 규약과 현재 구현 상태를 함께 담습니다.
> `src/app/` 안에는 인라인 `.md` 를 두지 않습니다(문서는 `docs/` 로 단일화).

---

## 1. 허용 세그먼트

| 세그먼트         | 내용                                                                            |
| ---------------- | ------------------------------------------------------------------------------- |
| `App.tsx` (루트) | 최상위 App Shell — `providers/` 합성 루트를 렌더링                              |
| `providers/`     | 전역 Provider. 하위: `mantine/`(UI·테마), `react-query/`(쿼리), `react-router/`(Router·routes) |
| `layout/`        | 앱 공통 레이아웃 (`RootLayout`; 확장 시 Mantine `AppShell`)                     |
| `config/`        | 앱 레벨 상수 (선택)                                                             |

---

## 2. 현재 구현 상태 (최소 동작 골격)

지금은 **빌드·렌더가 보장되는 최소 골격**입니다.

- `providers/` 3종(mantine·react-query·react-router)이 배선되어 동작합니다.
- `layout/root-layout.tsx` 가 핵심 heading(`harness-setup`) + 라우트 `<Outlet />` 를 렌더합니다.
- 마운트 순서: `main.tsx` → `App` → `Providers`(Mantine > ReactQuery > Router) → `routes` → `RootLayout`.

> Mantine 의존성은 `@mantine/core`, `@mantine/hooks` (최소). 테마/모달/노티는 미구성(확장 지점).

```
src/app/
├─ App.tsx                 # 최상위 App Shell — <Providers /> 렌더링
├─ index.ts                # public API 배럴 (export { App })
├─ providers/
│  ├─ index.tsx            # Providers — 합성 순서: Mantine > ReactQuery > Router
│  ├─ mantine/             # MantineProvider (UI·테마·전역 CSS)
│  ├─ react-query/         # QueryClientProvider (@/shared/lib/react-query 의 queryClient)
│  └─ react-router/
│     ├─ index.tsx         # createBrowserRouter + RouterProvider
│     └─ routes/           # 라우트 정의 (RouteObject[])
└─ layout/
   ├─ root-layout.tsx      # 최소 셸 (heading + <Outlet />)
   └─ index.ts
```

---

## 3. Provider 합성 구조 (providers/)

`providers/index.tsx` 의 `Providers` 가 세 Provider 를 **중첩 합성**합니다.
순서는 default-setup 을 계승해 **Mantine > ReactQuery > Router**(바깥 → 안쪽)입니다.

```tsx
// providers/index.tsx
<MantineProviderWrapper>      // UI·테마 컨텍스트 (가장 바깥)
  <ReactQueryProvider>        // 데이터 패칭 컨텍스트
    <RouterProviderWrapper /> // 라우팅 — 화면을 그리는 가장 안쪽
  </ReactQueryProvider>
</MantineProviderWrapper>
```

> 순서 근거: 라우트가 렌더하는 화면이 Mantine 컴포넌트·쿼리 훅을 사용하므로, UI/쿼리 컨텍스트가
> 라우터보다 바깥에 있어야 합니다.

### 3.1 mantine/ — UI·테마 Provider

현재는 빈 `<MantineProvider>` 로 children 을 감싸고 전역 스타일 `@mantine/core/styles.css` 만
import 하는 최소 골격입니다.

```tsx
// providers/mantine/index.tsx (현재)
import { MantineProvider } from '@mantine/core';
import '@mantine/core/styles.css';

export const MantineProviderWrapper = ({ children }: Props) => <MantineProvider>{children}</MantineProvider>;
```

확장 시 이 폴더 안에 세그먼트를 둡니다(상세는 §5):

```
providers/mantine/
├─ index.tsx     # MantineProviderWrapper — theme 주입 + ModalsProvider/Notifications 합성
├─ theme/        # light/dark 테마, cssVariablesResolver (확장 시)
├─ css/          # global.css 등 전역 CSS (확장 시)
└─ lib/          # 테마 관련 헬퍼 (확장 시)
```

### 3.2 react-router/ — 라우팅 Provider

`index.tsx` 가 `createBrowserRouter(routes)` 로 라우터를 만들고 `RouterProvider` 로 제공합니다.
**라우트 정의는 `routes/` 로 분리**되어 있어, 화면이 늘어도 `index.tsx` 는 그대로 둡니다.

```
providers/react-router/
├─ index.tsx       # createBrowserRouter(routes) + <RouterProvider>
└─ routes/
   └─ index.tsx    # routes: RouteObject[] — 라우트 트리 정의
```

```tsx
// providers/react-router/routes/index.tsx (현재 — 최소 골격)
export const routes: RouteObject[] = [
  { path: '/', element: <RootLayout /> }, // 최상위에 RootLayout 마운트
];
```

확장 시 `routes/` 를 default-setup 형태로 분리합니다:

```
routes/
├─ index.tsx            # 라우트 합성 (public + protected)
├─ public-routes.tsx    # 비인증 라우트
└─ protected-routes.tsx # 인증 라우트 (ProtectedRoute 래핑) + errorElement
```

- 최상위 route 의 `element` = `<RootLayout />`, `errorElement` = `RouteErrorElement`(확장 시).
- 새 페이지는 `@/pages/<name>` 슬라이스를 만들어 이 `routes` 트리에 등록합니다.

---

## 4. layout/ — RootLayout 과 AppShell 확장

### 현재 (최소 골격)

`root-layout.tsx` 가 핵심 heading + 라우트 `<Outlet />` 만 렌더합니다.
eval 루브릭(`ui.heading`, `fn.app-mounts`) 통과용입니다.

```tsx
// layout/root-layout.tsx (현재)
export const RootLayout = () => (
  <>
    <Title order={1}>harness-setup</Title>
    <Outlet />
  </>
);
```

### 목표 (default-setup 계승 — 확장 시)

실제 화면이 붙기 시작하면 `RootLayout` 을 Mantine `AppShell` 셸로 확장합니다.

```tsx
// 목표: AppShell 셸 (Header + SideNavigation + Outlet)
import { AppShell } from '@mantine/core';

import { useIsMenuVisible } from '@/features/visibility-toggle'; // 확장 시 생성
import { Header } from '@/widgets/header'; // 확장 시 생성
import { SideNavigation } from '@/widgets/side-navigation'; // 확장 시 생성

export const RootLayout = () => {
  const isMenuVisible = useIsMenuVisible();
  return (
    <AppShell
      header={{ height: 99 }}
      navbar={{ width: 240, breakpoint: 'sm', collapsed: { desktop: !isMenuVisible, mobile: !isMenuVisible } }}
      padding="md"
    >
      <AppShell.Header><Header /></AppShell.Header>
      <AppShell.Navbar><SideNavigation /></AppShell.Navbar>
      <AppShell.Main><Outlet /></AppShell.Main>
    </AppShell>
  );
};
```

확장 시 만들 슬라이스 (아직 미생성):

| 의존        | 만들 위치                         | 작성 규약                    |
| ----------- | --------------------------------- | ---------------------------- |
| Header      | `src/widgets/header/`             | [widgets.md](./widgets.md)   |
| 사이드 내비 | `src/widgets/side-navigation/`    | [widgets.md](./widgets.md)   |
| 메뉴 토글   | `src/features/visibility-toggle/` | [features.md](./features.md) |

> 라우트 분리(public/protected/errorElement)는 §3.2 를 따릅니다.

---

## 5. mantine 확장 상세 (개발 시)

default-setup 의 mantine provider 형태로 확장할 수 있습니다.

- `theme/` — light/dark 테마, `cssVariablesResolver`
- `ModalsProvider` (`@mantine/modals`), `Notifications` (`@mantine/notifications`)
- `css/global.css` — 전역 CSS
- 추가 의존: `@mantine/modals`, `@mantine/notifications`, `@mantine/dates` 등 (필요 시 설치)

---

## 6. Public API 규약

- `src/app/index.ts` 배럴로 `App` 컴포넌트를 노출합니다.
- `src/main.tsx` 에서 `@/app` 을 import 해 React 트리를 마운트합니다.

```ts
// main.tsx
import { App } from '@/app';
```

---

## 7. Import 규칙

```
shared(0) < entities(1) < features(2) < widgets(3) < pages(4) < app(5)
```

`app` 은 최상위 레이어이므로 **모든 하위 레이어**를 import 할 수 있습니다.
다만 도메인 로직은 하위 레이어에 위임하고 `app` 은 조립만 담당합니다.

---

## 8. 네이밍

- **파일·폴더**: `kebab-case` (예: `root-layout.tsx`). 단 React 루트 컴포넌트 파일은 관례상 `App.tsx`.
- **컴포넌트**: `PascalCase` (예: `App`, `RootLayout`)
- **훅·함수**: `camelCase`
- **타입**: `PascalCase`
- named export 만 사용하고 `export default` 는 쓰지 않습니다(`naming.md` 참고).
