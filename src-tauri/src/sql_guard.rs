//! Decides whether a statement typed into the query editor may be sent to the
//! server. This is one of several layers (the session is read-only, the user
//! should be read-only too); it exists so a mistake is stopped before it leaves
//! the app, with a message that says why.
//!
//! The rule is an allow-list, and anything that can't be understood is refused:
//! one statement, starting with SELECT, SHOW, DESCRIBE, EXPLAIN or WITH, that
//! doesn't write files, take locks or run a statement hidden in a comment.

use std::ops::ControlFlow;

use sqlparser::ast::{Expr, LockClause, Query, Select, SetExpr, Statement, Visit, Visitor};
use sqlparser::dialect::MySqlDialect;
use sqlparser::parser::Parser;
use sqlparser::tokenizer::{Token, Tokenizer};

use crate::error::AppError;

const ALLOWED: &str = "Fogtrail runs SELECT, SHOW, DESCRIBE, EXPLAIN and WITH only. \
                       Nothing was sent to the server.";

/// Functions that change something outside the tables: named locks and files.
const BLOCKED_FUNCTIONS: [&str; 5] = [
    "GET_LOCK",
    "RELEASE_LOCK",
    "RELEASE_ALL_LOCKS",
    "LOAD_FILE",
    "SET_USER_VARIABLE",
];

fn blocked(what: &str) -> AppError {
    AppError::Blocked(format!("{what} is not allowed. {ALLOWED}"))
}

/// Ok when the statement may run. Otherwise `AppError::Blocked` with a sentence
/// the UI can show as it is.
pub fn check(sql: &str) -> Result<(), AppError> {
    let dialect = MySqlDialect {};
    let tokens = Tokenizer::new(&dialect, sql)
        .tokenize()
        .map_err(|e| AppError::Blocked(format!("Could not read this statement: {e}. {ALLOWED}")))?;

    // Executable comments (`/*! ... */`) look like comments, but the server runs
    // what is inside them, and the tokenizer reads them as plain code. Refuse them
    // outright rather than guess.
    if has_executable_comment(sql) {
        return Err(blocked("A /*! */ comment"));
    }

    // Only the words and symbols, with trailing semicolons dropped.
    let mut meaningful: Vec<&Token> = tokens
        .iter()
        .filter(|t| !matches!(t, Token::Whitespace(_) | Token::EOF))
        .collect();
    while matches!(meaningful.last(), Some(Token::SemiColon)) {
        meaningful.pop();
    }
    if meaningful.is_empty() {
        return Err(AppError::Blocked(
            "There is nothing to run. Type a statement first.".to_string(),
        ));
    }
    if meaningful.iter().any(|t| matches!(t, Token::SemiColon)) {
        return Err(blocked("Running more than one statement at once"));
    }

    let first = match meaningful[0] {
        Token::Word(w) => w.value.to_ascii_uppercase(),
        Token::LParen => "(".to_string(),
        other => return Err(blocked(&format!("Starting with `{other}`"))),
    };
    match first.as_str() {
        // SHOW and DESCRIBE only ever read, so they don't need the full parse. That
        // keeps odd SHOW forms working (SHOW ENGINE INNODB STATUS, SHOW GRANTS).
        "SHOW" | "DESCRIBE" | "DESC" => Ok(()),
        "SELECT" | "WITH" | "EXPLAIN" | "(" => {
            // INTO only has a place in a write (SELECT ... INTO OUTFILE). The parser
            // doesn't read every form of it, so catch it here.
            let has_into = meaningful.iter().any(|t| {
                matches!(t, Token::Word(w)
                    if w.quote_style.is_none() && w.value.eq_ignore_ascii_case("INTO"))
            });
            if has_into {
                return Err(blocked("SELECT ... INTO (it writes a file or a variable)"));
            }
            check_parsed(sql, &dialect)
        }
        _ => Err(blocked(&first)),
    }
}

/// True when the text has `/*!` or `/*M!` outside quotes and ordinary comments.
fn has_executable_comment(sql: &str) -> bool {
    let b: Vec<char> = sql.chars().collect();
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            q @ ('\'' | '"' | '`') => {
                i += 1;
                while i < b.len() && b[i] != q {
                    // Backslash escapes the next character inside strings; a doubled
                    // quote is two closings in a row, which this loop also handles.
                    if b[i] == '\\' && q != '`' {
                        i += 1;
                    }
                    i += 1;
                }
            }
            '#' => {
                while i < b.len() && b[i] != '\n' {
                    i += 1;
                }
            }
            '-' if b.get(i + 1) == Some(&'-') && b.get(i + 2).is_none_or(|c| c.is_whitespace()) => {
                while i < b.len() && b[i] != '\n' {
                    i += 1;
                }
            }
            '/' if b.get(i + 1) == Some(&'*') => {
                if b.get(i + 2) == Some(&'!')
                    || (b.get(i + 2) == Some(&'M') && b.get(i + 3) == Some(&'!'))
                {
                    return true;
                }
                i += 2;
                while i + 1 < b.len() && !(b[i] == '*' && b[i + 1] == '/') {
                    i += 1;
                }
                i += 1;
            }
            _ => {}
        }
        i += 1;
    }
    false
}

