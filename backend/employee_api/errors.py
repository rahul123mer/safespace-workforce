"""One error shape for every failure: `{"error": {"code", "message", "fields"?}}`.
`message` is written for the administrator reading it in the UI."""
from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, fields: dict[str, str] | None = None) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.fields = fields or {}


def not_found(entity: str) -> ApiError:
    return ApiError(404, "not_found", f"The requested {entity} does not exist or has been removed.")


def conflict(code: str, message: str, fields: dict[str, str] | None = None) -> ApiError:
    return ApiError(409, code, message, fields)


def invalid(message: str, fields: dict[str, str] | None = None) -> ApiError:
    return ApiError(422, "validation_failed", message, fields)


def _field_path(loc: tuple) -> str:
    parts = [str(p) for p in loc if p not in ("body", "query", "path")]
    return ".".join(parts) or "request"


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(_: Request, exc: ApiError) -> JSONResponse:
        body = {"code": exc.code, "message": exc.message}
        if exc.fields:
            body["fields"] = exc.fields
        return JSONResponse({"error": body}, status_code=exc.status)

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError) -> JSONResponse:
        fields: dict[str, str] = {}
        for err in exc.errors():
            msg = str(err.get("msg", "Invalid value"))
            if msg.startswith("Value error, "):
                msg = msg[len("Value error, "):]
            fields.setdefault(_field_path(tuple(err.get("loc", ()))), msg)
        return JSONResponse(
            {"error": {"code": "validation_failed", "message": "Some fields need attention before this can be saved.", "fields": fields}},
            status_code=422,
        )
