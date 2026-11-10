"""A small formula evaluator, so tests read back what Excel will show.

openpyxl keeps formulas, not results, and CI has no LibreOffice. This handles the
formulas the pack writes (references, ranges, SUM, SUMIF, IF, ABS, arithmetic) and
raises on anything else, so an unknown formula is a test failure, never a guess.
"""

from __future__ import annotations

import re

from openpyxl.utils import column_index_from_string, range_boundaries

REF = r"(?:'((?:[^']|'')+)'!)?(\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?|\$?[A-Z]{1,3}:\$?[A-Z]{1,3})"


class Sheetbook:
    def __init__(self, wb):
        self.wb, self.memo = wb, {}

    def value(self, sheet: str, coord: str):
        key = (sheet, coord)
        if key not in self.memo:
            v = self.wb[sheet][coord].value
            self.memo[key] = self._eval(sheet, v[1:]) if isinstance(v, str) and v.startswith("=") else v
        return self.memo[key]

    def number(self, sheet, coord) -> float:
        v = self.value(sheet, coord)
        return float(v) if isinstance(v, (int, float)) else 0.0

    def _range(self, sheet: str, ref: str) -> list:
        ref = ref.replace("$", "")
        ws = self.wb[sheet]
        if re.fullmatch(r"[A-Z]+:[A-Z]+", ref):
            c = column_index_from_string(ref.split(":")[0])
            return [(sheet, ws.cell(r, c).coordinate) for r in range(1, ws.max_row + 1)]
        c1, r1, c2, r2 = range_boundaries(ref)
        return [(sheet, ws.cell(r, c).coordinate) for r in range(r1, r2 + 1) for c in range(c1, c2 + 1)]

    def _eval(self, sheet: str, formula: str):
        strings: list[str] = []

        def keep(m):
            strings.append(m.group(1))
            return f"__s{len(strings) - 1}__"

        expr = re.sub(r'"([^"]*)"', keep, formula)
        refs = []

        def swap(m):
            target = (m.group(1) or sheet).replace("''", "'")
            refs.append(self._range(target, m.group(2)) if ":" in m.group(2)
                        else (target, m.group(2).replace("$", "")))
            return f"__R{len(refs) - 1}__"

        expr = re.sub(REF, swap, expr)
        unknown = set(re.findall(r"[A-Z]{2,}", re.sub(r"__[Rs]\d+__", "", expr))) - {"SUM", "SUMIF", "IF", "ABS"}
        if unknown:
            raise ValueError(f"recalc cannot evaluate {formula!r}")

        # IF(x=0,0,y) has to be lazy: y divides by x.
        guarded = re.fullmatch(r"IF\((.+?)=0,0,(.+)\)", expr)
        if guarded:
            expr = f"(0 if ({guarded[1]})==0 else ({guarded[2]}))"

        def cell_or_range(i):
            r = refs[i]
            return r if isinstance(r, list) else self.number(*r)

        def sum_(*args):
            total = 0.0
            for a in args:
                total += sum(self.number(*c) for c in a) if isinstance(a, list) else a
            return total

        def sumif(keys, wanted, values):
            # An exact-match criterion "=text" with ~ escapes, as outstanding.py writes.
            if isinstance(wanted, str) and wanted.startswith("="):
                wanted = re.sub(r"~([~*?])", lambda m: m.group(1), wanted[1:])
            return sum(self.number(*v) for k, v in zip(keys, values) if self.value(*k) == wanted)

        expr = re.sub(r"__R(\d+)__", lambda m: f"R({m.group(1)})", expr)
        expr = re.sub(r"__s(\d+)__", lambda m: repr(strings[int(m.group(1))]), expr)
        return eval(expr, {"__builtins__": {}}, {"R": cell_or_range, "SUM": sum_, "SUMIF": sumif, "ABS": abs})
