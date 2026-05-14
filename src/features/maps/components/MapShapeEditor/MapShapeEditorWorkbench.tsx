import {type CSSProperties, useEffect, useState} from 'react';

import {Button, useContextMenu} from 'flowcloudai-ui';
import {defaultMapShapeEditorApi, submitMapShapeScene} from './api';
import {MapDeckPreview} from './MapDeckPreview';
import {
    MapShapeSvgEditor,
    type MapShapeSvgEditorLocationContextMenuDetail,
    type MapShapeSvgEditorShapeContextMenuDetail,
    type MapShapeSvgEditorVertexContextMenuDetail,
} from './MapShapeSvgEditor';
import {
    buildDefaultLocationName,
    cloneMapShapeEditorDraft,
    createEmptyShapeDraft,
    createInitialMapShapeEditorViewBox,
    createMapShapeEditorLocalId,
    getShapeCenter,
    moveShapeInOrder,
} from './mapShapeEditorSvgUtils';
import {validateMapEditorDraft} from './validation';
import type {
    MapEditorCanvas,
    MapKeyLocationDraft,
    MapPreviewScene,
    MapShapeDraft,
    MapShapeEditorApi,
    MapShapeEditorDraft,
    MapShapeEditorViewBox,
} from './types';
import './MapShapeEditor.css';

const DEFAULT_CANVAS: MapEditorCanvas = {
    width: 1000,
    height: 640,
};

type SubmissionStatus = 'idle' | 'frontend_error' | 'saving' | 'backend_error' | 'success';

interface SubmissionState {
    status: SubmissionStatus;
    message: string;
}

export interface MapShapeEditorWorkbenchProps {
    initialDraft: MapShapeEditorDraft;
    initialPreview?: MapPreviewScene | null;
    api?: MapShapeEditorApi;
    canvas?: MapEditorCanvas;
    width?: string | number;
    height?: string | number;
    className?: string;
    style?: CSSProperties;
}

function buildFrontendValidationMessage(issueCount: number): string {
    return issueCount === 0
        ? '前端校验已通过，可以提交。'
        : `前端校验未通过，共 ${issueCount} 项异常。`;
}

function formatCoordinate(value: number): string {
    return value.toFixed(1);
}

