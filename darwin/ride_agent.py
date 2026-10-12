"""Ride adapter: Darwin discovery -> provider-registry endpoint -> MCP quote/booking.

Provider: RIED.TAXI (Upper Austria / Salzburg / Passau), found via Darwin Search
("Create a confirmed RIED.TAXI booking"). Darwin's route for it is blocked, so the
endpoint is resolved from the official MCP registry (never guessed from a name).

Safety model (matches the product rule: admin approves money / personal info):
  quote(), availability()       read-only, no personal data, safe to call freely
  prepare_booking()             builds a plain-language proposal; sends nothing
  book(proposal, approval)      the ONLY mutating call. Refuses unless the admin
                                approved this exact proposal AND RIDE_LIVE_BOOKING=true.
"""
from __future__ import annotations

import json
import os
import uuid
from dataclasses import dataclass, field

import requests

from mcp_client import McpClient, McpError

REGISTRY = "https://registry.modelcontextprotocol.io/v0/servers"
REGISTRY_NAME = "taxi.ried/booking"


def resolve_endpoint(name: str = REGISTRY_NAME) -> str:
    """Look the provider up in the official MCP registry; require https."""
    r = requests.get(REGISTRY, params={"search": name, "limit": 10}, timeout=30)
    r.raise_for_status()
    for entry in r.json().get("servers", []):
        s = entry.get("server", entry)
        if s.get("name") == name:
            for remote in s.get("remotes", []):
                if remote.get("url", "").startswith("https://"):
                    return remote["url"]
    raise McpError(f"{name} not found in registry with an https remote")


def _payload(result: dict) -> dict:
    sc = result.get("structuredContent")
    if sc:
        return sc
    text = "".join(c.get("text", "") for c in result.get("content", []))
    try:
        return json.loads(text)
    except ValueError:
        return {"text": text}


@dataclass
class Quote:
    ok: bool
    price_eur: float | None = None
    quote_id: str | None = None
    valid_until: str | None = None
    pickup: str | None = None
    destination: str | None = None
    km: float | None = None
    vehicle: str | None = None
    notes: list[str] = field(default_factory=list)
    raw: dict = field(default_factory=dict)


@dataclass
class Proposal:
    """What the admin is asked to approve. Nothing has been sent to the provider."""
    quote: Quote
    pickup_date: str
    pickup_time: str
    passengers: int
    rider_first_name: str
    rider_last_name: str
    rider_phone: str
    idempotency_key: str
    available: bool

    def plain_language(self) -> str:
        q = self.quote
        return (
            f"Ride for {self.rider_first_name}: {q.pickup} -> {q.destination}, "
            f"{self.pickup_date} at {self.pickup_time} (Vienna time). "
            f"Price EUR {q.price_eur:.2f} for the whole car ({q.vehicle}), one way. "
            f"Car {'is free' if self.available else 'is NOT free'} at that time. "
            f"Booking shares the rider's name and phone number with RIED.TAXI. "
            f"Nothing is booked until you approve."
        )


class RideAgent:
    def __init__(self, url: str | None = None):
        self.url = url or resolve_endpoint()
        self.mcp = McpClient(self.url)
        self.server = self.mcp.initialize()

    def _call(self, tool: str, args: dict) -> dict:
        return _payload(self.mcp.call_tool(tool, args))

    def quote(self, pickup: str, destination: str, passengers: int = 1) -> Quote:
        d = self._call("ried_taxi_get_quote", {
            "pickup_address": pickup, "destination_address": destination, "passengers": passengers})
        if not d.get("ok"):
            return Quote(ok=False, raw=d)
        return Quote(
            ok=True, price_eur=d.get("price_eur"), quote_id=d.get("quote_id"),
            valid_until=d.get("valid_until"),
            pickup=d.get("pickup_resolved", {}).get("name"),
            destination=d.get("destination_resolved", {}).get("name"),
            km=d.get("road_km_estimate"), vehicle=d.get("vehicle"),
            notes=[d.get("price_basis", ""), d.get("waiting_rules", "")], raw=d)

    def availability(self, date: str, time: str, passengers: int = 1) -> dict:
        return self._call("ried_taxi_check_availability", {
            "pickup_date": date, "pickup_time": time, "passengers": passengers})

    def prepare_booking(self, quote: Quote, date: str, time: str, passengers: int,
                        first_name: str, last_name: str, phone: str) -> Proposal:
        avail = self.availability(date, time, passengers)
        return Proposal(quote, date, time, passengers, first_name, last_name, phone,
                        idempotency_key=f"nonna-{uuid.uuid4()}", available=bool(avail.get("available")))

    def book(self, proposal: Proposal, *, admin_approved: bool, customer_confirmed: bool,
             accepted_terms: bool) -> dict:
        if os.environ.get("RIDE_LIVE_BOOKING", "false").lower() != "true":
            raise PermissionError("Live booking disabled (set RIDE_LIVE_BOOKING=true to allow a REAL booking).")
        if not (admin_approved and customer_confirmed and accepted_terms):
            raise PermissionError("Needs admin approval, rider confirmation and accepted terms.")
        if not proposal.available:
            raise PermissionError("Car is not free at the requested time.")
        return self._call("ried_taxi_create_booking", {
            "idempotency_key": proposal.idempotency_key,
            "quote_id": proposal.quote.quote_id,
            "first_name": proposal.rider_first_name, "last_name": proposal.rider_last_name,
            "phone": proposal.rider_phone, "language": "en",
            "pickup_date": proposal.pickup_date, "pickup_time": proposal.pickup_time,
            "pickup_address": proposal.quote.pickup, "destination_address": proposal.quote.destination,
            "passengers": proposal.passengers, "large_suitcases": 0, "whatsapp_opt_in": False,
            "accepted_terms": True, "customer_confirmed": True})
