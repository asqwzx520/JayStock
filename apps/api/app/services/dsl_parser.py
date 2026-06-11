"""
DSL parser for backtest entry/exit conditions (P2-8).

Grammar:
    expr       ::= and_expr (OR and_expr)*
    and_expr   ::= not_expr (AND not_expr)*
    not_expr   ::= NOT not_expr | atom
    atom       ::= '(' expr ')' | operand (OP operand)?
    operand    ::= func_call | IDENT | NUMBER
    func_call  ::= IDENT '(' [args] ')'
    args       ::= operand (',' operand)*

Allowed fields: close, open, high, low, volume, ma5/10/20/60, ema12/26,
    rsi14, k, d, macd, macd_s, bb_upper/middle/lower, P2-7 cross-day fields,
    EPS / revenue fundamentals.

Allowed functions: ma(N), ema(N), rsi(N), shift(field, N),
    cross_above(a,b), cross_below(a,b), highest(field,N), lowest(field,N)

No eval() is used anywhere; the parser builds an explicit AST.
"""

from __future__ import annotations

import re
from typing import Any

import pandas as pd


# ── Whitelist ──────────────────────────────────────────────────────────────────

ALLOWED_FIELDS: frozenset[str] = frozenset({
    # 價量
    "close", "open", "high", "low", "volume",
    # 均線
    "ma5", "ma10", "ma20", "ma60", "ema12", "ema26",
    # 動能
    "rsi14", "k", "d", "macd", "macd_s",
    # 通道
    "bb_upper", "bb_middle", "bb_lower",
    # P2-7 跨日量價
    "vol_ratio", "consec_up", "consec_down",
    "body_pct", "upper_wick_pct", "lower_wick_pct",
    "is_52w_high", "consec_52w_hi",
    # P2-7 K棒形態
    "hammer", "shooting_star", "doji", "bull_engulf", "bear_engulf",
    # 基本面
    "eps_ttm", "eps_quarterly", "eps_quarterly_yoy", "eps_quarterly_qoq",
    "revenue", "revenue_yoy", "revenue_mom", "revenue_annual", "revenue_annual_yoy",
})

ALLOWED_FUNCTIONS: frozenset[str] = frozenset({
    "ma", "ema", "rsi",
    "shift", "highest", "lowest",
    "cross_above", "cross_below",
})


class DSLError(ValueError):
    """Raised on parse or evaluation errors."""


# ── Tokenizer ──────────────────────────────────────────────────────────────────

_TOKEN_RE = re.compile(
    r"(?P<NUMBER>-?\d+(?:\.\d+)?)"
    r"|(?P<OP>>=|<=|==|!=|>|<|=)"
    r"|(?P<LPAREN>\()"
    r"|(?P<RPAREN>\))"
    r"|(?P<COMMA>,)"
    r"|(?P<WORD>[A-Za-z_][A-Za-z0-9_]*)"
    r"|(?P<WS>\s+)"
    r"|(?P<COMMENT>#[^\n]*)",
)


def _tokenize(text: str) -> list[tuple[str, str]]:
    toks: list[tuple[str, str]] = []
    matched = 0
    for m in _TOKEN_RE.finditer(text):
        matched += len(m.group())
        kind = m.lastgroup
        if kind in ("WS", "COMMENT"):
            continue
        val = m.group()
        if kind == "WORD":
            upper = val.upper()
            if upper in ("AND", "OR", "NOT"):
                toks.append((upper, upper))
                continue
        toks.append((kind, val))
    if matched != len(text):
        raise DSLError("Expression contains invalid characters")
    return toks


# ── AST Nodes ──────────────────────────────────────────────────────────────────

class _Node:
    __slots__ = ()

    def eval(self, df: pd.DataFrame) -> Any:  # pragma: no cover
        raise NotImplementedError


class _Num(_Node):
    __slots__ = ("val",)

    def __init__(self, val: float) -> None:
        self.val = val

    def eval(self, df: pd.DataFrame) -> float:
        return self.val


class _Field(_Node):
    __slots__ = ("name",)

    def __init__(self, name: str) -> None:
        self.name = name

    def eval(self, df: pd.DataFrame) -> pd.Series:
        if self.name not in df.columns:
            return pd.Series(float("nan"), index=df.index, dtype=float)
        return df[self.name]


