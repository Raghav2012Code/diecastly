/**
 * Split a SQL file into statements, each on a single line, with comments removed.
 *
 * WHY
 *
 * `postgres --single` reads stdin one line at a time and never accumulates a
 * statement across lines, so a multi-line statement — which is nearly every
 * migration, since almost all of them define a function — fails with
 * "unterminated dollar-quoted string". Verified on PostgreSQL 18.6: a multi-line
 * `$$ ... $$` body errors; the same body on one line works. There is no length
 * limit (a 20,000-character single line is fine).
 *
 * The obvious fix — collapse whitespace — is WRONG, and in two ways that both
 * corrupt SQL rather than merely reformatting it:
 *
 *  1. It rewrites string literals. `'a    b'` becomes `'a b'`.
 *
 *  2. Far worse, collapsing the newline that TERMINATES a `--` comment extends
 *     that comment over the rest of the statement. A function body containing
 *
 *         end if;
 *         -- Deterministic lock order avoids deadlocks.
 *         for v_item in ...
 *
 *     becomes one long `--` comment that swallows the closing `$$`, and
 *     PostgreSQL reports the deeply misleading "syntax error at end of input".
 *     That is not hypothetical: it is exactly how the Diecastly migrations
 *     failed the first time this was run.
 *
 * So comments are not flattened, they are REMOVED — which is semantically safe,
 * since a comment has no meaning to the server. Strings are never touched at
 * all, so `'--'` and `'/*'` inside a literal survive intact.
 *
 * A newline inside a string literal cannot be removed without changing the
 * value, so it is refused rather than silently rewritten.
 */

/** Thrown when the input cannot be flattened to one line without changing it. */
export class UnsupportedSql extends Error {}

// Built from char codes: writing these as escapes proved fragile across shells,
// and they must be STRINGS - sql[i] is a one-character string, so comparing it
// against a numeric char code silently never matches.
const SQ = String.fromCharCode(39); // '
const DQ = String.fromCharCode(34); // "
const DASH2 = String.fromCharCode(45).repeat(2); // --
const SLASH_STAR = String.fromCharCode(47, 42);
const STAR_SLASH = String.fromCharCode(42, 47);
const WS = /\s/;

export function splitStatements(sql) {
  const statements = [];
  let current = "";
  let i = 0;
  const n = sql.length;

  // normal | line | block | single | double | dollar | dollarSingle
  let state = "normal";
  let returnState = "normal"; // where a comment resumes
  let dollarTag = "";
  let blockDepth = 0;

  const space = () => {
    if (current.length > 0 && !current.endsWith(" ")) current += " ";
  };

  /** Drop a comment, leaving a space so tokens cannot be glued together. */
  const dropComment = (nextState) => {
    space();
    returnState = nextState;
    state = "line";
  };

  while (i < n) {
    const ch = sql[i];
    const next = sql[i + 1];

    /* ---- inside a string literal or quoted identifier: never rewrite ---- */
    if (state === "single" || state === "double" || state === "dollarSingle") {
      if (ch === "\n" || ch === "\r") {
        const what = state === "double" ? "quoted identifier" : "string literal";
        throw new UnsupportedSql(
          `newline inside a ${what} at offset ${i}; it cannot be flattened to a ` +
            `single line without changing its value`,
        );
      }
      current += ch;
      const closer = state === "double" ? DQ : SQ;
      if (ch === closer) {
        // A doubled closer is an escape, not a terminator.
        if (next === closer) {
          current += next;
          i += 2;
          continue;
        }
        state = state === "dollarSingle" ? "dollar" : "normal";
      }
      i += 1;
      continue;
    }

    /* ---- inside a comment: discard everything ---- */
    if (state === "line") {
      if (ch === "\n" || ch === "\r") state = returnState;
      i += 1;
      continue;
    }

    if (state === "block") {
      if (ch === SLASH_STAR[0] && next === SLASH_STAR[1]) {
        blockDepth += 1;
        i += 2;
        continue;
      }
      if (ch === STAR_SLASH[0] && next === STAR_SLASH[1]) {
        blockDepth -= 1;
        i += 2;
        if (blockDepth === 0) state = returnState;
        continue;
      }
      i += 1;
      continue;
    }

    /* ---- dollar-quoted body: code, so collapse whitespace and drop comments,
            but still track string literals so their contents survive ---- */
    if (state === "dollar") {
      if (ch === "$" && sql.startsWith(dollarTag, i)) {
        current += dollarTag;
        i += dollarTag.length;
        state = "normal";
        continue;
      }
      if (ch === SQ) {
        state = "dollarSingle";
        current += ch;
        i += 1;
        continue;
      }
      // A comment inside a function body is exactly what breaks naive
      // flattening, so it has to be recognised here too.
      if (ch === DASH2[0] && next === DASH2[1]) {
        dropComment("dollar");
        i += 2;
        continue;
      }
      if (ch === SLASH_STAR[0] && next === SLASH_STAR[1]) {
        space();
        returnState = "dollar";
        state = "block";
        blockDepth = 1;
        i += 2;
        continue;
      }
      if (WS.test(ch)) {
        space();
        i += 1;
        continue;
      }
      current += ch;
      i += 1;
      continue;
    }

    /* ---- normal ---- */
    if (ch === DASH2[0] && next === DASH2[1]) {
      dropComment("normal");
      i += 2;
      continue;
    }
    if (ch === SLASH_STAR[0] && next === SLASH_STAR[1]) {
      space();
      returnState = "normal";
      state = "block";
      blockDepth = 1;
      i += 2;
      continue;
    }
    if (ch === SQ) {
      state = "single";
      current += ch;
      i += 1;
      continue;
    }
    if (ch === DQ) {
      state = "double";
      current += ch;
      i += 1;
      continue;
    }
    if (ch === "$") {
      const match = /^\$[A-Za-z_0-9]*\$/.exec(sql.slice(i));
      if (match) {
        dollarTag = match[0];
        state = "dollar";
        current += dollarTag;
        i += dollarTag.length;
        continue;
      }
    }
    if (ch === ";") {
      const trimmed = current.trim();
      if (trimmed.length > 0) statements.push(`${trimmed};`);
      current = "";
      i += 1;
      continue;
    }
    if (WS.test(ch)) {
      space();
      i += 1;
      continue;
    }
    current += ch;
    i += 1;
  }

  if (["dollar", "single", "double", "dollarSingle", "block"].includes(state)) {
    throw new UnsupportedSql(`input ended while still inside a ${state} construct`);
  }

  const tail = current.trim();
  if (tail.length > 0) statements.push(`${tail};`);
  return statements;
}

/** A whole file as single-line, comment-free statements, ready for --single. */
export function flatten(sql) {
  const out = splitStatements(sql);
  return out.length === 0 ? "" : `${out.join("\n")}\n`;
}
