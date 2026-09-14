"""Cloud Run Job entrypoint: build a pack, save it to Drive, tell the portal.

    python -m pack_engine.job

Environment:
  RUN_ID            the portal's report run (finance-api starts the job with it)
  CLIENT_SLUG       e.g. stza
  PERIOD            YYYY-MM
  FINANCE_API_URL, FINANCE_API_KEY
Without RUN_ID the job builds and saves but does not report back, which is how
to test it by hand.

A pack whose controls fail is still saved, named FAILED CONTROLS, and the run is
reported failed with the files attached, so the reviewer can open it.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import time
import traceback
from datetime import datetime
from pathlib import Path

import requests

from . import ENGINE_VERSION
from .build import build, load_profile
from .fiscal import FiscalCalendar

LOG_LIMIT = 8000


class _Log:
    def __init__(self):
        self.lines: list[str] = []

    def __call__(self, msg: str):
        line = f"[engine] {msg}"
        print(line, flush=True)
        self.lines.append(line)

    def tail(self) -> str:
        return "\n".join(self.lines)[-LOG_LIMIT:]


def report(body: dict, log: _Log) -> None:
    run_id = os.environ.get("RUN_ID", "").strip()
    if not run_id:
        log("RUN_ID not set: not reporting to finance-api")
        return
    base = os.environ["FINANCE_API_URL"].rstrip("/")
    for attempt in range(1, 6):
        try:
            r = requests.post(f"{base}/api/finance/report-runs/{run_id}/complete", json=body, timeout=60,
                              headers={"X-API-Key": os.environ["FINANCE_API_KEY"]})
            if r.status_code < 500:
                if r.status_code >= 400:
                    log(f"finance-api refused the completion: {r.status_code} {r.text[:300]}")
                return
        except requests.RequestException as e:
            log(f"completion attempt {attempt} failed: {e}")
        time.sleep(5 * attempt)


def run(*, drive=None, now: datetime | None = None) -> int:
    log = _Log()
    started = time.monotonic()
    ms = lambda: int((time.monotonic() - started) * 1000)
    client = os.environ.get("CLIENT_SLUG", "").strip()
    period = os.environ.get("PERIOD", "").strip()
    try:
        if not client or not period:
            raise RuntimeError("CLIENT_SLUG and PERIOD must be set on the job")
        profile = load_profile(client)
        output = profile.get("output") or {}
        if not output.get("drive_id") or not output.get("folder_path"):
            raise RuntimeError(f"The {client} pack profile has no Drive output set")
        log(f"building {client} {period} with pack engine {ENGINE_VERSION}")

        with tempfile.TemporaryDirectory(prefix="pack-") as tmp:
            result = build(client, period, Path(tmp), now=now)
            for c in result.controls:
                if c.status != "pass":
                    log(f"control {c.status.upper()}: {c.label}" + (f" - {c.detail}" if c.detail else ""))
            log(f"{len(result.controls) - len(result.failed)} of {len(result.controls)} controls passed or warned")

            from . import drive as gdrive
            svc = drive or gdrive.drive_service()
            fy = FiscalCalendar(profile["year_end_month"]).label(period)
            path = gdrive.output_folder_path(output["folder_path"], fy=fy, period=period)
            folder = gdrive.ensure_folder_path(svc, output["drive_id"], path)
            saved = []
            for f in (result.path, result.path.with_name(result.path.stem + " - controls.json")):
                meta = gdrive.upload(svc, folder, f)
                saved.append({"name": f.name, "path": meta.get("webViewLink", "")})
                log(f"saved {f.name} to {' / '.join(path)}")

        failed = result.failed
        body = {"status": "failed" if failed else "succeeded", "durationMs": ms(),
                "outputFiles": saved, "logTail": log.tail()}
        if failed:
            body["error"] = ("The pack was built and saved, but controls failed: "
                             + "; ".join(c.label for c in failed))[:2000]
        report(body, log)
        return 3 if failed else 0
    except Exception as e:                      # report every failure; never leave a run hanging
        log(f"FAILED: {e}")
        for line in traceback.format_exc().splitlines()[-8:]:
            log(line)
        report({"status": "failed", "durationMs": ms(), "error": str(e)[:2000], "logTail": log.tail()}, log)
        return 1


if __name__ == "__main__":
    sys.exit(run())
