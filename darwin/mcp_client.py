"""Minimal MCP streamable-HTTP client (JSON-RPC 2.0 over POST).

Used to connect to a provider endpoint that was resolved from the provider's own
registry entry (never guessed from a Darwin agent name). Read-only helpers only:
callers must gate any mutating tool behind explicit admin approval.
"""
from __future__ import annotations

import itertools
import json
from typing import Any

import requests

PROTOCOL_VERSION = "2025-03-26"


class McpError(Exception):
    pass


class McpClient:
    def __init__(self, url: str, headers: dict | None = None, timeout: int = 45):
        if not url.startswith("https://"):
            raise McpError("Refusing non-https MCP endpoint")
        self.url = url
        self.timeout = timeout
        self.headers = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            **(headers or {}),
        }
        self._ids = itertools.count(1)
        self.session_id: str | None = None
        self.server_info: dict = {}

    def _post(self, payload: dict) -> dict | None:
        h = dict(self.headers)
        if self.session_id:
            h["Mcp-Session-Id"] = self.session_id
        r = requests.post(self.url, json=payload, headers=h, timeout=self.timeout)
        sid = r.headers.get("Mcp-Session-Id")
        if sid:
            self.session_id = sid
        if r.status_code == 202 or not r.content:
            return None
        if not r.ok:
            raise McpError(f"HTTP {r.status_code}: {r.text[:300]}")
        ctype = r.headers.get("Content-Type", "")
        body = r.text
        if "text/event-stream" in ctype:  # take the last data: frame that parses
            msgs = [l[5:].strip() for l in body.splitlines() if l.startswith("data:")]
            body = msgs[-1] if msgs else "{}"
        msg = json.loads(body)
        if "error" in msg:
            raise McpError(f"JSON-RPC error: {msg['error']}")
        return msg.get("result")

    def request(self, method: str, params: dict | None = None) -> Any:
        return self._post({"jsonrpc": "2.0", "id": next(self._ids), "method": method, "params": params or {}})

    def notify(self, method: str, params: dict | None = None) -> None:
        self._post({"jsonrpc": "2.0", "method": method, "params": params or {}})

    def initialize(self) -> dict:
        res = self.request("initialize", {
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": {"name": "nonna-darwin-layer", "version": "0.1"},
        })
        self.server_info = res or {}
        self.notify("notifications/initialized")
        return self.server_info

    def list_tools(self) -> list[dict]:
        return (self.request("tools/list") or {}).get("tools", [])

    def call_tool(self, name: str, arguments: dict) -> Any:
        return self.request("tools/call", {"name": name, "arguments": arguments})
