from __future__ import annotations

import argparse
import json
import os
import sys
import time
import traceback
from pathlib import Path
from typing import Any


DEFAULT_DET_MODEL_NAME = "PP-OCRv6_small_det"
DEFAULT_REC_MODEL_NAME = "PP-OCRv6_small_rec"


class SidecarError(Exception):
    def __init__(self, code: str, message: str, exit_code: int = 1) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.exit_code = exit_code


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="FlowCloudAI OCR sidecar")
    parser.add_argument("--input", required=True, help="输入图片路径")
    parser.add_argument("--output", required=True, help="输出 JSON 路径")
    parser.add_argument("--det-model-name", default=DEFAULT_DET_MODEL_NAME)
    parser.add_argument("--rec-model-name", default=DEFAULT_REC_MODEL_NAME)
    parser.add_argument("--det-model-dir", default=None)
    parser.add_argument("--rec-model-dir", default=None)
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--engine", default="paddle")
    parser.add_argument("--cpu-threads", type=int, default=None)
    parser.add_argument("--text-det-limit-side-len", type=int, default=None)
    parser.add_argument("--cache-dir", default=None, help="运行期缓存目录")
    parser.add_argument("--include-raw", action="store_true", help="输出 PaddleOCR 原始字段")
    return parser.parse_args()


def app_root_from_source() -> Path | None:
    current = Path(__file__).resolve()
    for parent in current.parents:
        if (parent / "flowcloudai.projects.json").is_file():
            return parent
    return None


def resource_root() -> Path:
    if getattr(sys, "frozen", False):
        return Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent)).resolve()
    return Path(__file__).resolve().parent


def default_cache_dir() -> Path:
    env_dir = os.environ.get("FLOWCLOUDAI_OCR_CACHE_DIR")
    if env_dir:
        return Path(env_dir).resolve()

    app_root = app_root_from_source()
    if app_root is not None:
        return app_root / ".local" / "ocr-sidecar" / "cache"

    return Path(sys.executable).resolve().parent / "ocr-cache"


def prepare_environment(cache_dir: Path) -> None:
    cache_dir.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")
    os.environ.setdefault("PADDLE_HOME", str(cache_dir / "paddle"))
    os.environ.setdefault("PADDLEOCR_HOME", str(cache_dir / "paddleocr"))
    os.environ.setdefault("PADDLEX_HOME", str(cache_dir / "paddlex"))
    os.environ.setdefault("PADDLE_PDX_HOME", str(cache_dir / "paddlex"))
    os.environ.setdefault("PADDLE_PDX_CACHE_HOME", str(cache_dir / "paddlex"))
    os.environ.setdefault("HF_HOME", str(cache_dir / "huggingface"))
    os.environ.setdefault("MODELSCOPE_CACHE", str(cache_dir / "modelscope"))


def resolve_model_dir(model_name: str, explicit: str | None) -> Path:
    candidates: list[Path] = []
    if explicit:
        candidates.append(Path(explicit))

    env_root = os.environ.get("FLOWCLOUDAI_OCR_MODEL_ROOT")
    if env_root:
        candidates.append(Path(env_root) / model_name)

    candidates.append(resource_root() / "models" / model_name)

    app_root = app_root_from_source()
    if app_root is not None:
        candidates.append(app_root / ".local" / "ocr-sidecar" / "models" / model_name)

    for candidate in candidates:
        resolved = candidate.resolve()
        if (resolved / "inference.yml").is_file() and (resolved / "inference.pdiparams").is_file():
            return resolved

    checked = "; ".join(str(path) for path in candidates)
    raise SidecarError(
        "MODEL_NOT_FOUND",
        f"未找到 OCR 模型目录：{model_name}；已检查：{checked}",
        3,
    )


