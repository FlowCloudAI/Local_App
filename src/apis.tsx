import {invoke, type InvokeArgs} from '@tauri-apps/api/core';

export type Result<T, E = string> =
    | { success: true; data: T }
    | { success: false; error: E };  // 失败时用 error 字段

export class ResultAPI {
    static success<T>(data: T): Result<T, never> {
        return { success: true, data };
    }

    static failure<E>(error: E): Result<never, E> {
        return { success: false, error };
    }

    static async invoke<T, E = string>(
        apiName: string,
        params?: InvokeArgs | undefined
    ): Promise<Result<T, E>> {
        try {
            const data = await invoke<T>(apiName, params);
            return ResultAPI.success(data);
        } catch (error) {
            return ResultAPI.failure(error as E);
        }
    }
}

export const api = {
    testCommand: () => ResultAPI.invoke<string>('test_command'),
    showWindow: () => ResultAPI.invoke<void>('show_main_window'),
} as const