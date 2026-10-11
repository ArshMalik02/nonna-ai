"""End-to-end ride flow up to (not including) the booking. Fake rider data.

Darwin Search (discovery) -> registry endpoint -> MCP handshake -> quote ->
availability -> plain-language proposal for the admin. No booking is made.
"""
from darwin_client import search
from ride_agent import RideAgent

print("1. Darwin Search: finding a ride agent...")
res = search("Create a confirmed RIED.TAXI booking", None, 3, anonymous=True)
for a in res.agents[:3]:
    print(f"   - {a.name} | readiness={a.readiness} | darwin route confirmed={a.has_confirmed_connection}")

print("2. Darwin has no executable route -> resolving endpoint from the official MCP registry")
agent = RideAgent()
print(f"   endpoint={agent.url} server={agent.server.get('serverInfo')}")

print("3. Quote (read-only)")
q = agent.quote("Hauptplatz, 4910 Ried im Innkreis, Austria", "Salzburg Airport, Austria", passengers=1)
print(f"   ok={q.ok} price=EUR {q.price_eur} quote_id={q.quote_id} valid_until={q.valid_until}")

print("4. Prepare proposal for the admin (availability is read-only; fake rider, nothing sent)")
p = agent.prepare_booking(q, "2026-10-15", "14:00", 1, "Test", "Rider", "+43 660 0000000")
print("   " + p.plain_language())

print("5. Booking attempt without approval/flag (must be refused)")
try:
    agent.book(p, admin_approved=True, customer_confirmed=True, accepted_terms=True)
except PermissionError as e:
    print("   refused:", e)
