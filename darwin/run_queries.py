"""Run elder-task queries through Darwin Search; save raw responses to results/.
Fake data only. Search is discovery only -- no provider is contacted.

Usage: python run_queries.py [--anonymous] [--refine]
"""
import json
import sys
from pathlib import Path

from darwin_client import DarwinError, search

OUT = Path(__file__).parent / "results"
OUT.mkdir(exist_ok=True)

FAKE_CTX = {"type": "text", "text": "Requester is a 78-year-old; a caregiver will approve actions. Fake demo data."}
LOC = {"type": "custom", "data": {"location": "Springfield, USA (fake)", "zip": "00000"}}
DEADLINE = {"type": "deadline", "at": "2026-10-16T17:00:00Z"}
BUDGET = {"type": "budget", "amountMinor": 5000, "currency": "USD"}

QUERIES = [
    ("01-ride-doctor", "Ride to a doctor appointment on Thursday", [FAKE_CTX, LOC, DEADLINE]),
    ("02-prescription-refill", "Prescription refill for a regular medication", [FAKE_CTX, LOC]),
    ("03-book-pcp", "Book a primary care appointment", [FAKE_CTX, LOC]),
    ("04-grocery-delivery", "Grocery delivery for a senior", [FAKE_CTX, LOC, BUDGET]),
    ("05-smartphone-help", "Help setting up or fixing a smartphone", [FAKE_CTX]),
    ("06-med-reminder-calls", "Daily medication reminder calls", [FAKE_CTX]),
    ("07-home-care-aide", "Find a home care aide", [FAKE_CTX, LOC]),
    ("08-medicare-questions", "Questions about Medicare benefits", [FAKE_CTX]),
    ("09-utility-bill-dispute", "Dispute an unexpected utility bill", [FAKE_CTX, BUDGET]),
    ("10-meal-delivery", "Senior-friendly meal delivery", [FAKE_CTX, LOC, BUDGET]),
]

REFINE = "Only options that can be used by a caregiver on behalf of an elderly person, and that publish a verified connection endpoint"


def save(name, res):
    (OUT / f"{name}.json").write_text(json.dumps(res.raw, indent=2))
    # searchToken is private: strip from saved files
    p = OUT / f"{name}.json"
    d = json.loads(p.read_text())
    d.pop("searchToken", None)
    p.write_text(json.dumps(d, indent=2))


def main():
    anon = "--anonymous" in sys.argv
    refine = "--refine" in sys.argv
    for name, q, ctx in QUERIES:
        if (OUT / f"{name}.json").exists() and "--force" not in sys.argv:
            continue  # keep earlier successful raw responses
        try:
            res = search(q, ctx, max_results=5, anonymous=anon)
            save(name, res)
            top = res.agents[0].name if res.agents else "-"
            print(f"{name}: {res.status} agents={len(res.agents)} top={top}")
            if refine:
                r2 = search(REFINE, None, max_results=5, previous_response_id=res.responseId, anonymous=anon,
                            search_token=res.searchToken)
                save(name + "-refined", r2)
                print(f"  refined: {r2.status} agents={len(r2.agents)}")
        except DarwinError as e:
            print(f"{name}: ERROR {e.status} {str(e.body)[:120]}")
            (OUT / f"{name}.error.json").write_text(json.dumps({"status": e.status, "body": e.body}, indent=2))


if __name__ == "__main__":
    main()
