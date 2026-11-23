/**
 * Archery 101010 — Zero-Regression Prebuild AST Guard
 * Blocks `npm run build` and `npm test` automatically if ANY file in `src/` contains:
 *  1. A React Hook (`use*`) called after an early `return` statement (React Error #310 / #300)
 *  2. A React Hook (`use*`) called conditionally (`if`, `switch`, ternary, `&&`, `||`, loops, `try`)
 *  3. A React Hook (`use*`) called inside a nested callback or nested helper function
 */

const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const HOOK_NAME_RE = /^use[A-Z0-9]/;

function getHookCallName(node) {
  if (!ts.isCallExpression(node)) return null;
  const expr = node.expression;
  if (ts.isIdentifier(expr) && HOOK_NAME_RE.test(expr.text)) {
    return expr.text;
  }
  if (
    ts.isPropertyAccessExpression(expr) &&
    ts.isIdentifier(expr.expression) &&
    expr.expression.text === "React" &&
    HOOK_NAME_RE.test(expr.name.text)
  ) {
    return `React.${expr.name.text}`;
  }
  return null;
}

function isFunctionLikeDeclaration(node) {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node)
  );
}

function statementContainsReturn(stmt) {
  let found = false;
  function visit(n) {
    if (found) return;
    if (isFunctionLikeDeclaration(n)) return;
    if (ts.isReturnStatement(n)) {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  }
  visit(stmt);
  return found;
}

function inspectSourceText(sourceText, filePath = "inline.tsx") {
  const sf = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );

  const violations = [];

  function report(node, msg) {
    const pos = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    violations.push(`${filePath}:${pos.line + 1}:${pos.character + 1} - ${msg}`);
  }

  function inspectFunctionBody(fnNode, isNestedInsideAnotherFn) {
    const body = fnNode.body;
    if (!body) return;

    if (!ts.isBlock(body)) {
      // Concise arrow body `() => useFoo()`
      function scanExpr(n, inCond) {
        if (isFunctionLikeDeclaration(n)) {
          inspectFunctionBody(n, true);
          return;
        }
        const hookName = getHookCallName(n);
        if (hookName) {
          if (isNestedInsideAnotherFn) {
            report(n, `Hook "${hookName}" called inside a nested function/callback.`);
          } else if (inCond) {
            report(n, `Hook "${hookName}" called conditionally.`);
          }
        }
        const nextCond =
          inCond ||
          ts.isConditionalExpression(n) ||
          (ts.isBinaryExpression(n) &&
            (n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
              n.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
              n.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken));
        ts.forEachChild(n, (child) => scanExpr(child, nextCond));
      }
      scanExpr(body, false);
      return;
    }

    let seenEarlyReturn = false;

    for (const stmt of body.statements) {
      function scanStmtNode(n, inBranchOrLoop) {
        if (isFunctionLikeDeclaration(n)) {
          inspectFunctionBody(n, true);
          return;
        }
        const hookName = getHookCallName(n);
        if (hookName) {
          if (isNestedInsideAnotherFn) {
            report(
              n,
              `Hook "${hookName}" called inside a nested function/callback (causes React Hook mismatch).`
            );
          } else if (seenEarlyReturn) {
            report(
              n,
              `Hook "${hookName}" called AFTER an early return statement (causes React Error #310).`
            );
          } else if (inBranchOrLoop) {
            report(
              n,
              `Hook "${hookName}" called conditionally or inside a loop/try block (causes React Error #310).`
            );
          }
        }

        const entersBranchOrLoop =
          inBranchOrLoop ||
          ts.isIfStatement(n) ||
          ts.isSwitchStatement(n) ||
          ts.isForStatement(n) ||
          ts.isForInStatement(n) ||
          ts.isForOfStatement(n) ||
          ts.isWhileStatement(n) ||
          ts.isDoStatement(n) ||
          ts.isTryStatement(n) ||
          ts.isConditionalExpression(n) ||
          (ts.isBinaryExpression(n) &&
            (n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
              n.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
              n.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken));

        ts.forEachChild(n, (child) => scanStmtNode(child, entersBranchOrLoop));
      }

      scanStmtNode(stmt, false);
      if (statementContainsReturn(stmt)) {
        seenEarlyReturn = true;
      }
    }
  }

  function walkTop(node) {
    if (isFunctionLikeDeclaration(node)) {
      inspectFunctionBody(node, false);
      return;
    }
    ts.forEachChild(node, walkTop);
  }

  walkTop(sf);
  return violations;
}

function collectSourceFiles(dirPath, out = []) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(full, out);
    } else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
      out.push(full);
    }
  }
  return out;
}

function verifyWorkspaceSourceTree(rootDir = process.cwd()) {
  const srcDir = path.join(rootDir, "src");
  const files = collectSourceFiles(srcDir);
  const allViolations = [];
  const TRUNCATE_RE = /\b(?:truncate|text-ellipsis|line-clamp-\d+)\b/;
  for (const file of files) {
    const rel = path.relative(rootDir, file);
    const content = fs.readFileSync(file, "utf8");
    const v = inspectSourceText(content, rel);
    if (v.length > 0) {
      allViolations.push(...v);
    }
    if (file.endsWith(".tsx")) {
      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (TRUNCATE_RE.test(lines[i])) {
          allViolations.push(
            `${rel}:${i + 1} - Forbidden text truncation/ellipsis class found (words must never be cut off with "...").`
          );
        }
      }
    }
  }
  return { filesScanned: files.length, violations: allViolations };
}

if (require.main === module) {
  const { filesScanned, violations } = verifyWorkspaceSourceTree();
  if (violations.length > 0) {
    console.error("\n[BLOCKED] React Hook / Regression Guard detected critical errors:");
    for (const v of violations) {
      console.error("  ✖ " + v);
    }
    process.exit(1);
  }
  console.log(`✓ Zero-Regression AST Guard passed across ${filesScanned} source files.`);
}

module.exports = { inspectSourceText, verifyWorkspaceSourceTree };