fn check_parsed(sql: &str, dialect: &MySqlDialect) -> Result<(), AppError> {
    let mut statements = Parser::parse_sql(dialect, sql).map_err(|e| {
        // The same refusal covers a typo (a missing `;`) and valid SQL this
        // parser doesn't know, so say what it saw and don't blame the user.
        let detail = e.to_string();
        let detail = detail.strip_prefix("sql parser error: ").unwrap_or(&detail);
        AppError::Blocked(format!(
            "Could not read this statement, so it was not sent. {detail}. \
             Check for a missing `;` or a typo. If the SQL is valid, Fogtrail \
             may not support that syntax yet. {ALLOWED}"
        ))
    })?;
    let Some(statement) = statements.pop().filter(|_| statements.is_empty()) else {
        return Err(blocked("Running more than one statement at once"));
    };
    match &statement {
        Statement::Query(_) => {}
        Statement::Explain {
            analyze, statement, ..
        } => {
            // EXPLAIN ANALYZE runs the statement. Only a query is safe to run that way.
            if *analyze && !matches!(**statement, Statement::Query(_)) {
                return Err(blocked("EXPLAIN ANALYZE of a statement that writes"));
            }
        }
        Statement::ExplainTable { .. } => {}
        other => return Err(blocked(&verb(other))),
    }
    match statement.visit(&mut Rules) {
        ControlFlow::Break(why) => Err(why),
        ControlFlow::Continue(()) => Ok(()),
    }
}

/// The first word of a statement, for messages.
fn verb(statement: &Statement) -> String {
    statement
        .to_string()
        .split_whitespace()
        .next()
        .unwrap_or("This statement")
        .to_ascii_uppercase()
}

/// Walks the whole tree, so a forbidden thing nested in a subquery or a CTE is found too.
struct Rules;

impl Visitor for Rules {
    type Break = AppError;

    fn pre_visit_query(&mut self, query: &Query) -> ControlFlow<AppError> {
        if let Some(LockClause { .. }) = query.locks.first() {
            return ControlFlow::Break(blocked("Locking rows (FOR UPDATE, FOR SHARE)"));
        }
        match query.body.as_ref() {
            SetExpr::Insert(_) | SetExpr::Update(_) | SetExpr::Delete(_) | SetExpr::Merge(_) => {
                ControlFlow::Break(blocked("A statement that writes"))
            }
            _ => ControlFlow::Continue(()),
        }
    }

    fn pre_visit_select(&mut self, select: &Select) -> ControlFlow<AppError> {
        if select.into.is_some() {
            return ControlFlow::Break(blocked("SELECT ... INTO (it writes a file or a variable)"));
        }
        ControlFlow::Continue(())
    }

