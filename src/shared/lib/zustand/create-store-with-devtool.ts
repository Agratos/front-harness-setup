/* eslint-disable @typescript-eslint/no-explicit-any */
import type { StateCreator } from 'zustand';
import { createJSONStorage, devtools, persist } from 'zustand/middleware';

type Partialize<T> = ((state: T) => Partial<T>) | readonly (keyof T)[];

type CreateStoreOpts<T> = {
	persist?: boolean;
	storage?: 'session' | 'local' | Storage;
	partialize?: Partialize<T>;
	devtools?: boolean;
	key?: string;
};

function normalizePartialize<T>(p?: Partialize<T>): ((s: T) => Partial<T>) | undefined {
	if (!p) return undefined;
	if (typeof p === 'function') return p;
	if (Array.isArray(p)) {
		return (s: T) =>
			p.reduce((acc, k) => {
				(acc as any)[k] = (s as any)[k];
				return acc;
			}, {} as Partial<T>);
	}
	return undefined;
}

/**
 * Zustand 스토어 생성 헬퍼.
 * - devtools(액션 이름 라벨링) + (선택)persist(session/local) 미들웨어를 일관되게 적용합니다.
 * - set(partial, actionName) 으로 액션 이름을 붙이면 devtools 타임라인에 `<store>/<action>` 으로 표시됩니다.
 */
export function createStoreWithDevtool<T extends Record<string, any>>(
	stateWithActions: (
		set: (partial: Partial<T> | ((state: T) => Partial<T>), name?: string, replace?: boolean) => void,
	) => T,
	storeName: string,
	options?: CreateStoreOpts<T>,
): StateCreator<T, [], []> {
	const creator: StateCreator<T, [], []> = ((set) => {
		const internalSet = set as unknown as (
			partial: Partial<T> | ((state: T) => Partial<T>),
			replace?: boolean,
			actionName?: string,
		) => void;

		const enhancedSet = (
			partial: Partial<T> | ((state: T) => Partial<T>),
			actionName?: string,
			replace = false,
		) => {
			const actionLabel =
				(options?.devtools ?? import.meta.env.DEV) && actionName ? `${storeName}/${actionName}` : undefined;

			if (typeof partial === 'function') {
				internalSet((state) => (partial as (state: T) => Partial<T>)(state), replace, actionLabel);
			} else {
				internalSet(partial, replace, actionLabel);
			}
		};

		return stateWithActions(enhancedSet);
	}) as StateCreator<T, [], []>;

	const shouldPersist = options?.persist ?? false;
	const shouldPartialize = normalizePartialize(options?.partialize);

	const storageFactory = () => {
		const s = options?.storage;
		if (s === 'local') return localStorage;
		if (s === 'session' || s == null) return sessionStorage;
		return s as Storage;
	};

	const base = shouldPersist
		? persist(creator, {
				name: options?.key ?? storeName,
				storage: createJSONStorage(storageFactory),
				...(shouldPartialize && { partialize: shouldPartialize }),
			})
		: creator;

	const useDevtools = options?.devtools ?? import.meta.env.DEV;
	const wrapped = useDevtools ? devtools(base as any, { name: storeName }) : base;

	return wrapped as StateCreator<T, [], []>;
}
