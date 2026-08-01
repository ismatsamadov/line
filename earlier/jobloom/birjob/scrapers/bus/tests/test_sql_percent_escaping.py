"""Every execute_values() query in this package must be %-clean.

The bug this pins (2026-07-31 → 2026-08-01, three consecutive scheduled runs
lost): the #472 chunked-save commit added a prose SQL comment

    -- branch fires for ~98% of rows, so using NOW()

inside the jobs scraper's upsert. psycopg2.extras.execute_values does not send
the query as-is — it regex-splits it on `(%.)` to find the single `VALUES %s`,
and raises

    ValueError: unsupported format character: ' '

for any token that is neither %s nor %%. That fires client-side, BEFORE a single
row reaches Postgres, so the entire save aborts: 16,531 jobs scraped and none
written, three times over, with no partial data to show for it.

Nothing caught it. It is not a syntax error, ruff has no opinion on the inside of
a string, and the save tests mock execute_values away — which is exactly what
hides _split_sql from them.

Six execute_values call sites here (stops, buses, routes, and the join
tables) — a bare % in any of them aborts the whole AYNA transit refresh.
"""
import ast
import re
import warnings
from pathlib import Path

import pytest

try:
    # The parser this whole file exists to pin. Private on purpose: reimplementing
    # its rules is what the first version of this test got wrong (it counted
    # `%s` with a regex, which counts the 's' in `%%s` and so passed the
    # over-escape typo it claimed to catch). Call the real thing instead — an
    # upstream rename fails loudly here, which is the correct signal.
    from psycopg2.extras import _split_sql
except ImportError:  # pragma: no cover
    _split_sql = None

PKG = Path(__file__).resolve().parent.parent
SKIP_PARTS = {'.venv', 'site-packages', '__pycache__', 'node_modules'}
# Mirrors psycopg2's own `_re.split(br'(%.)', sql)` — deliberately NOT re.DOTALL,
# so a '%' at end of line is tolerated here exactly as it is in production.
TOKEN = re.compile(r'%(.)')


def _iter_py():
    for path in sorted(PKG.rglob('*.py')):
        if SKIP_PARTS & set(path.parts):
            continue
        yield path


def _literal_text(node):
    """Flatten a str constant / f-string / '+'-concat into its literal text.

    Interpolated f-string expressions are dropped: in the queries here they are
    column lists built from constants, which cannot contain '%'.
    """
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    if isinstance(node, ast.JoinedStr):
        return ''.join(
            v.value for v in node.values
            if isinstance(v, ast.Constant) and isinstance(v.value, str)
        )
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
        return (_literal_text(node.left) or '') + (_literal_text(node.right) or '')
    return None


def _string_assignments(tree):
    """name -> [literal text, ...] for every `name = "sql"` in the module."""
    out = {}
    for node in ast.walk(tree):
        if not isinstance(node, ast.Assign):
            continue
        text = _literal_text(node.value)
        if text is None:
            continue
        for target in node.targets:
            if isinstance(target, ast.Name):
                out.setdefault(target.id, []).append(text)
    return out


def _resolve(node, assignments):
    """The SQL behind an execute_values argument, literal or via a variable.

    Returns [None] when the argument is some shape this scanner cannot read
    (`textwrap.dedent(...)`, `"".format(...)`, `sql += ...`). That becomes a
    FAILING case rather than silent zero coverage — a call site that quietly
    contributes no assertions is how this class of bug reaches production.
    """
    text = _literal_text(node)
    if text is not None:
        return [text]
    if isinstance(node, ast.Name):
        return assignments.get(node.id) or [None]
    return [None]


def _execute_values_sql():
    """(path, lineno, kind, sql) for every execute_values query/template found."""
    found = []
    for path in _iter_py():
        with warnings.catch_warnings():
            # Regex-ish escapes in unrelated docstrings are not this test's
            # business (DeprecationWarning <=3.11, SyntaxWarning from 3.12).
            warnings.simplefilter('ignore', DeprecationWarning)
            warnings.simplefilter('ignore', SyntaxWarning)
            tree = ast.parse(path.read_text(encoding='utf-8'))
        assignments = _string_assignments(tree)
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            func = node.func
            name = func.attr if isinstance(func, ast.Attribute) else getattr(func, 'id', None)
            if name != 'execute_values':
                continue
            # execute_values(cur, sql, argslist, template=..., ...)
            if len(node.args) >= 2:
                for sql in _resolve(node.args[1], assignments):
                    found.append((path, node.lineno, 'query', sql))
            for kw in node.keywords:
                if kw.arg == 'template':
                    for sql in _resolve(kw.value, assignments):
                        found.append((path, node.lineno, 'template', sql))
    return found


_CASES = _execute_values_sql()


def _IDS(value):
    """Readable case ids: `base_scraper.py-2166-query-sql`."""
    if isinstance(value, Path):
        return value.name
    if isinstance(value, str) and len(value) > 24:
        return 'sql'
    return str(value)


def test_the_scan_actually_finds_the_call_sites():
    """A silent zero-match scan would make everything below vacuously green.

    Only the query is required: passing `template=` is optional (psycopg2 builds
    one from the row width when it is omitted, as events/ and bus/ do), so a
    template case is asserted on where it exists, not demanded everywhere.
    """
    assert any(kind == 'query' for _, _, kind, _ in _CASES), (
        'no execute_values query found — the AST scan has drifted from the code'
    )


@pytest.mark.parametrize('path,lineno,kind,sql', _CASES, ids=_IDS)
def test_no_bare_percent_in_execute_values_sql(path, lineno, kind, sql):
    """Only %s and %% survive psycopg2's client-side split."""
    assert sql is not None, (
        f'{path.name}:{lineno} — this execute_values {kind} is built in a shape '
        f'the scanner cannot read, so it is NOT covered. Assign it to a plain '
        f'string variable, or teach _resolve() the new shape.'
    )
    for m in TOKEN.finditer(sql):
        if m.group(1) in ('s', '%'):
            continue
        context = sql[max(0, m.start() - 70):m.start() + 30].replace('\n', ' ⏎ ')
        pytest.fail(
            f"{path.name}:{lineno} {kind} contains a bare '%{m.group(1)}' — "
            f"execute_values raises ValueError before writing any row. "
            f"Escape it as %% or move the prose into a Python comment.\n…{context.strip()}…"
        )


@pytest.mark.parametrize('path,lineno,kind,sql',
                         [c for c in _CASES if c[2] == 'query' and c[3] is not None],
                         ids=_IDS)
def test_query_survives_the_real_psycopg2_parser(path, lineno, kind, sql):
    """The whole contract in one call, straight from psycopg2.

    _split_sql is what execute_values runs before touching the network, and it
    has three ways to kill a save: a bare '%', more than one '%s', or none at
    all. Delegating catches all three plus any future rule, with no chance of
    the check drifting from the parser it is meant to mirror.
    """
    assert _split_sql is not None, (
        'psycopg2.extras._split_sql is gone — point this test at the new parser'
    )
    try:
        _split_sql(sql.encode('utf-8'))
    except ValueError as e:
        pytest.fail(f'{path.name}:{lineno} — execute_values would abort the whole save: {e}')