    fn pre_visit_expr(&mut self, expr: &Expr) -> ControlFlow<AppError> {
        if let Expr::Function(f) = expr {
            let name = f.name.to_string().to_ascii_uppercase();
            if BLOCKED_FUNCTIONS.contains(&name.as_str()) {
                return ControlFlow::Break(blocked(&format!("The function {name}()")));
            }
        }
        ControlFlow::Continue(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn allowed(sql: &str) {
        if let Err(e) = check(sql) {
            panic!("should be allowed: {sql}\n  got: {e}");
        }
    }

    fn blocked_by(sql: &str, word: &str) {
        match check(sql) {
            Ok(()) => panic!("should be blocked: {sql}"),
            Err(AppError::Blocked(m)) => assert!(
                m.contains(word),
                "message for {sql:?} should mention {word:?}, got: {m}"
            ),
            Err(other) => panic!("wrong error for {sql:?}: {other}"),
        }
    }

    #[test]
    fn a_missing_semicolon_says_where_the_parser_stopped() {
        let sql = "select * from t where name = \"a\"\nselect * from t where name = \"a\"";
        match check(sql) {
            Err(AppError::Blocked(m)) => {
                assert!(m.starts_with("Could not read this statement"), "got: {m}");
                assert!(m.contains("Line: 2, Column: 1"), "got: {m}");
                assert!(m.contains("missing `;`"), "got: {m}");
                assert!(m.contains("Nothing was sent to the server."), "got: {m}");
            }
            other => panic!("should be blocked, got {other:?}"),
        }
    }

    #[test]
    fn reads_are_allowed() {
        for sql in [
            "SELECT 1",
            "select * from orders where id = 5",
            "SELECT * FROM `weird name` LIMIT 10;",
            "SELECT * FROM a; ",
            "SELECT * FROM a;;",
            "  \n\t SELECT 1",
            "(SELECT 1) UNION (SELECT 2)",
            "SELECT a FROM t1 UNION ALL SELECT b FROM t2 ORDER BY 1 LIMIT 5",
            "WITH x AS (SELECT 1 AS n) SELECT n FROM x",
            "SELECT c.name, COUNT(*) FROM customers c JOIN orders o ON o.customer_id = c.id GROUP BY c.name HAVING COUNT(*) > 1",
            "SELECT * FROM t WHERE id IN (SELECT id FROM u)",
            "SELECT * FROM t -- trailing comment",
            "-- leading comment\nSELECT 1",
            "# hash comment\nSELECT 1",
            "/* plain */ SELECT 1",
            "/*+ MAX_EXECUTION_TIME(1000) */ SELECT 1",
            "SELECT 'a;b' AS semi",
            "SELECT \"a;b\"",
            "SELECT `a;b` FROM t",
            "SELECT 'it''s; fine'",
            "SELECT 'DELETE FROM x'",
            "SELECT JSON_EXTRACT(doc, '$.a') FROM t",
            "SELECT NOW(), VERSION(), DATABASE()",
            "SELECT @@version, @@sql_mode",
            "SHOW TABLES",
            "SHOW FULL TABLES FROM shop LIKE 'o%'",
            "show databases",
            "SHOW CREATE TABLE orders",
            "SHOW COLUMNS FROM orders",
            "SHOW INDEX FROM orders",
            "SHOW VARIABLES LIKE 'max%'",
            "SHOW GLOBAL STATUS",
            "SHOW ENGINE INNODB STATUS",
            "SHOW GRANTS",
            "SHOW PROCESSLIST",
            "DESCRIBE orders",
            "DESC orders",
            "EXPLAIN SELECT * FROM orders",
            "EXPLAIN FORMAT=JSON SELECT * FROM orders",
            "EXPLAIN ANALYZE SELECT * FROM orders",
            "EXPLAIN orders",
        ] {
            allowed(sql);
        }
    }

    #[test]
    fn writes_are_blocked_and_named() {
        for (sql, word) in [
            ("DELETE FROM orders WHERE id = 1", "DELETE"),
            ("delete from orders", "DELETE"),
            ("UPDATE orders SET status = 'x'", "UPDATE"),
            ("INSERT INTO orders (id) VALUES (1)", "INSERT"),
            ("REPLACE INTO orders (id) VALUES (1)", "REPLACE"),
            ("DROP TABLE orders", "DROP"),
            ("TRUNCATE TABLE orders", "TRUNCATE"),
            ("ALTER TABLE orders ADD c INT", "ALTER"),
            ("CREATE TABLE x (id INT)", "CREATE"),
            ("RENAME TABLE a TO b", "RENAME"),
            ("GRANT ALL ON *.* TO 'x'@'%'", "GRANT"),
            ("REVOKE ALL ON *.* FROM 'x'@'%'", "REVOKE"),
            ("SET GLOBAL read_only = 0", "SET"),
            ("SET SESSION TRANSACTION READ WRITE", "SET"),
            ("USE mysql", "USE"),
            ("CALL purge_orders()", "CALL"),
            ("LOAD DATA INFILE '/etc/passwd' INTO TABLE t", "LOAD"),
            ("LOCK TABLES orders WRITE", "LOCK"),
            ("UNLOCK TABLES", "UNLOCK"),
            ("KILL 5", "KILL"),
            ("FLUSH TABLES", "FLUSH"),
            ("OPTIMIZE TABLE orders", "OPTIMIZE"),
            ("ANALYZE TABLE orders", "ANALYZE"),
            ("START TRANSACTION", "START"),
            ("BEGIN", "BEGIN"),
            ("COMMIT", "COMMIT"),
            ("ROLLBACK", "ROLLBACK"),
            ("PREPARE s FROM 'DELETE FROM t'", "PREPARE"),
            ("EXECUTE s", "EXECUTE"),
            ("HANDLER t OPEN", "HANDLER"),
            ("DO SLEEP(1)", "DO"),
            ("TABLE orders", "TABLE"),
            ("VALUES ROW(1)", "VALUES"),
            ("COPY t TO 'x'", "COPY"),
        ] {
            blocked_by(sql, word);
        }
    }

    #[test]
    fn more_than_one_statement_is_blocked() {
        blocked_by("SELECT 1; SELECT 2", "more than one");
        blocked_by("SELECT 1; DELETE FROM t", "more than one");
        blocked_by("SELECT 1;\n-- next\nSELECT 2", "more than one");
        blocked_by("SELECT 1; ; SELECT 2", "more than one");
        blocked_by("SHOW TABLES; DROP TABLE t", "more than one");
        blocked_by("DESCRIBE t; DELETE FROM t", "more than one");
        blocked_by("(SELECT 1); DELETE FROM t", "more than one");
    }

    #[test]
    fn a_hidden_statement_is_blocked() {
        blocked_by("SELECT 1 /*! ; DROP TABLE t */", "comment");
        blocked_by("/*!50000 DELETE FROM t */", "comment");
        blocked_by("SELECT /*!50000 1 */", "comment");
        blocked_by("SELECT 1 /*M!100000 + 1 */", "comment");
        blocked_by("SHOW TABLES /*! ; DROP TABLE t */", "comment");
    }

    #[test]
    fn selects_that_write_or_lock_are_blocked() {
        blocked_by("SELECT * FROM t INTO OUTFILE '/tmp/x'", "INTO");
        blocked_by("SELECT * FROM t INTO DUMPFILE '/tmp/x'", "INTO");
        blocked_by("SELECT 1 INTO @a", "INTO");
        blocked_by("SELECT * FROM t FOR UPDATE", "Locking");
        blocked_by("SELECT * FROM t FOR SHARE", "Locking");
        blocked_by(
            "SELECT * FROM t WHERE id IN (SELECT id FROM u FOR UPDATE)",
            "Locking",
        );
        blocked_by("SELECT GET_LOCK('a', 10)", "GET_LOCK");
        blocked_by("select get_lock('a', 10)", "GET_LOCK");
        blocked_by("SELECT RELEASE_LOCK('a')", "RELEASE_LOCK");
        blocked_by("SELECT RELEASE_ALL_LOCKS()", "RELEASE_ALL_LOCKS");
        blocked_by("SELECT LOAD_FILE('/etc/passwd')", "LOAD_FILE");
        blocked_by(
            "SELECT * FROM t WHERE x = (SELECT LOAD_FILE('/a'))",
            "LOAD_FILE",
        );
        blocked_by("EXPLAIN ANALYZE DELETE FROM t", "EXPLAIN ANALYZE");
        blocked_by("WITH x AS (SELECT 1) DELETE FROM t", "writes");
    }

    #[test]
    fn a_keyword_inside_text_does_not_confuse_the_guard() {
        allowed("SELECT 'x; DROP TABLE t' AS note");
        allowed("SELECT * FROM t WHERE note = 'INTO OUTFILE'");
        allowed("SELECT * FROM t WHERE note = 'FOR UPDATE'");
        allowed("SELECT `delete`, `drop` FROM t");
        allowed("SELECT 1 -- ; DROP TABLE t");
        allowed("SELECT 1 /* ; DROP TABLE t */");
        allowed("SELECT 1 # ; DROP TABLE t");
        allowed("SELECT '/*! not a comment */' AS s");
        allowed("SELECT \"/*!\" AS s");
        allowed("SELECT `/*!` FROM t");
        allowed("SELECT 'it\\'s /*!' AS s");
        allowed("SELECT 1 /* a /*! b */");
        allowed("SELECT 'INTO x' AS s");
        allowed("SHOW TABLES LIKE 'into%'");
    }

    #[test]
    fn empty_and_broken_input_is_refused_with_a_reason() {
        for sql in ["", "   ", "\n\n", ";", "-- only a comment", "/* nothing */"] {
            match check(sql) {
                Err(AppError::Blocked(m)) => assert!(m.contains("nothing to run"), "{sql:?}: {m}"),
                other => panic!("{sql:?} should say there is nothing to run, got {other:?}"),
            }
        }
        // Something the parser can't read is refused, not waved through.
        assert!(matches!(
            check("SELECT FROM WHERE ((("),
            Err(AppError::Blocked(_))
        ));
        assert!(matches!(
            check("SELECT 'unterminated"),
            Err(AppError::Blocked(_))
        ));
        assert!(matches!(check("1 + 1"), Err(AppError::Blocked(_))));
    }

    #[test]
    fn the_message_says_nothing_was_sent() {
        let Err(AppError::Blocked(m)) = check("DELETE FROM t") else {
            panic!("expected a block");
        };
        assert!(m.starts_with("DELETE is not allowed."));
        assert!(m.contains("SELECT, SHOW, DESCRIBE, EXPLAIN and WITH only"));
        assert!(m.contains("Nothing was sent to the server."));
    }
}
