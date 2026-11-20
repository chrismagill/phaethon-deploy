# Integrating with Ordinance

How to put Ordinance in front of an action in your own system or AI agent, so
that the action runs only when policy allows it and every decision is traceable
to the person who asked. Applies to Ordinance 4.0 and later.

## The one rule

**Ordinance decides; your code enforces.** Ordinance is not in the network path
and cannot block anything by itself. The integration is correct when the
sensitive action is unreachable except through a call that returned ALLOW:

```
request arrives → build the facts → ask Ordinance → ALLOW? → perform the action
                                                  → DENY / ESCALATE / error → do not
```

Put the check in the code that performs the action (the tool implementation,
the service method), not in the agent's prompt or the UI. An agent told to
"check policy first" can skip it; a function that cannot run without ALLOW
cannot.

## The request

`POST /v1/evaluate` with header `X-Api-Key: <this system's key>`:

```json
{
  "action":   "data.export_cui",
  "subject":  { "id": "jane@example.com", "role": "analyst" },
  "resource": { "dataset": "contracts-2026", "destination": "sftp://partner" },
  "context":  { "destination_approved": true, "dlp_scan_passed": true }
}
```

| Field | Meaning | Used for the decision? |
|---|---|---|
| `action` | What is about to happen. Must match a rule's `action` exactly | Yes — selects the rules |
| `subject.id` | **Who requested it.** Required, non-empty | No — recorded as the requester |
| `subject.*`, `resource` | Anything else worth having on the record | No — recorded only |
| `context` | The facts the policy tests | **Yes — the only input to conditions** |
| `approval_id` | Present only when resuming an approved escalation | See below |

A fact that should affect the decision must be in `context`. If you put a key
the policy needs into `subject` or `resource`, the response carries a `hint`
saying so.

### Who asked: `subject.id`

This is what makes a decision traceable to an individual, and Ordinance records
whatever you send — so where it comes from matters:

