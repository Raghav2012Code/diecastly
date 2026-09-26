import { describe, expect, it } from "vitest";
import { flatten, splitStatements, UnsupportedSql } from "../../scripts/sql-split.mjs";

describe("splitStatements", () => {
  it("returns one statement per semicolon, each on a single line", () => {
    const out = splitStatements("select 1;\nselect 2;\n");
    expect(out).toEqual(["select 1;", "select 2;"]);
    for (const statement of out) expect(statement).not.toContain("\n");
  });

  it("keeps a multi-line function body intact as one statement", () => {
    // The case postgres --single cannot handle unaided.
    const sql = `
      create or replace function public.f() returns int
      language sql
      as $$
        select 1
      $$;
    `;
    const out = splitStatements(sql);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("$$ select 1 $$");
    expect(out[0]).not.toContain("\n");
  });

  it("does not split on a semicolon inside a dollar-quoted body", () => {
    const sql = "create function f() returns void as $$ begin perform g(); end; $$ language plpgsql;";
    expect(splitStatements(sql)).toHaveLength(1);
  });

  it("handles a tagged dollar quote", () => {
    const sql = "do $body$ begin raise notice 'x;y'; end $body$; select 1;";
    expect(splitStatements(sql)).toEqual(["do $body$ begin raise notice 'x;y'; end $body$;", "select 1;"]);
  });

  it("does not split on a semicolon inside a string literal", () => {
    expect(splitStatements("insert into t values ('a;b');")).toEqual(["insert into t values ('a;b');"]);
  });

  it("does not split on a semicolon inside a quoted identifier", () => {
    expect(splitStatements('create table "we;ird" (a int);')).toEqual([
      'create table "we;ird" (a int);',
    ]);
  });

  it("preserves runs of spaces inside a string literal", () => {
    // The corruption the naive "collapse all whitespace" fix would cause.
    expect(splitStatements("insert into t values ('a    b');")).toEqual([
      "insert into t values ('a    b');",
    ]);
  });

  it("preserves an escaped quote inside a string literal", () => {
    expect(splitStatements("select 'it''s; fine';")).toEqual(["select 'it''s; fine';"]);
  });

  it("ignores semicolons inside line comments", () => {
    expect(splitStatements("-- a; comment\nselect 1;")).toEqual(["select 1;"]);
  });

  it("REMOVES a line comment rather than flattening across it", () => {
    // The bug that stopped the migrations applying. Collapsing the newline that
    // terminates a `--` comment extends the comment over the rest of the
    // statement, so it swallows the closing `$$` and PostgreSQL reports the
    // misleading "syntax error at end of input". Comments must be dropped, not
    // reflowed.
    const sql = [
      "create function f() returns void as $$",
      "begin",
      "  perform g();",
      "  -- a comment that must not swallow the rest",
      "  perform h();",
      "end;",
      "$$ language plpgsql;",
    ].join("\n");

    const out = splitStatements(sql);
    expect(out).toHaveLength(1);
    expect(out[0]).not.toContain("--");
    expect(out[0]).toContain("perform g();");
    expect(out[0]).toContain("perform h();");
    expect(out[0].endsWith("$$ language plpgsql;")).toBe(true);
  });

  it("removes a comment inside a dollar-quoted body", () => {
    const sql = "do $$ begin -- note; here\n perform 1; end $$;";
    const out = splitStatements(sql);
    expect(out).toHaveLength(1);
    expect(out[0]).not.toContain("--");
    expect(out[0]).toContain("perform 1;");
  });

  it("removes a block comment inside a dollar-quoted body", () => {
    const sql = "do $$ begin /* note; here */ perform 1; end $$;";
    const out = splitStatements(sql);
    expect(out).toHaveLength(1);
    expect(out[0]).not.toContain("/*");
    expect(out[0]).toContain("perform 1;");
  });

  it("keeps comment characters that are inside a string literal", () => {
    // Dropping comments must not reach inside quotes.
    expect(splitStatements("select '-- not a comment';")).toEqual(["select '-- not a comment';"]);
    expect(splitStatements("select '/* nor this */';")).toEqual(["select '/* nor this */';"]);
  });

  it("keeps comment characters inside a string literal within a function body", () => {
    const sql = "do $$ begin raise notice '-- keep me'; end $$;";
    const out = splitStatements(sql);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("'-- keep me'");
  });

  it("does not merge the tokens either side of a removed comment", () => {
    expect(splitStatements("select a -- note\nfrom t;")).toEqual(["select a from t;"]);
  });

  it("removes comments between statements", () => {
    expect(splitStatements("select 1; -- one\nselect 2; -- two\n")).toEqual([
      "select 1;",
      "select 2;",
    ]);
  });

  it("ignores semicolons inside block comments, including nesting", () => {
    expect(splitStatements("/* a; b /* nested; */ still; */ select 1;")).toEqual(["select 1;"]);
  });

  it("collapses newlines between tokens in normal state", () => {
    expect(splitStatements("select\n  a,\n  b\nfrom t;")).toEqual(["select a, b from t;"]);
  });

  it("drops empty statements from consecutive semicolons", () => {
    expect(splitStatements("select 1;;\n;select 2;")).toEqual(["select 1;", "select 2;"]);
  });

  it("appends a terminator to a final statement with no semicolon", () => {
    expect(splitStatements("select 1")).toEqual(["select 1;"]);
  });

  it("refuses a newline inside a string literal rather than corrupting it", () => {
    // There is no way to flatten this without changing the value, so it must be
    // an explicit failure, not a silent rewrite.
    expect(() => splitStatements("insert into t values ('line1\nline2');")).toThrow(UnsupportedSql);
  });

  it("refuses input that ends inside an unterminated construct", () => {
    expect(() => splitStatements("create function f() as $$ select 1")).toThrow(UnsupportedSql);
    expect(() => splitStatements("select 'unterminated")).toThrow(UnsupportedSql);
  });

  it("handles an empty file", () => {
    expect(splitStatements("")).toEqual([]);
    expect(splitStatements("\n\n-- just a comment\n")).toEqual([]);
  });
});

describe("flatten", () => {
  it("produces a single-line-per-statement document", () => {
    const out = flatten("create function f() returns int as $$\n select 1\n$$;\nselect 2;\n");
    const lines = out.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("$$ select 1 $$");
    expect(lines[1]).toBe("select 2;");
  });
});
