"""CSV tables as every script writes them: UTF-8 with a byte-order mark, so that Excel shows
ə, ş and ç correctly, floats rounded to 4 decimals, and no file for a table without rows (a
run removes the one an earlier run left in the folder, so no file means no rows)."""

import csv
from pathlib import Path


def write_csv(path, rows):
    """One row per dict, under the first row's keys."""
    if not rows:
        Path(path).unlink(missing_ok=True)
        return
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        for r in rows:
            w.writerow({k: (round(v, 4) if isinstance(v, float) else v) for k, v in r.items()})