class _Cmp(_Node):
    __slots__ = ("op", "left", "right")

    def __init__(self, op: str, left: _Node, right: _Node) -> None:
        self.op, self.left, self.right = op, left, right

    def eval(self, df: pd.DataFrame) -> pd.Series:
        lv = self.left.eval(df)
        rv = self.right.eval(df)
        if self.op == ">":
            return lv > rv
        if self.op == "<":
            return lv < rv
        if self.op == ">=":
            return lv >= rv
        if self.op == "<=":
            return lv <= rv
        if self.op in ("==", "="):
            return lv == rv
        if self.op == "!=":
            return lv != rv
        raise DSLError(f"Unknown operator: {self.op}")


class _Truthy(_Node):
    """Wraps a node that is already boolean (e.g. cross_above result)."""
    __slots__ = ("inner",)

    def __init__(self, inner: _Node) -> None:
        self.inner = inner

    def eval(self, df: pd.DataFrame) -> pd.Series:
        v = self.inner.eval(df)
        if isinstance(v, pd.Series):
            return v.astype(bool)
        return pd.Series(bool(v), index=df.index)


class _And(_Node):
    __slots__ = ("children",)

    def __init__(self, children: list[_Node]) -> None:
        self.children = children

    def eval(self, df: pd.DataFrame) -> pd.Series:
        result = self.children[0].eval(df)
        for c in self.children[1:]:
            result = result & c.eval(df)
        return result


class _Or(_Node):
    __slots__ = ("children",)

    def __init__(self, children: list[_Node]) -> None:
        self.children = children

    def eval(self, df: pd.DataFrame) -> pd.Series:
        result = self.children[0].eval(df)
        for c in self.children[1:]:
            result = result | c.eval(df)
        return result


class _Not(_Node):
    __slots__ = ("inner",)

    def __init__(self, inner: _Node) -> None:
        self.inner = inner

    def eval(self, df: pd.DataFrame) -> pd.Series:
        v = self.inner.eval(df)
        if isinstance(v, pd.Series):
            return ~v.astype(bool)
        return pd.Series(not bool(v), index=df.index)


class _Func(_Node):
    __slots__ = ("name", "args")

    def __init__(self, name: str, args: list[_Node]) -> None:
        self.name = name
        self.args = args

    def _series(self, node: _Node, df: pd.DataFrame) -> pd.Series:
        v = node.eval(df)
        if isinstance(v, pd.Series):
            return v
        return pd.Series(v, index=df.index, dtype=float)

    def _int(self, node: _Node, df: pd.DataFrame) -> int:
        v = node.eval(df)
        if isinstance(v, pd.Series):
            raise DSLError(f"{self.name}(): period argument must be a number")
        return max(1, int(v))

    def eval(self, df: pd.DataFrame) -> pd.Series:
        n = self.name

        if n == "ma":
            period = self._int(self.args[0], df)
            return df["close"].rolling(period).mean()

        if n == "ema":
            period = self._int(self.args[0], df)
            return df["close"].ewm(span=period, adjust=False).mean()

        if n == "rsi":
            period = self._int(self.args[0], df)
            delta = df["close"].diff()
            gain = delta.clip(lower=0).rolling(period).mean()
            loss = (-delta.clip(upper=0)).rolling(period).mean()
            rs = gain / loss.replace(0, float("nan"))
            return 100 - 100 / (1 + rs)

        if n == "shift":
            s = self._series(self.args[0], df)
            k = self._int(self.args[1], df)
            return s.shift(k)

        if n == "highest":
            s = self._series(self.args[0], df)
            k = self._int(self.args[1], df)
            return s.rolling(k).max()

        if n == "lowest":
            s = self._series(self.args[0], df)
            k = self._int(self.args[1], df)
            return s.rolling(k).min()

        if n == "cross_above":
            a = self._series(self.args[0], df)
            b = self._series(self.args[1], df)
            return (a > b) & (a.shift(1) <= b.shift(1))

        if n == "cross_below":
            a = self._series(self.args[0], df)
            b = self._series(self.args[1], df)
            return (a < b) & (a.shift(1) >= b.shift(1))

        raise DSLError(f"Unimplemented function: {n}")  # pragma: no cover


# ── Recursive-descent parser ───────────────────────────────────────────────────

