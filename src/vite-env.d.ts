/// <reference types="vite/client" />
/// <reference types="vite-plugin-svgr/client" />

// 커스텀 환경 변수 타입 보강 (shared/lib/api/axios-api 의 baseURL 등).
interface ImportMetaEnv {
	readonly VITE_URL_PATH?: string;
}
