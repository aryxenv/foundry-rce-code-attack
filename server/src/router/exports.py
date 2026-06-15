import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from starlette.background import BackgroundTask

router = APIRouter(prefix="/exports", tags=["exports"])

REPO_ROOT = Path(__file__).resolve().parents[3]
EXPORTS_DIR = REPO_ROOT / "exports"
PDF_PATH = EXPORTS_DIR / "webslides.pdf"
EDITABLE_PPTX_PATH = EXPORTS_DIR / "webslides.pptx"
IMAGE_PPTX_PATH = EXPORTS_DIR / "webslides-img.pptx"
EDITABLE_PPTX_REPORT_PATH = EXPORTS_DIR / "webslides.pptx.report.json"
LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1", "0.0.0.0"}
EXPORT_ALLOWED_HOSTS_ENV = "WEBSLIDES_EXPORT_ALLOWED_HOSTS"
EDITABLE_PPTX_NATIVE_MODE = "native-editable"
EDITABLE_PPTX_DEBUG_FIDELITY_MODE = "debug-fidelity"
EDITABLE_PPTX_MODES = {
    EDITABLE_PPTX_NATIVE_MODE,
    EDITABLE_PPTX_DEBUG_FIDELITY_MODE,
}
PDF_MEDIA_TYPE = "application/pdf"
PPTX_MEDIA_TYPE = (
    "application/vnd.openxmlformats-officedocument.presentationml.presentation"
)


class LocalExportRequest(BaseModel):
    url: str
    mode: str | None = None


def get_allowed_export_hosts() -> set[str]:
    allowed_hosts = set(LOCAL_HOSTS)
    configured_hosts = os.getenv(EXPORT_ALLOWED_HOSTS_ENV, "")

    for value in configured_hosts.split(","):
        value = value.strip()
        if not value:
            continue

        parsed = urlparse(value if "://" in value else f"https://{value}")
        if not parsed.hostname:
            raise HTTPException(
                status_code=500,
                detail=f"{EXPORT_ALLOWED_HOSTS_ENV} contains an invalid host: {value}",
            )

        allowed_hosts.add(parsed.hostname.lower())

    return allowed_hosts


def ensure_export_url(url: str) -> str:
    parsed = urlparse(url)
    hostname = parsed.hostname.lower() if parsed.hostname else ""
    if (
        parsed.scheme not in {"http", "https"}
        or hostname not in get_allowed_export_hosts()
    ):
        raise HTTPException(
            status_code=400,
            detail="Exports can only render a local development URL or a configured hosted deck URL.",
        )

    return url


def ensure_editable_pptx_mode(mode: str | None) -> str:
    export_mode = mode or EDITABLE_PPTX_NATIVE_MODE
    if export_mode not in EDITABLE_PPTX_MODES:
        raise HTTPException(
            status_code=400,
            detail=(
                "Editable PPTX mode must be "
                f"{EDITABLE_PPTX_NATIVE_MODE} or {EDITABLE_PPTX_DEBUG_FIDELITY_MODE}."
            ),
        )

    return export_mode


def editable_pptx_args(mode: str, report_path: Path | None = None) -> list[str]:
    args = ["--mode", mode]
    if report_path:
        return [*args, "--report-output", str(report_path)]

    return [*args, "--no-report"]


