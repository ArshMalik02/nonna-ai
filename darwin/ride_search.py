"""Run the ride-focused Darwin queries and print what comes back.

    .venv/bin/python ride_search.py            # uses DARWIN_API_KEY if set
    .venv/bin/python ride_search.py --anonymous

Search is discovery only; no provider is contacted. Raw responses go to results/rides/.
"""
import json
import sys
from pathlib import Path

from darwin_client import DarwinError, search

OUT = Path(__file__).parent / "results" / "rides"
OUT.mkdir(parents=True, exist_ok=True)

# Tool-name style wording ("book_ride") surfaced the most agents in testing.
QUERIES = [
    "book_ride", "request_ride", "ride-hailing", "book a taxi",
    "Ride to a doctor appointment on Thursday",
    "Request a ride from home to a medical clinic",
    "Schedule a wheelchair-accessible ride for an elderly person",
    "Non-emergency medical transportation for seniors",
]


def main() -> None:
    anon = "--anonymous" in sys.argv
    for q in QUERIES:
        try:
            r = search(q, None, 5, anonymous=anon)
        except DarwinError as e:
            print(f"ERR {e.status:3} | {q}")
            continue
        d = dict(r.raw)
        d.pop("searchToken", None)  # private
        (OUT / (q[:40].replace(" ", "_").replace("/", "") + ".json")).write_text(json.dumps(d, indent=2))
        usable = sum(a.readiness == "ready" and a.canStartThread is True for a in r.agents)
        names = ", ".join(a.name[:28] for a in r.agents[:3])
        print(f"{r.status:12} agents={len(r.agents)} usable={usable} | {q} | {names}")
        if r.question:
            print(f"             asks: {r.question}")


if __name__ == "__main__":
    main()
