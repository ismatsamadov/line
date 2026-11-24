# SPDX-FileCopyrightText: 2026 Ismat Samadov
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

"""Settings from a TOML file, so assumptions and data paths change without editing code.

A config file has a [data] table of file paths and any number of other tables whose
keys are Assumptions fields; the table names only group them for readers. Tables such
as headway_by_zone are merged with the defaults, so one entry can be changed alone.
Unknown keys are an error, so a typo cannot be silently ignored."""

import os
import tomllib
from dataclasses import fields, replace
from pathlib import Path

from .assumptions import Assumptions

DATA_KEYS = ("db", "gtfs", "population", "ridership", "headways", "destinations", "metro_passengers", "metro_exits",
             "walk_network", "bicycle_lanes", "bicycle_parking")


def parse_value(text):
    """A TOML value from the command line: 12, 0.5, true, "text" or {a = 1}; bare words stay text."""
    try:
        return tomllib.loads(f"v = {text}")["v"]
    except tomllib.TOMLDecodeError:
        return text.strip()


def settings_file(name):
    """The settings file a script's --config names, or None for "none", the built-in defaults.
    A name that is not a file stops the script with a settings error naming it, before
    anything is written, so a mistyped name cannot give results for the defaults."""
    if name.lower() == "none":
        return None
    if not Path(name).is_file():
        raise SystemExit(f"Settings error: no settings file at {name} (--config none uses the built-in defaults)")
    return name


def load_config(path=None, overrides=()):
    """(Assumptions, {data key: path}) from an optional TOML file and "name=value" overrides.

    Relative data paths in the file are read relative to the file's own folder."""
    raw, base = {}, Path(".")
    if path:
        with open(path, "rb") as f:
            raw = tomllib.load(f)
        base = Path(path).resolve().parent
    settings, data = {}, {}
    for section, values in raw.items():
        if section == "data":
            data.update({k: _resolve(base, v) for k, v in values.items()})
        elif isinstance(values, dict) and section not in _DICT_FIELDS:
            settings.update(values)
        else:
            settings[section] = values
    for item in overrides:
        key, sep, value = item.partition("=")
        if not sep:
            raise ValueError(f"--set needs name=value, got {item!r}")
        key = key.strip()
        if key in DATA_KEYS:
            data[key] = _resolve(Path("."), parse_value(value))
        else:
            settings[key] = parse_value(value)

    unknown = sorted(set(data) - set(DATA_KEYS)) + sorted(set(settings) - _FIELDS)
    if unknown:
        raise ValueError(f"unknown setting(s): {', '.join(unknown)}. "
                         f"Data keys: {', '.join(DATA_KEYS)}. Assumptions: {', '.join(sorted(_FIELDS))}")
    defaults = Assumptions()
    for key in _DICT_FIELDS & set(settings):
        settings[key] = {**getattr(defaults, key), **settings[key]}
    for key in _TEXT_FIELDS & set(settings):          # TOML reads gtfs_date = 2026-11-25 as a date
        settings[key] = str(settings[key])
    return replace(defaults, **settings), data


def _resolve(base, value):
    if isinstance(value, list):
        return [_resolve(base, v) for v in value]
    p = Path(value)
    return os.path.normpath(p if p.is_absolute() else base / p)       # a city's "../data/..." becomes ".../data/..."


_FIELDS = {f.name for f in fields(Assumptions)}
_DICT_FIELDS = {f.name for f in fields(Assumptions) if isinstance(getattr(Assumptions(), f.name), dict)}
_TEXT_FIELDS = {f.name for f in fields(Assumptions) if isinstance(getattr(Assumptions(), f.name), str)}