- Take it from the **authenticated session or token** in your system (the
  signed-in user, the caller's verified identity).
- For an **AI agent**, it is the human the agent is acting for — passed down
  from the session that started the agent, never chosen or produced by the
  model.
- For unattended automation, use the service account name, and say what
  triggered it in `resource` (job ID, schedule).
- Use a stable identifier (email or directory ID), the same one your console
  operators use as usernames, so self-approval is caught.

### Facts: `context`

Policy is only as good as the facts it is given. For each key the policy reads:

- **Your code establishes the fact** (looked up from the ticketing system, the
  DLP scanner, the identity provider). Do not pass through values that the
  requester or the model supplied.
- **Send real JSON types.** `equals: true` matches only `true` — not `1`, not
  `"true"`.
- **Leave a fact out if you do not know it.** A missing required fact
  escalates to a human; a wrong one denies. Never default an unknown to `true`.
- Ask what an action needs: `GET /v1/policies/applicable?action=data.export_cui`.

## The response

```json
{
  "decision": "escalate",
  "reasons": ["DATA-001: 'dlp_scan_passed' was not provided …"],
  "controls": ["NIST 800-171 3.1.3"],
  "matched_rules": [{ "rule_id": "DATA-001", "outcome": "escalate",
                      "bundle": "data.yaml", "bundle_version": "2026.11", "bundle_sha256": "…" }],
  "policy_match": true,
  "approval_id": "0b6f…",
  "approved_by": null,
  "caller": "key:ops-copilot",
  "policy_digest": "…",
  "evidence_id": "…"
}
```

| `decision` | Your code must |
|---|---|
| `allow` | Proceed. Keep `evidence_id` with your own record of the action |
| `deny` | Not proceed. Show `reasons` to the requester |
| `escalate` | Not proceed. Tell the requester it needs approval; keep `approval_id` |
| anything else — HTTP error, timeout, unreachable | **Not proceed** |

**Fail closed.** If Ordinance cannot be reached or returns an error, the action
does not run. Treating an outage as an ALLOW turns the control off exactly when
nobody is looking.

`policy_match: false` means no rule covers the action and the default decision
was applied — worth logging on your side as a policy gap.

## Escalations: wait, then resume

An ESCALATE creates a pending approval. A console operator (or a designated
approver system) approves or rejects it. Then:

1. Check the status: `GET /v1/approvals/<approval_id>` → `pending`, `approved`
   or `rejected`. Poll at a sensible interval, or have the requester come back.
2. If approved, send **the same request again with `approval_id`**. The answer
   is ALLOW, with `approved_by` naming the approver.

What to expect:

- The request must be **identical** — same action, subject, resource and
  context, from the same API key. So keep timestamps, request IDs and other
  per-call values out of those fields.
- An approval is **single-use** and expires (24 hours by default).
- Policy is re-evaluated on the resumed call. If the facts or the policy now
  produce a DENY, it is denied. A policy change cancels unused approvals.
- If the approval cannot be used, the call returns **HTTP 409** with the
  reason (still pending, rejected, expired, already used, request differs).
- Calling again *without* `approval_id` simply escalates again and opens
  another approval.
- Your key cannot approve its own escalation, and neither can the requester.

Ordinance sends no notifications. If approvers need a prompt, have your system
raise the ticket or chat message with the `approval_id` when it gets an
ESCALATE.

## Using the reference client (Python)

A single dependency-free file. It ships inside the image:

```bash
docker compose cp ordinance:/srv/client ./ordinance-client
```

Copy `ordinance_client.py` into your project (`README.md` and an agent-tool
example are alongside it).

```python
from ordinance_client import OrdinanceClient, Denied, EscalationRequired, OrdinanceError

ordinance = OrdinanceClient(base_url="https://ordinance.example.internal",
                            api_key=os.environ["ORDINANCE_API_KEY"])

def export_cui(session, dataset, destination):
    who   = {"id": session.user_email}                    # from YOUR session
    facts = {"destination_approved": allowlist.contains(destination),
             "dlp_scan_passed": dlp.scan(dataset).clean}  # established by YOUR code
    try:
        decision = ordinance.enforce("data.export_cui", subject=who, context=facts,
                                     resource={"dataset": dataset, "destination": destination})
    except Denied as e:
        raise PermissionError("; ".join(e.reasons))
    except EscalationRequired as e:
        tickets.open(f"Approval needed: {e.approval_id}", requester=session.user_email)
        raise PermissionError(f"needs approval ({e.approval_id})")
    except OrdinanceError:
        raise PermissionError("policy check unavailable")  # fail closed
    do_export(dataset, destination, evidence_id=decision["evidence_id"])
```

Resuming after approval is the same call with `approval_id=`; `@guard(...)`
wraps a function so it cannot run without ALLOW. Both are in the client's
`README.md`.

Any language works — it is one HTTPS POST. Port the same three rules: require
the requester, treat everything except `allow` as stop, fail closed on errors.

## AI agents

- **Gate the tools, not the model.** Each tool the agent can call maps to an
  `action`; the tool's implementation calls Ordinance before doing anything.
  `example_agent_tool.py` in the client folder shows the pattern.
- **The requester is the human**, carried from the session into every tool
  call. The model never supplies it.
- **Facts come from the tool's own checks**, not from the model's arguments or
  its claims about them.
- **One API key per agent or integration**, so the ledger shows which one asked.
- On ESCALATE, return a plain "this needs human approval" result to the agent.
  Do not let it retry in a loop — each retry opens another approval.

## Keys and transport

- Each calling system gets its own named key from whoever runs the instance
  (`ORDINANCE_API_KEYS`, see [PRODUCTION.md](PRODUCTION.md#api-keys)). Store it
  as a secret; never ship it to a browser or put it in a prompt.
- Call Ordinance over HTTPS through the reverse proxy. The container's own port
  is plain HTTP and should not be reachable from other machines.
- A request body is limited to 256 KiB. Send facts, not documents.

## Before you go live

1. For each gated action, confirm the three outcomes with real requests: a
   compliant one (ALLOW), a violating one (DENY), one with a fact missing
   (ESCALATE).
2. Stop Ordinance and confirm the action **cannot** run.
3. Approve an escalation in the console and confirm the resumed call proceeds
   once, and not twice.
4. Find each of those in the console's Audit Log: the requester is the right
   person, the caller is your system's key name, and the rule is the one you
   expected.

---

**Support:** info@phaethonsecurity.com
