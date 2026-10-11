"""Probe which query STYLES return usable (ready / verified-route) agents. Anonymous Search only."""
import json, sys
from darwin_client import search, DarwinError

Q = {
 "tool-name": ["place_call", "send_sms", "ai_call", "request_ride", "book_appointment", "order_groceries", "refill_prescription"],
 "capability-short": ["phone call API", "SMS API", "ride booking API", "appointment scheduling API", "grocery ordering API", "pharmacy API"],
 "mcp-framed": ["MCP server for booking rides", "MCP server for scheduling doctor appointments", "MCP server for ordering groceries", "MCP server that makes phone calls"],
 "outcome": ["Get a person to a clinic at 2pm Thursday", "Make sure someone takes their pills every day", "Get food delivered to an elderly person's home"],
 "brand": ["Uber", "Lyft", "Instacart", "DoorDash", "CVS pharmacy", "Twilio"],
 "long-natural": ["My grandmother is 80 and needs a ride to her cardiologist on Thursday at 2pm. She cannot drive. Find an agent that can book a ride and confirm pickup."],
 "broad": ["transportation", "healthcare", "grocery", "pharmacy", "telephony", "caregiver"],
}
rows = []
for style, qs in Q.items():
    for q in qs:
        try:
            r = search(q, None, 5, anonymous=True)
        except DarwinError as e:
            rows.append((style, q, f"ERR{e.status}", 0, 0, 0, "")); continue
        ready = [a for a in r.agents if a.readiness == "ready"]
        start = [a for a in r.agents if a.canStartThread]
        conn = [a for a in r.agents if a.has_confirmed_connection]
        rows.append((style, q, r.status, len(r.agents), len(ready), len(conn), ", ".join(a.name[:28] for a in r.agents[:2])))
        d = dict(r.raw); d.pop("searchToken", None)
        json.dump(d, open(f"results/probe/{style}__{q[:40].replace(' ','_').replace('/','')}.json", "w"), indent=2)
for row in rows:
    print(" | ".join(map(str, row)))
tot = sum(r[3] for r in rows)
print(f"\nqueries={len(rows)} agents_total={tot} ready={sum(r[4] for r in rows)} verified_conn={sum(r[5] for r in rows)}")
