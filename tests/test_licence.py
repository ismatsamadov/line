# SPDX-FileCopyrightText: 2026 Ismat Samadov
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

"""Every Python file names its copyright and its licence in its first lines, after a script's
#! line, so the licence goes with a file copied out on its own (LICENSE, AGENTS.md)."""

import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LINES = ["# SPDX-FileCopyrightText: 2026 Ismat Samadov",
         "# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0"]


def python_files():
    """The repository's .py files: those git tracks or would add, so not the ignored emails/,
    or outside a checkout every one but those in caches and hidden folders."""
    try:
        listed = subprocess.run(["git", "ls-files", "--cached", "--others", "--exclude-standard", "*.py"],
                                capture_output=True, text=True, cwd=ROOT).stdout.splitlines()
    except OSError:                                                  # no git
        listed = []
    if listed:
        return [ROOT / p for p in sorted(listed) if (ROOT / p).is_file()]
    return [p for p in sorted(ROOT.rglob("*.py"))
            if not any(f.startswith(".") or f == "__pycache__" for f in p.relative_to(ROOT).parts[:-1])]


class LicenceLines(unittest.TestCase):
    def test_every_python_file_starts_with_them(self):
        files = python_files()
        self.assertIn(ROOT / "measure.py", files)
        for path in files:
            lines = path.read_text(encoding="utf-8").splitlines()
            if lines and lines[0].startswith("#!"):
                lines = lines[1:]
            self.assertEqual(lines[:2], LINES, path.relative_to(ROOT).as_posix())
