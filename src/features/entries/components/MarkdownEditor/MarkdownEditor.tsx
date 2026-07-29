/**
 * 词条正文 Markdown 编辑器；统一桌面端与移动端的编辑、预览、自动高度和双链高亮行为。
 */
import React, {forwardRef, useCallback, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState,} from "react";
import "./MarkdownEditor.css";
import type {ICommand, MDEditorProps, RefMDEditor} from "@uiw/react-md-editor";
import MDEditor, {commands} from "@uiw/react-md-editor";
import {refractor} from "refractor/all";
import {useOptionalTheme} from "flowcloudai-ui";
import {registerWikiLinkSyntax} from "./markdownSyntax";

registerWikiLinkSyntax(refractor);

export type MarkdownPreviewOptions = MDEditorProps["previewOptions"];
export type MarkdownPreviewRenderer = NonNullable<MDEditorProps["components"]>["preview"];
type MarkdownEditorChangeEvent = Parameters<NonNullable<MDEditorProps["onChange"]>>[1];
export interface MarkdownEditorValueChangeMeta {
    source: "input";
    event: MarkdownEditorChangeEvent;
}
export interface MarkdownEditorSearchHighlights {
    matches: ReadonlyArray<{start: number; end: number}>;
    activeIndex: number;
}
export type MarkdownEditorValueChangeHandler = (
    nextValue: string,
    meta?: MarkdownEditorValueChangeMeta,
) => void;

export interface MarkdownEditorTokens {
    background?: string;
    toolbarBackground?: string;
    borderColor?: string;
    textColor?: string;
    mutedTextColor?: string;
    toolbarButtonHoverBackground?: string;
    toolbarButtonHoverColor?: string;
    primaryColor?: string;
    primaryBackground?: string;
    editorTextBackground?: string;
    previewBackground?: string;
    fontSizeScale?: number;
    codeInlineBackground?: string;
    codeBlockBackground?: string;
    blockquoteBorderColor?: string;
    selectionBackground?: string;
}

export interface MarkdownEditorRef {
    /** 获取底层 @uiw/react-md-editor 的 ref 实例 */
    getEditorInstance: () => RefMDEditor | null;
    /** 获取内部 textarea DOM 节点 */
    getTextareaElement: () => HTMLTextAreaElement | null;
    /** 由外部工具栏复用底层 Markdown 命令。 */
    executeCommand: (command: ICommand) => void;
}

export interface MarkdownEditorProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "onChange" | "onFocus" | "onBlur" | "onKeyDown"> {
    value:        string;
    onValueChange?: MarkdownEditorValueChangeHandler;
    minHeight?:   number;
    height?:      number | string;
    maxHeight?:   number;
    autoHeight?:  boolean;
    placeholder?: string;
    disabled?:    boolean;
    /** 透传到底层 textarea，用于监听键盘、输入、光标等事件 */
    textareaProps?: MDEditorProps["textareaProps"];
    onFocus?: MDEditorProps["textareaProps"] extends infer T
        ? T extends { onFocus?: infer F }
            ? F
            : never
        : never;
    onBlur?: MDEditorProps["textareaProps"] extends infer T
        ? T extends { onBlur?: infer F }
            ? F
            : never
        : never;
    /**
     * 显示模式
     * - edit:    编辑模式（工具栏含双栏切换按钮）
     * - preview: 纯预览，只读渲染 Markdown，隐藏工具栏
     * @default 'edit'
     */
    mode?: 'edit' | 'preview';
    /** 透传到内部 textarea 的 onKeyDown，可用于拦截 Ctrl+Z 等快捷键 */
    onKeyDown?: React.KeyboardEventHandler<HTMLTextAreaElement>;
    showSplitToggle?: boolean;
    defaultSplitView?: boolean;
    splitView?: boolean;
    onSplitChange?: (split: boolean) => void;
    toolbarCommands?: ICommand[];
    extraCommands?: ICommand[];
    hideToolbar?: boolean;
    hideFullscreen?: boolean;
    previewOptions?: MarkdownPreviewOptions;
    previewRender?: MarkdownPreviewRenderer;
    tokens?: Partial<MarkdownEditorTokens>;
    /** 在编辑层高亮正文查找结果。 */
    searchHighlights?: MarkdownEditorSearchHighlights;
}