class _Parser:
    def __init__(self, tokens: list[tuple[str, str]]) -> None:
        self._toks = tokens
        self._pos  = 0

    def _peek(self) -> tuple[str, str] | None:
        return self._toks[self._pos] if self._pos < len(self._toks) else None

    def _consume(self, kind: str | None = None) -> tuple[str, str]:
        tok = self._peek()
        if tok is None:
            raise DSLError("Unexpected end of expression")
        if kind and tok[0] != kind:
            raise DSLError(f"Expected {kind}, got '{tok[1]}'")
        self._pos += 1
        return tok

    def parse(self) -> _Node:
        node = self._parse_or()
        if self._peek() is not None:
            raise DSLError(f"Unexpected token: '{self._peek()[1]}'")  # type: ignore[index]
        return node

    def _parse_or(self) -> _Node:
        children = [self._parse_and()]
        while self._peek() and self._peek()[0] == "OR":
            self._consume("OR")
            children.append(self._parse_and())
        return children[0] if len(children) == 1 else _Or(children)

    def _parse_and(self) -> _Node:
        children = [self._parse_not()]
        while self._peek() and self._peek()[0] == "AND":
            self._consume("AND")
            children.append(self._parse_not())
        return children[0] if len(children) == 1 else _And(children)

    def _parse_not(self) -> _Node:
        if self._peek() and self._peek()[0] == "NOT":
            self._consume("NOT")
            return _Not(self._parse_not())
        return self._parse_atom()

    def _parse_atom(self) -> _Node:
        tok = self._peek()
        if tok is None:
            raise DSLError("Unexpected end of expression")

        if tok[0] == "LPAREN":
            self._consume("LPAREN")
            node = self._parse_or()
            self._consume("RPAREN")
            return node

        # operand (OP operand)?
        operand = self._parse_operand()
        tok2 = self._peek()
        if tok2 is None or tok2[0] in ("AND", "OR", "NOT", "RPAREN"):
            # Standalone boolean operand (e.g. cross_above(...))
            return _Truthy(operand)
        if tok2[0] == "OP":
            op = self._consume("OP")[1]
            right = self._parse_operand()
            return _Cmp(op, operand, right)
        raise DSLError(f"Expected operator, got '{tok2[1]}'")

    def _parse_operand(self) -> _Node:
        tok = self._peek()
        if tok is None:
            raise DSLError("Unexpected end in operand")

        if tok[0] == "NUMBER":
            self._consume("NUMBER")
            return _Num(float(tok[1]))

        if tok[0] == "WORD":
            name = tok[1].lower()
            nxt = self._toks[self._pos + 1] if self._pos + 1 < len(self._toks) else None
            if nxt and nxt[0] == "LPAREN":
                return self._parse_func_call()
            self._consume("WORD")
            if name not in ALLOWED_FIELDS:
                raise DSLError(
                    f"Unknown field '{name}'. "
                    f"Use fields like: close, ma20, rsi14, vol_ratio, hammer…"
                )
            return _Field(name)

        raise DSLError(f"Unexpected token '{tok[1]}' in expression")

    def _parse_func_call(self) -> _Func:
        name = self._consume("WORD")[1].lower()
        if name not in ALLOWED_FUNCTIONS:
            raise DSLError(
                f"Unknown function '{name}'. "
                f"Allowed: {', '.join(sorted(ALLOWED_FUNCTIONS))}"
            )
        self._consume("LPAREN")
        args: list[_Node] = []
        if self._peek() and self._peek()[0] != "RPAREN":
            args.append(self._parse_operand())
            while self._peek() and self._peek()[0] == "COMMA":
                self._consume("COMMA")
                args.append(self._parse_operand())
        self._consume("RPAREN")
        return _Func(name, args)


# ── Public API ─────────────────────────────────────────────────────────────────

def dsl_parse(text: str) -> _Node:
    """Parse DSL text → AST. Raises DSLError on invalid syntax."""
    toks = _tokenize(text.strip())
    if not toks:
        raise DSLError("Empty expression")
    return _Parser(toks).parse()


def dsl_eval(text: str, df: pd.DataFrame) -> pd.Series:
    """Parse + evaluate DSL against df → boolean Series."""
    node = dsl_parse(text)
    result = node.eval(df)
    if isinstance(result, pd.Series):
        return result.fillna(False).astype(bool)
    return pd.Series(bool(result), index=df.index)


def dsl_validate(text: str) -> dict:
    """Syntax-only validation (no DataFrame needed). Returns {ok, error}."""
    txt = text.strip()
    if not txt:
        return {"ok": False, "error": "Expression is empty"}
    try:
        dsl_parse(txt)
        return {"ok": True, "error": None}
    except DSLError as exc:
        return {"ok": False, "error": str(exc)}