def run_npm_export(
    *,
    script_name: str,
    url: str,
    output_path: Path,
    export_label: str,
    timeout: int = 120,
    extra_args: list[str] | None = None,
) -> None:
    npm = shutil.which("npm")
    if not npm:
        raise HTTPException(
            status_code=500,
            detail=f"npm was not found on PATH, so the {export_label} export could not run.",
        )

    try:
        command = [
            npm,
            "run",
            script_name,
            "--",
            "--url",
            url,
            "--output",
            str(output_path),
            *(extra_args or []),
        ]
        completed = subprocess.run(
            command,
            cwd=REPO_ROOT,
            capture_output=True,
            check=False,
            text=True,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired as error:
        raise HTTPException(
            status_code=504,
            detail=f"{export_label} export timed out while rendering the deck.",
        ) from error

    if completed.returncode != 0:
        details = "\n".join(
            part.strip()
            for part in (completed.stderr, completed.stdout)
            if part.strip()
        )
        raise HTTPException(
            status_code=500,
            detail=details
            or f"{export_label} export failed without additional output.",
        )


def saved_export_response(path: Path):
    return {
        "filename": path.name,
        "path": f"exports/{path.name}",
    }


def downloadable_export_response(
    *,
    filename: str,
    media_type: str,
    script_name: str,
    url: str,
    export_label: str,
    timeout: int = 120,
    extra_args: list[str] | None = None,
):
    temp_dir = Path(tempfile.mkdtemp(prefix="webslides-export-"))
    output_path = temp_dir / filename

    try:
        run_npm_export(
            script_name=script_name,
            url=url,
            output_path=output_path,
            export_label=export_label,
            timeout=timeout,
            extra_args=extra_args,
        )
    except HTTPException:
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise
    except OSError as error:
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise HTTPException(
            status_code=500,
            detail=f"{export_label} export failed while writing the temporary download file.",
        ) from error

    return FileResponse(
        output_path,
        media_type=media_type,
        filename=filename,
        background=BackgroundTask(lambda: shutil.rmtree(temp_dir, ignore_errors=True)),
    )


@router.post("/pdf")
def export_pdf(request: LocalExportRequest):
    url = ensure_export_url(request.url)
    run_npm_export(
        script_name="export:pdf",
        url=url,
        output_path=PDF_PATH,
        export_label="PDF",
    )

    return FileResponse(
        PDF_PATH,
        media_type=PDF_MEDIA_TYPE,
        filename=PDF_PATH.name,
    )


@router.post("/pdf/download")
def download_pdf(request: LocalExportRequest):
    url = ensure_export_url(request.url)
    return downloadable_export_response(
        filename=PDF_PATH.name,
        media_type=PDF_MEDIA_TYPE,
        script_name="export:pdf",
        url=url,
        export_label="PDF",
    )


@router.post("/pptx")
def export_pptx(request: LocalExportRequest):
    return export_image_pptx(request)


@router.post("/pptx/editable")
def export_editable_pptx(request: LocalExportRequest):
    url = ensure_export_url(request.url)
    mode = ensure_editable_pptx_mode(request.mode)
    run_npm_export(
        script_name="export:pptx",
        url=url,
        output_path=EDITABLE_PPTX_PATH,
        export_label="editable PPTX",
        timeout=300,
        extra_args=editable_pptx_args(mode, EDITABLE_PPTX_REPORT_PATH),
    )

    return saved_export_response(EDITABLE_PPTX_PATH)


@router.post("/pptx/editable/download")
def download_editable_pptx(request: LocalExportRequest):
    url = ensure_export_url(request.url)
    mode = ensure_editable_pptx_mode(request.mode)
    return downloadable_export_response(
        filename=EDITABLE_PPTX_PATH.name,
        media_type=PPTX_MEDIA_TYPE,
        script_name="export:pptx",
        url=url,
        export_label="editable PPTX",
        timeout=300,
        extra_args=editable_pptx_args(mode),
    )


@router.post("/pptx/image")
def export_image_pptx(request: LocalExportRequest):
    url = ensure_export_url(request.url)
    run_npm_export(
        script_name="export:pptx-img",
        url=url,
        output_path=IMAGE_PPTX_PATH,
        export_label="image PPTX",
        timeout=240,
    )

    return saved_export_response(IMAGE_PPTX_PATH)


@router.post("/pptx/image/download")
def download_image_pptx(request: LocalExportRequest):
    url = ensure_export_url(request.url)
    return downloadable_export_response(
        filename=IMAGE_PPTX_PATH.name,
        media_type=PPTX_MEDIA_TYPE,
        script_name="export:pptx-img",
        url=url,
        export_label="image PPTX",
        timeout=240,
    )
