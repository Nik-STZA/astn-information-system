"""Google Drive output for the Cloud Run job.

The job runs as its own service account (Application Default Credentials), so
it can write only to shared drives that account has been added to. Folders are
found by exact name within ONE shared drive and created when missing: names like
"FY27" and "2608" repeat across drives, so nothing is ever searched globally.
"""

from __future__ import annotations

from pathlib import Path

FOLDER_MIME = "application/vnd.google-apps.folder"
DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive"]


def drive_service():
    import google.auth
    from googleapiclient.discovery import build
    creds, _ = google.auth.default(scopes=DRIVE_SCOPES)
    return build("drive", "v3", credentials=creds, cache_discovery=False)


def _quote(s: str) -> str:
    return s.replace("\\", "\\\\").replace("'", "\\'")


def output_folder_path(template: list[str], *, fy: str, period: str) -> list[str]:
    """Expand a profile's folder path: {fy} -> FY27, {yymm} -> 2608 for August 2026."""
    yymm = period[2:4] + period[5:7]
    return [part.format(fy=fy, yymm=yymm) for part in template]


def ensure_folder_path(svc, drive_id: str, path: list[str]) -> str:
    """The id of drive/path[0]/path[1]/..., creating any folder that is missing."""
    parent = drive_id                         # a shared drive's id is its root folder's id
    for name in path:
        q = (f"'{parent}' in parents and name = '{_quote(name)}' and trashed = false "
             f"and mimeType = '{FOLDER_MIME}'")
        found = svc.files().list(q=q, fields="files(id)", pageSize=2, corpora="drive", driveId=drive_id,
                                 includeItemsFromAllDrives=True, supportsAllDrives=True).execute()["files"]
        if found:
            parent = found[0]["id"]
        else:
            parent = svc.files().create(body={"name": name, "mimeType": FOLDER_MIME, "parents": [parent]},
                                        fields="id", supportsAllDrives=True).execute()["id"]
    return parent


def upload(svc, folder_id: str, path: Path, name: str | None = None) -> dict:
    from googleapiclient.http import MediaFileUpload
    return svc.files().create(body={"name": name or path.name, "parents": [folder_id]},
                              media_body=MediaFileUpload(str(path), resumable=True),
                              fields="id,webViewLink", supportsAllDrives=True).execute()
