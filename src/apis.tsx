import {invoke, type InvokeArgs} from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

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

export class StreamAPI {
    /**
     * 流式调用（保持 ResultAPI 风格）
     * @param apiName Tauri 命令名
     * @param params 请求参数（必须是 JSON 字符串）
     * @param onChunk 收到数据块的回调
     * @returns Promise<Result> 最终结果
     */
    static async invoke<TChunk = [string, string], E = string>(
        apiName: string,
        params: { body: string },  // 强制要求 body 为 JSON 字符串
        onChunk: (chunk: TChunk) => void
    ): Promise<Result<void, E>> {
        try {
            // 1. 必须先设置监听器（在 invoke 之前）
            const unlistenChunk = await listen<TChunk>('ai-chunk', (event) => {
                onChunk(event.payload);
            });

            const unlistenDone = await listen<string>('ai-done', () => {
                console.log(`${apiName} 调用完成`);
            });

            // 2. 调用 Rust 函数（启动流式任务）
            await invoke(apiName, params);

            // 3. 清理监听器
            unlistenChunk();
            unlistenDone();

            return ResultAPI.success(undefined); // 流式没有最终数据，返回 void
        } catch (error) {
            return ResultAPI.failure(error as E);
        }
    }
}

export const api = {
    testCommand: () => ResultAPI.invoke<string>('test_command'),
    showWindow: () => ResultAPI.invoke<void>('show_main_window'),
    getAIResponse: (requestBody: {
        code: number;
        body: {
            model: string;
            messages: Array<{ role: string; content: string }>;
            stream: boolean;
        };
    }, onChunk: (chunk: string) => void) => {
        // 自动把对象序列化为 JSON 字符串
        return StreamAPI.invoke(
            'get_ai_response',
            { body: JSON.stringify(requestBody) },
            onChunk
        );
    }
} as const