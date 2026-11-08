"""Bound native-auth JSON before FastAPI parses password-bearing bodies."""

from starlette.requests import Request
from starlette.types import ASGIApp, Receive, Scope, Send

from myschedule.errors import ApiError, api_error_handler


class PasswordBodyLimit:
    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if (
            scope["type"] != "http"
            or scope["method"] != "POST"
            or not scope["path"].startswith("/api/v1/auth/password/")
        ):
            await self.app(scope, receive, send)
            return
        messages, size = [], 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            size += len(message.get("body", b""))
            if size > 8192:
                response = await api_error_handler(
                    Request(scope), ApiError(413, "REQUEST_TOO_LARGE", "Isian terlalu panjang.")
                )
                await response(scope, receive, send)
                return
            messages.append(message)
            if not message.get("more_body", False):
                break

        async def replay():
            return messages.pop(0) if messages else await receive()

        await self.app(scope, replay, send)