function withTitle(cmd: ICommand, title: string): ICommand {
    return { ...cmd, buttonProps: { ...(cmd.buttonProps ?? {}), title } };
}

/** 精简工具栏：只保留常用排版命令 */
const TOOLBAR_COMMANDS: ICommand[] = [
    withTitle(commands.bold,                 '加粗'),
    withTitle(commands.italic,               '斜体'),
    withTitle(commands.strikethrough,        '删除线'),
    commands.divider,
    withTitle(commands.heading1, '一级标题'),
    withTitle(commands.heading2, '二级标题'),
    withTitle(commands.heading3, '三级标题'),
    commands.divider,
    withTitle(commands.quote,                '引用'),
    withTitle(commands.code,                 '行内代码'),
    withTitle(commands.codeBlock,            '代码块'),
    commands.divider,
    withTitle(commands.link,                 '链接'),
    withTitle(commands.unorderedListCommand, '无序列表'),
    withTitle(commands.orderedListCommand,   '有序列表'),
    withTitle(commands.hr,                   '分割线'),
];

export const MarkdownEditor = forwardRef<MarkdownEditorRef, MarkdownEditorProps>(function MarkdownEditor(_ref, ref) {
    const {
        value,
        onValueChange,
        minHeight = 200,
        height,
        maxHeight,
        autoHeight = true,
        placeholder = "在此输入内容...",
        disabled,
        className,
        style,
        textareaProps,
        onFocus,
        onBlur,
        onKeyDown,
        mode = "edit",
        showSplitToggle = true,
        defaultSplitView = false,
        splitView,
        onSplitChange,
        toolbarCommands,
        extraCommands,
        hideToolbar = false,
        hideFullscreen = false,
        previewOptions,
        previewRender,
        tokens,
        searchHighlights,
        ...props
    } = _ref;
    const resolvedTheme = useOptionalTheme()?.resolvedTheme ?? "light";
    const editorRef = useRef<RefMDEditor>(null);

    useImperativeHandle(ref, () => ({
        getEditorInstance: () => editorRef.current,
        getTextareaElement: () =>
            wrapRef.current?.querySelector<HTMLTextAreaElement>('.w-md-editor-text-input') ?? null,
        executeCommand: (command) => {
            editorRef.current?.commandOrchestrator?.executeCommand(command);
            editorRef.current?.textarea?.focus();
        },
    }), []);

    // 稳定的 change 包装 — MDEditor 每次渲染不会看到新的函数引用
    const onValueChangeRef = useRef(onValueChange);
    onValueChangeRef.current = onValueChange;
    const handleChange = useCallback<NonNullable<MDEditorProps["onChange"]>>((v, event) => {
        const nextValue = v ?? "";
        onValueChangeRef.current?.(nextValue, {source: "input", event});
    }, []);

    const [uncontrolledSplit, setUncontrolledSplit] = useState(defaultSplitView);
    const wrapRef = useRef<HTMLDivElement>(null);
    const [editorHeight, setEditorHeight] = useState(minHeight);
    const isSplitControlled = splitView !== undefined;
    const showSplit = isSplitControlled ? splitView : uncontrolledSplit;
    const isPreviewMode = mode === "preview";
    const hideInternalToolbar = isPreviewMode || hideToolbar;

    const setShowSplit = (next: boolean | ((prev: boolean) => boolean)) => {
        const nextValue = typeof next === "function" ? next(showSplit) : next;
        if (!isSplitControlled) setUncontrolledSplit(nextValue);
        onSplitChange?.(nextValue);
    };

    // --- CSS 变量注入 ---
    const overrideStyle = {
        ...style,
        "--md-bg": tokens?.background,
        "--md-toolbar-bg": tokens?.toolbarBackground,
        "--md-border": tokens?.borderColor,
        "--md-text": tokens?.textColor,
        "--md-text-muted": tokens?.mutedTextColor,
        "--md-toolbar-hover-bg": tokens?.toolbarButtonHoverBackground,
        "--md-toolbar-hover-color": tokens?.toolbarButtonHoverColor,
        "--md-primary": tokens?.primaryColor,
        "--md-primary-bg": tokens?.primaryBackground,
        "--md-editor-text-bg": tokens?.editorTextBackground,
        "--md-preview-bg": tokens?.previewBackground,
        "--md-font-size-scale": tokens?.fontSizeScale,
        "--md-code-inline-bg": tokens?.codeInlineBackground,
        "--md-code-block-bg": tokens?.codeBlockBackground,
        "--md-blockquote-border": tokens?.blockquoteBorderColor,
        "--md-selection-bg": tokens?.selectionBackground,
    } as React.CSSProperties;

    // --- 双栏切换按钮 ---
    const splitCommand: ICommand = {
        name:        "split-view",
        keyCommand:  "split-view",
        buttonProps: {
            "aria-label": showSplit ? "纯编辑" : "双栏预览",
            title:        showSplit ? "纯编辑" : "双栏预览",
            className:    `fc-md-split-btn${showSplit ? " fc-md-split-btn--active" : ""}`,
        },
        icon:    <span className="fc-md-split-icon">⊟</span>,
        execute: () => setShowSplit(p => !p),
    };

    const mergedExtraCommands: ICommand[] = [];
    if (showSplitToggle && mode === "edit") {
        mergedExtraCommands.push(splitCommand);
    }
    if (!hideFullscreen) {
        if (mergedExtraCommands.length > 0) mergedExtraCommands.push(commands.divider);
        mergedExtraCommands.push(withTitle(commands.fullscreen, "全屏"));
    }
    if (extraCommands?.length) {
        if (mergedExtraCommands.length > 0) mergedExtraCommands.push(commands.divider);
        mergedExtraCommands.push(...extraCommands);
    }

    // 实际传给 MDEditor 的 preview 值
    const editorPreview = isPreviewMode ? 'preview' : showSplit ? 'live' : 'edit';

    const mergedTextareaProps = useMemo<MDEditorProps["textareaProps"]>(() => ({
        ...textareaProps,
        placeholder,
        disabled,
        onFocus: event => {
            textareaProps?.onFocus?.(event);
            onFocus?.(event);
        },
        onBlur: event => {
            textareaProps?.onBlur?.(event);
            onBlur?.(event);
        },
        onKeyDown: event => {
            textareaProps?.onKeyDown?.(event);
            onKeyDown?.(event);
        },
    }), [textareaProps, placeholder, disabled, onFocus, onBlur, onKeyDown]);

    useLayoutEffect(() => {
        if (!autoHeight) {
            const baseHeight = height ?? minHeight;
            setEditorHeight(typeof baseHeight === "number" ? baseHeight : minHeight);
            return;
        }

        const root = wrapRef.current;
        if (!root) return;

        const getScrollHeight = (selector: string) =>
            root.querySelector<HTMLElement>(selector)?.scrollHeight ?? 0;

        const measure = () => {
            const toolbarHeight =
                hideInternalToolbar
                    ? 0
                    : root.querySelector<HTMLElement>('.w-md-editor-toolbar')?.getBoundingClientRect().height ?? 0;
            const editorText = root.querySelector<HTMLElement>('.w-md-editor-text');
            const textarea = root.querySelector<HTMLTextAreaElement>('.w-md-editor-text-input');
            const textPre = root.querySelector<HTMLElement>('.w-md-editor-text-pre');
            const textPreCode = root.querySelector<HTMLElement>('.w-md-editor-text-pre > code');
            const preview = root.querySelector<HTMLElement>('.w-md-editor-preview');
            const markdown = root.querySelector<HTMLElement>('.wmde-markdown');

            const getVerticalPadding = (node: HTMLElement | null) => {
                if (!node) return 0;
                const styles = window.getComputedStyle(node);
                return (parseFloat(styles.paddingTop) || 0) + (parseFloat(styles.paddingBottom) || 0);
            };

            const inputHeight = Math.max(
                textarea?.scrollHeight ?? 0,
                (textPre?.scrollHeight ?? 0) + getVerticalPadding(editorText),
                (textPreCode?.scrollHeight ?? 0) + getVerticalPadding(editorText),
            );
            const previewHeight = Math.max(
                (markdown?.scrollHeight ?? 0) + getVerticalPadding(preview),
                getScrollHeight('.wmde-markdown'),
            );

            const bodyHeight =
                isPreviewMode
                    ? previewHeight
                    : showSplit
                        ? Math.max(inputHeight, previewHeight)
                        : inputHeight;

            let nextHeight = Math.max(minHeight, Math.ceil(toolbarHeight + bodyHeight));
            if (typeof maxHeight === "number") {
                nextHeight = Math.min(nextHeight, maxHeight);
            }
            setEditorHeight(prev => (Math.abs(prev - nextHeight) > 1 ? nextHeight : prev));
        };

        const rafId = window.requestAnimationFrame(measure);
        const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);

        const toolbar = root.querySelector<HTMLElement>('.w-md-editor-toolbar');
        const inputArea = root.querySelector<HTMLElement>('.w-md-editor-area');
        const inputBody = root.querySelector<HTMLElement>('.w-md-editor-text');
        const textarea = root.querySelector<HTMLTextAreaElement>('.w-md-editor-text-input');
        const textPre = root.querySelector<HTMLElement>('.w-md-editor-text-pre');
        const textPreCode = root.querySelector<HTMLElement>('.w-md-editor-text-pre > code');
        const preview = root.querySelector<HTMLElement>('.w-md-editor-preview');
        const markdown = root.querySelector<HTMLElement>('.wmde-markdown');

        [toolbar, inputArea, inputBody, textarea, textPre, textPreCode, preview, markdown].forEach(node => {
            if (node && resizeObserver) resizeObserver.observe(node);
        });

        window.addEventListener('resize', measure);

        return () => {
            window.cancelAnimationFrame(rafId);
            resizeObserver?.disconnect();
            window.removeEventListener('resize', measure);
        };
    }, [autoHeight, value, hideInternalToolbar, isPreviewMode, showSplit, minHeight, maxHeight, height]);

    useLayoutEffect(() => {
        if (!searchHighlights?.matches.length || typeof Highlight === "undefined") return;
        const registry = CSS.highlights;
        const matchName = "fc-markdown-search-match";
        const activeName = "fc-markdown-search-active";
        const code = wrapRef.current?.querySelector<HTMLElement>(".w-md-editor-text-pre > code");
        if (!code) return;
        const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
        const nodes: Array<{node: Text; start: number; end: number}> = [];
        let offset = 0;
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const text = node as Text;
            nodes.push({node: text, start: offset, end: offset + text.data.length});
            offset += text.data.length;
        }

        const ranges = searchHighlights.matches.map((match) => {
            const start = nodes.find((item) => match.start >= item.start && match.start < item.end);
            const end = nodes.find((item) => match.end > item.start && match.end <= item.end);
            if (!start || !end) return null;
            const range = new Range();
            range.setStart(start.node, match.start - start.start);
            range.setEnd(end.node, match.end - end.start);
            return range;
        });
        const regular = ranges.filter((range, index): range is Range => (
            range !== null && index !== searchHighlights.activeIndex
        ));
        const active = ranges[searchHighlights.activeIndex];
        const regularHighlight = new Highlight(...regular);
        const activeHighlight = active ? new Highlight(active) : null;
        registry.set(matchName, regularHighlight);
        if (activeHighlight) registry.set(activeName, activeHighlight);

        return () => {
            if (registry.get(matchName) === regularHighlight) registry.delete(matchName);
            if (activeHighlight && registry.get(activeName) === activeHighlight) registry.delete(activeName);
        };
    }, [searchHighlights, value]);

    const editorHeightValue = autoHeight ? editorHeight : (height ?? minHeight);
    const editorCommands = toolbarCommands ?? TOOLBAR_COMMANDS;
    const editorComponents = previewRender ? { preview: previewRender } : undefined;

    return (
        <div
            {...props}
            ref={wrapRef}
            className={["fc-md-wrap", className].filter(Boolean).join(" ")}
            style={overrideStyle}
            data-color-mode={resolvedTheme}
            data-auto-height={autoHeight ? "true" : "false"}
            data-mode={mode}
        >
            <MDEditor
                ref={editorRef}
                value={value}
                onChange={handleChange}
                commands={editorCommands}
                extraCommands={mergedExtraCommands}
                height={editorHeightValue}
                preview={editorPreview}
                hideToolbar={hideInternalToolbar}
                visibleDragbar={false}
                textareaProps={mergedTextareaProps}
                previewOptions={previewOptions}
                components={editorComponents}
                className={disabled ? "fc-md-editor--disabled" : undefined}
            />
        </div>
    );
});