export function MapShapeEditorWorkbench({
                                            initialDraft,
                                            initialPreview = null,
                                            api = defaultMapShapeEditorApi,
                                            canvas = DEFAULT_CANVAS,
                                            width = '100%',
                                            height = 'auto',
                                            className,
                                            style,
                                        }: MapShapeEditorWorkbenchProps) {
    const {showContextMenu} = useContextMenu();
    const [draft, setDraft] = useState<MapShapeEditorDraft>(() => cloneMapShapeEditorDraft(initialDraft));
    const [preview, setPreview] = useState<MapPreviewScene | null>(initialPreview);
    const [selectedShapeId, setSelectedShapeId] = useState<string | null>(initialDraft.shapes[0]?.id ?? null);
    const [selectedLocationId, setSelectedLocationId] = useState<string | null>(initialDraft.keyLocations[0]?.id ?? null);
    const [drawingShape, setDrawingShape] = useState<MapShapeDraft | null>(null);
    const [viewBox, setViewBox] = useState<MapShapeEditorViewBox>(() => createInitialMapShapeEditorViewBox(canvas));
    const [submissionState, setSubmissionState] = useState<SubmissionState>({
        status: 'idle',
        message: '尚未提交到后端。',
    });

    useEffect(() => {
        const nextDraft = cloneMapShapeEditorDraft(initialDraft);
        setDraft(nextDraft);
        setSelectedShapeId(nextDraft.shapes[0]?.id ?? null);
        setSelectedLocationId(nextDraft.keyLocations[0]?.id ?? null);
    }, [initialDraft]);

    useEffect(() => {
        setPreview(initialPreview);
    }, [initialPreview]);

    useEffect(() => {
        setViewBox(createInitialMapShapeEditorViewBox(canvas));
    }, [canvas.height, canvas.width]);

    const validationResult = validateMapEditorDraft(draft, {
        hasDrawingShapeInProgress: Boolean(drawingShape),
    });
    const invalidShapeIds = validationResult.shapeResults.filter(result => !result.isValid).map(result => result.shapeId);
    const invalidKeyLocationIds = validationResult.keyLocationResults
        .filter(result => !result.isValid)
        .map(result => result.keyLocationId);

    const selectedShape = draft.shapes.find(shape => shape.id === selectedShapeId) ?? null;
    const selectedLocation = draft.keyLocations.find(location => location.id === selectedLocationId) ?? null;
    const selectedShapeIssues = validationResult.shapeResults.find(result => result.shapeId === selectedShapeId)?.issues ?? [];
    const selectedLocationIssues = validationResult.keyLocationResults.find(result => result.keyLocationId === selectedLocationId)?.issues ?? [];

    const deleteShape = (shapeId: string) => {
        setDraft(currentDraft => ({
            shapes: currentDraft.shapes.filter(shape => shape.id !== shapeId),
            keyLocations: currentDraft.keyLocations.filter(location => location.shapeId !== shapeId),
        }));
        setSelectedShapeId(current => (current === shapeId ? null : current));
        setSelectedLocationId(current => {
            const location = draft.keyLocations.find(item => item.id === current);
            return location?.shapeId === shapeId ? null : current;
        });
    };

    const deleteVertex = (shapeId: string, vertexId: string) => {
        setDraft(currentDraft => ({
            ...currentDraft,
            shapes: currentDraft.shapes.map(shape => (
                shape.id === shapeId
                    ? {...shape, vertices: shape.vertices.filter(vertex => vertex.id !== vertexId)}
                    : shape
            )),
        }));
    };

    const deleteLocation = (locationId: string) => {
        setDraft(currentDraft => ({
            ...currentDraft,
            keyLocations: currentDraft.keyLocations.filter(location => location.id !== locationId),
        }));
        setSelectedLocationId(current => (current === locationId ? null : current));
    };

    const moveShapeBackward = (shapeId: string) => {
        setDraft(currentDraft => {
            const currentIndex = currentDraft.shapes.findIndex(shape => shape.id === shapeId);
            if (currentIndex <= 0) return currentDraft;

            return {
                ...currentDraft,
                shapes: moveShapeInOrder(currentDraft.shapes, shapeId, currentIndex - 1),
            };
        });
    };

    const moveShapeForward = (shapeId: string) => {
        setDraft(currentDraft => {
            const currentIndex = currentDraft.shapes.findIndex(shape => shape.id === shapeId);
            if (currentIndex === -1 || currentIndex >= currentDraft.shapes.length - 1) return currentDraft;

            return {
                ...currentDraft,
                shapes: moveShapeInOrder(currentDraft.shapes, shapeId, currentIndex + 1),
            };
        });
    };

    const moveShapeToBack = (shapeId: string) => {
        setDraft(currentDraft => {
            const currentIndex = currentDraft.shapes.findIndex(shape => shape.id === shapeId);
            if (currentIndex <= 0) return currentDraft;

            return {
                ...currentDraft,
                shapes: moveShapeInOrder(currentDraft.shapes, shapeId, 0),
            };
        });
    };

    const moveShapeToFront = (shapeId: string) => {
        setDraft(currentDraft => {
            const currentIndex = currentDraft.shapes.findIndex(shape => shape.id === shapeId);
            if (currentIndex === -1 || currentIndex >= currentDraft.shapes.length - 1) return currentDraft;

            return {
                ...currentDraft,
                shapes: moveShapeInOrder(currentDraft.shapes, shapeId, currentDraft.shapes.length - 1),
            };
        });
    };

    const handleShapeContextMenu = (detail: MapShapeSvgEditorShapeContextMenuDetail) => {
        showContextMenu(detail.nativeEvent, [
            {
                label: '上移一层',
                disabled: detail.isAtFront,
                onClick: () => moveShapeForward(detail.shapeId),
            },
            {
                label: '下移一层',
                disabled: detail.isAtBack,
                onClick: () => moveShapeBackward(detail.shapeId),
            },
            {
                label: '移到顶层',
                disabled: detail.isAtFront,
                onClick: () => moveShapeToFront(detail.shapeId),
            },
            {
                label: '移到底层',
                disabled: detail.isAtBack,
                onClick: () => moveShapeToBack(detail.shapeId),
            },
            {type: 'divider'},
            {
                label: '删除图形',
                danger: true,
                onClick: () => deleteShape(detail.shapeId),
            },
        ]);
    };

    const handleVertexContextMenu = (detail: MapShapeSvgEditorVertexContextMenuDetail) => {
        showContextMenu(detail.nativeEvent, [
            {
                label: '删除顶点',
                danger: true,
                onClick: () => deleteVertex(detail.shapeId, detail.vertexId),
            },
        ]);
    };

    const handleLocationContextMenu = (detail: MapShapeSvgEditorLocationContextMenuDetail) => {
        showContextMenu(detail.nativeEvent, [
            {
                label: '删除关键地点',
                danger: true,
                onClick: () => deleteLocation(detail.locationId),
            },
        ]);
    };

    const handleAddShape = () => {
        const nextShape = createEmptyShapeDraft(draft.shapes);
        setDrawingShape(nextShape);
        setSelectedShapeId(nextShape.id);
        setSelectedLocationId(null);
    };

    const handleAddLocation = () => {
        const relatedShape = selectedShape ?? draft.shapes[0] ?? null;
        const center = relatedShape ? getShapeCenter(relatedShape, canvas) : {
            x: canvas.width / 2,
            y: canvas.height / 2,
        };
        const nextLocation: MapKeyLocationDraft = {
            id: createMapShapeEditorLocalId('key-location'),
            name: buildDefaultLocationName(draft.keyLocations),
            type: '观察点',
            x: center.x,
            y: center.y,
            shapeId: relatedShape?.id ?? null,
        };

        setDraft(currentDraft => ({
            ...currentDraft,
            keyLocations: [...currentDraft.keyLocations, nextLocation],
        }));
        setSelectedShapeId(relatedShape?.id ?? null);
        setSelectedLocationId(nextLocation.id);
    };

    const handleSelectedLocationFieldChange = (
        field: 'name' | 'type' | 'shapeId',
        value: string,
    ) => {
        if (!selectedLocationId) return;

        setDraft(currentDraft => ({
            ...currentDraft,
            keyLocations: currentDraft.keyLocations.map(location => (
                location.id === selectedLocationId
                    ? {
                        ...location,
                        [field]: field === 'shapeId' ? (value || null) : value,
                    }
                    : location
            )),
        }));
    };

    const handleSubmit = async () => {
        if (!validationResult.isValid) {
            setSubmissionState({
                status: 'frontend_error',
                message: buildFrontendValidationMessage(validationResult.issues.length),
            });
            return;
        }

        setSubmissionState({
            status: 'saving',
            message: '正在提交到后端，请稍候…',
        });

        try {
            const response = await submitMapShapeScene(api, {
                canvas,
                shapes: draft.shapes,
                keyLocations: draft.keyLocations,
            });

            setPreview(response.scene);
            setSubmissionState({
                status: 'success',
                message: response.message ?? `提交成功，后端时间 ${response.savedAt}。`,
            });
        } catch (error) {
            setSubmissionState({
                status: 'backend_error',
                message: error instanceof Error ? error.message : String(error),
            });
        }
    };

    return (
        <div className={['fc-map-shape-editor', className].filter(Boolean).join(' ')} style={{width, height, ...style}}>
            <div className="fc-map-shape-editor__workspace">
                <section className="fc-map-shape-editor__panel">
                    <div className="fc-map-shape-editor__panel-header">
                        <div>
                            <h3 className="fc-map-shape-editor__panel-title">MapShapeEditor Workbench</h3>
                            <p className="fc-map-shape-editor__panel-subtitle">
                                兼容层仅用于演示完整工作流，核心推荐能力是 `MapShapeSvgEditor` 与 `MapDeckPreview`。
                            </p>
                        </div>
                        <div className="fc-map-shape-editor__toolbar">
                            <Button type="button" size="xs" variant="secondary"
                                    onClick={() => setViewBox(createInitialMapShapeEditorViewBox(canvas))}>
                                重置视图
                            </Button>
                            <Button type="button" size="xs" variant={drawingShape ? 'danger' : 'primary'}
                                    onClick={drawingShape ? () => setDrawingShape(null) : handleAddShape}>
                                {drawingShape ? '取消绘制' : '新增图形'}
                            </Button>
                            <Button type="button" size="xs" variant="secondary" onClick={handleAddLocation}>
                                新增关键地点
                            </Button>
                            <Button type="button" size="xs" onClick={() => void handleSubmit()}>
                                提交预览
                            </Button>
                        </div>
                    </div>

                    <MapShapeSvgEditor
                        canvas={canvas}
                        draft={draft}
                        selectedShapeId={selectedShapeId}
                        selectedLocationId={selectedLocationId}
                        drawingShape={drawingShape}
                        viewBox={viewBox}
                        invalidShapeIds={invalidShapeIds}
                        invalidKeyLocationIds={invalidKeyLocationIds}
                        onDraftChange={setDraft}
                        onSelectedShapeChange={setSelectedShapeId}
                        onSelectedLocationChange={setSelectedLocationId}
                        onDrawingShapeChange={setDrawingShape}
                        onViewBoxChange={setViewBox}
                        onShapeContextMenu={handleShapeContextMenu}
                        onVertexContextMenu={handleVertexContextMenu}
                        onLocationContextMenu={handleLocationContextMenu}
                    />
                </section>

                <aside className="fc-map-shape-editor__panel">
                    <div className="fc-map-shape-editor__panel-header">
                        <div>
                            <h3 className="fc-map-shape-editor__panel-title">状态与表单</h3>
                            <p className="fc-map-shape-editor__panel-subtitle">
                                这些内容属于 workbench 层，不在 `MapShapeSvgEditor` 内部。
                            </p>
                        </div>
                    </div>

                    <div className="fc-map-shape-editor__sidebar-body">
                        <div className="fc-map-shape-editor__section">
                            <div className="fc-map-shape-editor__stats">
                                <div className="fc-map-shape-editor__stat">
                                    <span className="fc-map-shape-editor__stat-label">图形</span>
                                    <strong className="fc-map-shape-editor__stat-value">{draft.shapes.length}</strong>
                                </div>
                                <div className="fc-map-shape-editor__stat">
                                    <span className="fc-map-shape-editor__stat-label">关键地点</span>
                                    <strong
                                        className="fc-map-shape-editor__stat-value">{draft.keyLocations.length}</strong>
                                </div>
                                <div className="fc-map-shape-editor__stat">
                                    <span className="fc-map-shape-editor__stat-label">校验异常</span>
                                    <strong
                                        className="fc-map-shape-editor__stat-value">{validationResult.issues.length}</strong>
                                </div>
                            </div>

                            <div className="fc-map-shape-editor__status-row">
                                <span className="fc-map-shape-editor__status-label">前端校验</span>
                                <div className={[
                                    'fc-map-shape-editor__status',
                                    validationResult.isValid ? 'fc-map-shape-editor__status--success' : 'fc-map-shape-editor__status--error',
                                ].join(' ')}>
                                    {buildFrontendValidationMessage(validationResult.issues.length)}
                                </div>
                            </div>

                            <div className="fc-map-shape-editor__status-row">
                                <span className="fc-map-shape-editor__status-label">提交状态</span>
                                <div className={[
                                    'fc-map-shape-editor__status',
                                    submissionState.status === 'success' ? 'fc-map-shape-editor__status--success' : '',
                                    submissionState.status === 'saving' ? 'fc-map-shape-editor__status--saving' : '',
                                    submissionState.status === 'backend_error' || submissionState.status === 'frontend_error'
                                        ? 'fc-map-shape-editor__status--error'
                                        : '',
                                ].filter(Boolean).join(' ')}>
                                    {submissionState.message}
                                </div>
                            </div>
                        </div>

                        <div className="fc-map-shape-editor__section">
                            <h4 className="fc-map-shape-editor__section-title">当前图形</h4>
                            {selectedShape ? (
                                <>
                                    <div className="fc-map-shape-editor__meta-row">
                                        <span>名称</span>
                                        <strong>{selectedShape.name}</strong>
                                    </div>
                                    <div className="fc-map-shape-editor__meta-row">
                                        <span>顶点</span>
                                        <strong>{selectedShape.vertices.length}</strong>
                                    </div>
                                    {selectedShapeIssues.length > 0 ? (
                                        <div className="fc-map-shape-editor__issue-list">
                                            {selectedShapeIssues.map(issue => (
                                                <div key={`${issue.code}-${issue.message}`}
                                                     className="fc-map-shape-editor__issue-item">
                                                    {issue.message}
                                                </div>
                                            ))}
                                        </div>
                                    ) : null}
                                </>
                            ) : (
                                <div className="fc-map-shape-editor__empty">请先在左侧选中一个图形。</div>
                            )}
                        </div>

                        <div className="fc-map-shape-editor__section">
                            <h4 className="fc-map-shape-editor__section-title">关键地点详情</h4>
                            {selectedLocation ? (
                                <>
                                    <div className="fc-map-shape-editor__field">
                                        <label htmlFor="fc-map-shape-workbench-location-name">名称</label>
                                        <input
                                            id="fc-map-shape-workbench-location-name"
                                            value={selectedLocation.name}
                                            onChange={event => handleSelectedLocationFieldChange('name', event.target.value)}
                                        />
                                    </div>
                                    <div className="fc-map-shape-editor__field">
                                        <label htmlFor="fc-map-shape-workbench-location-type">类型</label>
                                        <input
                                            id="fc-map-shape-workbench-location-type"
                                            value={selectedLocation.type}
                                            onChange={event => handleSelectedLocationFieldChange('type', event.target.value)}
                                        />
                                    </div>
                                    <div className="fc-map-shape-editor__field">
                                        <label htmlFor="fc-map-shape-workbench-location-shape">关联图形</label>
                                        <select
                                            id="fc-map-shape-workbench-location-shape"
                                            value={selectedLocation.shapeId ?? ''}
                                            onChange={event => handleSelectedLocationFieldChange('shapeId', event.target.value)}
                                        >
                                            <option value="">未关联</option>
                                            {draft.shapes.map(shape => (
                                                <option key={shape.id} value={shape.id}>{shape.name}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="fc-map-shape-editor__meta-row">
                                        <span>坐标</span>
                                        <strong>{formatCoordinate(selectedLocation.x)} / {formatCoordinate(selectedLocation.y)}</strong>
                                    </div>
                                    {selectedLocationIssues.length > 0 ? (
                                        <div className="fc-map-shape-editor__issue-list">
                                            {selectedLocationIssues.map(issue => (
                                                <div key={`${issue.code}-${issue.message}`}
                                                     className="fc-map-shape-editor__issue-item">
                                                    {issue.message}
                                                </div>
                                            ))}
                                        </div>
                                    ) : null}
                                    <Button type="button" size="sm" variant="danger"
                                            onClick={() => deleteLocation(selectedLocation.id)}>
                                        删除关键地点
                                    </Button>
                                </>
                            ) : (
                                <div className="fc-map-shape-editor__empty">请先选中一个关键地点。</div>
                            )}
                        </div>

                        <div className="fc-map-shape-editor__section">
                            <h4 className="fc-map-shape-editor__section-title">Deck 预览</h4>
                            <div className="fc-map-shape-editor__editor-shell fc-map-shape-editor__preview-shell"
                                 style={{aspectRatio: `${canvas.width} / ${canvas.height}`}}>
                                <MapDeckPreview scene={preview}/>
                            </div>
                        </div>
                    </div>
                </aside>
            </div>
        </div>
    );
}
