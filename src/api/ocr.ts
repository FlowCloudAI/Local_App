import {command} from './base'

export interface OcrRecognizeImageRequest {
    inputPath: string
    timeoutMs?: number | null
}

export interface OcrModelInfo {
    name: string
    dir: string
}

export interface OcrModels {
    det: OcrModelInfo
    rec: OcrModelInfo
}

export interface OcrLine {
    index: number
    text: string
    score: number | null
    box: number[][] | null
    rect: number[] | null
    detBox: number[][] | null
}

export interface OcrPage {
    inputPath: string
    pageIndex: number | null
    text: string
    lines: OcrLine[]
}

export interface OcrRecognizeImageResult {
    ok: boolean
    engine: string
    device: string
    models: OcrModels
    inputPath: string
    elapsedMs: number
    pages: OcrPage[]
    text: string
}

export const ocr_recognize_image = (request: OcrRecognizeImageRequest) =>
    command<OcrRecognizeImageResult>('ocr_recognize_image', {request})
