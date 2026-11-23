#!/usr/bin/env python3
"""Compare the repo's migrations with production's migration history.

Reads `supabase migration list --linked` (text table) on stdin and prints a
Markdown report (also appended to $GITHUB_STEP_SUMMARY when set).

Exit 1 = DRIFT: production records a migration that is not a file in
supabase/migrations (someone changed prod outside the repo, e.g. the SQL
editor, or a migration was applied from an unmerged branch). Versions listed
in supabase/migrations-remote-only.txt, each with a reason, are tolerated.

Pending migrations (in the repo, not in production) are reported, not failed:
they are what the deploy workflow would apply.
"""
import os
import re
import sys

ALLOWLIST = os.path.join(os.path.dirname(__file__), "..", "..", "supabase", "migrations-remote-only.txt")
VERSION = re.compile(r"^\d{14}$")


def parse(table: str):
    local, remote = set(), set()
    for line in table.splitlines():
        cols = [c.strip() for c in line.split("|")]
        if len(cols) < 2:
            continue
        if VERSION.match(cols[0]):
            local.add(cols[0])
        if VERSION.match(cols[1]):
            remote.add(cols[1])
    return local, remote


def load_allowlist(path: str) -> dict:
    allowed = {}
    if os.path.exists(path):
        for line in open(path):
            line = line.split("#", 1)
            version, reason = line[0].strip(), (line[1].strip() if len(line) > 1 else "")
            if version:
                if not VERSION.match(version):
                    sys.exit(f"bad version in {path}: {version!r}")
                allowed[version] = reason
    return allowed


def main() -> int:
    table = sys.stdin.read()
    local, remote = parse(table)
    if not local and not remote:
        print("::error::could not read `supabase migration list` output")
        print(table)
        return 1

    allowed = load_allowlist(ALLOWLIST)
    remote_only = sorted(remote - local)
    drift = [v for v in remote_only if v not in allowed]
    tolerated = [v for v in remote_only if v in allowed]
    pending = sorted(local - remote)
    stale_allow = sorted(v for v in allowed if v in local or v not in remote)

    out = ["## Production migrations", ""]
    out.append(f"{len(local & remote)} applied · {len(pending)} pending · {len(drift)} drift")
    out.append("")
    if pending:
        out += ["**Pending** (would be applied by the deploy workflow):", ""]
        out += [f"- `{v}`" for v in pending] + [""]
    if drift:
        out += ["**Drift: in production but not in the repo.** Someone changed production",
                "outside a merged migration (SQL editor?). Add the change as a migration file,",
                "or record why in supabase/migrations-remote-only.txt.", ""]
        out += [f"- `{v}`" for v in drift] + [""]
    if tolerated:
        out += ["Known remote-only (allowlisted):", ""]
        out += [f"- `{v}` — {allowed[v]}" for v in tolerated] + [""]
    if stale_allow:
        out += ["Allowlist entries no longer needed (remove them):", ""]
        out += [f"- `{v}`" for v in stale_allow] + [""]

    report = "\n".join(out)
    print(report)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a") as f:
            f.write(report + "\n")
    for v in drift:
        print(f"::error::production has migration {v}, which is not in supabase/migrations")
    return 1 if drift else 0


if __name__ == "__main__":
    sys.exit(main())