def to_json_value(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if hasattr(value, "tolist"):
        return value.tolist()
    if isinstance(value, dict):
        return {str(key): to_json_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [to_json_value(item) for item in value]
    return str(value)


def pick_page_value(data: dict[str, Any], key: str, index: int) -> Any:
    value = data.get(key)
    if value is None:
        return None
    value = to_json_value(value)
    if isinstance(value, list) and index < len(value):
        return value[index]
    return None


def extract_page(result: Any) -> dict[str, Any]:
    data = dict(result)
    texts = to_json_value(data.get("rec_texts") or [])
    scores = to_json_value(data.get("rec_scores") or [])
    lines: list[dict[str, Any]] = []

    for index, text in enumerate(texts):
        score = scores[index] if isinstance(scores, list) and index < len(scores) else None
        line = {
            "index": index,
            "text": str(text),
            "score": float(score) if isinstance(score, (int, float)) else None,
            "box": pick_page_value(data, "rec_polys", index),
            "rect": pick_page_value(data, "rec_boxes", index),
            "detBox": pick_page_value(data, "dt_polys", index),
        }
        lines.append(line)

    return {
        "inputPath": str(data.get("input_path") or ""),
        "pageIndex": data.get("page_index"),
        "text": "\n".join(line["text"] for line in lines),
        "lines": lines,
        "raw": to_json_value(data),
    }


def build_ocr(args: argparse.Namespace, det_model_dir: Path, rec_model_dir: Path) -> Any:
    from paddleocr import PaddleOCR

    params: dict[str, Any] = {
        "use_doc_orientation_classify": False,
        "use_doc_unwarping": False,
        "use_textline_orientation": False,
        "text_detection_model_name": args.det_model_name,
        "text_detection_model_dir": str(det_model_dir),
        "text_recognition_model_name": args.rec_model_name,
        "text_recognition_model_dir": str(rec_model_dir),
        "device": args.device,
        "engine": args.engine,
    }
    if args.cpu_threads is not None:
        params["cpu_threads"] = args.cpu_threads
    if args.text_det_limit_side_len is not None:
        params["text_det_limit_side_len"] = args.text_det_limit_side_len
    return PaddleOCR(**params)


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def run() -> int:
    args = parse_args()
    output_path = Path(args.output).resolve()
    started_at = time.perf_counter()

    try:
        input_path = Path(args.input).resolve()
        if not input_path.is_file():
            raise SidecarError("INPUT_NOT_FOUND", f"输入图片不存在：{input_path}", 2)

        cache_dir = Path(args.cache_dir).resolve() if args.cache_dir else default_cache_dir()
        prepare_environment(cache_dir)
        det_model_dir = resolve_model_dir(args.det_model_name, args.det_model_dir)
        rec_model_dir = resolve_model_dir(args.rec_model_name, args.rec_model_dir)

        ocr = build_ocr(args, det_model_dir, rec_model_dir)
        pages = [extract_page(page) for page in ocr.predict(str(input_path))]
        if not args.include_raw:
            for page in pages:
                page.pop("raw", None)

        elapsed_ms = round((time.perf_counter() - started_at) * 1000)
        payload = {
            "ok": True,
            "engine": args.engine,
            "device": args.device,
            "models": {
                "det": {"name": args.det_model_name, "dir": str(det_model_dir)},
                "rec": {"name": args.rec_model_name, "dir": str(rec_model_dir)},
            },
            "inputPath": str(input_path),
            "elapsedMs": elapsed_ms,
            "pages": pages,
            "text": "\n".join(page["text"] for page in pages if page.get("text")),
        }
        write_json(output_path, payload)
        return 0
    except SidecarError as error:
        write_json(
            output_path,
            {
                "ok": False,
                "code": error.code,
                "message": error.message,
                "elapsedMs": round((time.perf_counter() - started_at) * 1000),
            },
        )
        print(error.message, file=sys.stderr)
        return error.exit_code
    except Exception as error:  # noqa: BLE001 - sidecar 边界需要吞成结构化错误
        write_json(
            output_path,
            {
                "ok": False,
                "code": "OCR_FAILED",
                "message": str(error),
                "elapsedMs": round((time.perf_counter() - started_at) * 1000),
                "traceback": traceback.format_exc(),
            },
        )
        traceback.print_exc(file=sys.stderr)
        return 10


if __name__ == "__main__":
    raise SystemExit(run())
