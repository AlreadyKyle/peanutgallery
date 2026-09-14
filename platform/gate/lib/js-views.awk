# js-views.awk: line-preserving views of a JavaScript or TypeScript file for runtime-token-deny.sh.
#
# view=code     comments are replaced by spaces; program text, strings, templates and JSX text are kept
# view=strings  only the contents of string literals, template literals and JSX text are kept;
#               everything else is spaces
# jsx=1         the file may hold JSX (.tsx, .jsx): an angle bracket followed by a letter or by >
#               opens an element where an operand may start, and the text between tags is a literal
#
# Every output line maps to the same input line, so grep -n line numbers point at the source.
# The state carries across lines: block comments, template literals, tags and JSX text may span
# lines; a single- or double-quoted string, a regular expression literal or a line comment ends with
# its line.
# A slash starts a regular expression, and an angle bracket an element, when the previous
# significant character cannot end an operand or the previous word is a keyword such as return or
# typeof; otherwise the slash is division and the bracket a comparison.
# Code inside ${ } of a template, { } of JSX text or { } of a tag attribute returns to that literal
# at the matching brace; the stack ret[] records where each brace level returns.

function emit(ch, kind) {
  if (view == "strings") out = out ((kind == "str") ? ch : " ")
  else out = out ((kind == "cmt") ? " " : ch)
}

function operand_start() {
  if (last == "") return 1
  if (index("(,=:[!&|?{};+-*%<>~^", last) > 0) return 1
  if (last ~ /[A-Za-z0-9_$]/) {
    return (word == "return" || word == "typeof" || word == "case" || word == "in" || word == "of" ||
            word == "do" || word == "else" || word == "throw" || word == "new" || word == "delete" ||
            word == "void" || word == "instanceof" || word == "yield" || word == "await")
  }
  return 0
}

# Enter code from a literal at an opening brace; the matching brace returns to the given state.
function enter_code(back) {
  depth_n++; depth[depth_n] = 0; ret[depth_n] = back
  st = "code"; last = "{"; prev = "{"; word = ""
}

function open_tag() { st = "tag"; tag_first = 1; tag_close = 0; tag_self = 0 }

BEGIN { st = "code"; depth_n = 0; jn = 0; last = ""; word = ""; prev = ""; inclass = 0; qret = "code" }

{
  line = $0; n = length(line); out = ""; i = 1
  while (i <= n) {
    c = substr(line, i, 1); d = substr(line, i + 1, 1)
    if (st == "lc") { emit(c, "cmt"); i++; continue }
    if (st == "bc") {
      if (c == "*" && d == "/") { emit(c, "cmt"); emit(d, "cmt"); i += 2; st = "code" }
      else { emit(c, "cmt"); i++ }
      continue
    }
    if (st == "sq" || st == "dq") {
      q = (st == "sq") ? "'" : "\""
      if (c == "\\") { emit(c, "str"); emit(d, "str"); i += 2; continue }
      if (c == q) {
        emit(c, "delim"); i++; st = qret
        if (qret == "code") { last = q; prev = q }
        continue
      }
      emit(c, "str"); i++; continue
    }
    if (st == "tpl") {
      if (c == "\\") { emit(c, "str"); emit(d, "str"); i += 2; continue }
      if (c == "`") { emit(c, "delim"); i++; st = "code"; last = "`"; prev = "`"; continue }
      if (c == "$" && d == "{") { emit(c, "delim"); emit(d, "delim"); i += 2; enter_code("tpl"); continue }
      emit(c, "str"); i++; continue
    }
    if (st == "re") {
      if (c == "\\") { emit(c, "code"); emit(d, "code"); i += 2; continue }
      if (c == "[") inclass = 1
      else if (c == "]") inclass = 0
      else if (c == "/" && !inclass) { st = "code"; last = "/"; prev = "/" }
      emit(c, "code"); i++; continue
    }
    if (st == "tag") {
      if (c == "\"" || c == "'") { st = (c == "'") ? "sq" : "dq"; qret = "tag"; emit(c, "delim"); i++; tag_first = 0; continue }
      if (c == "{") { emit(c, "delim"); i++; tag_first = 0; enter_code("tag"); continue }
      if (c == "/" && tag_first) tag_close = 1
      else if (c == "/" && d == ">") tag_self = 1
      if (c == ">") {
        if (tag_close) jdepth[jn]--
        else if (!tag_self) jdepth[jn]++
        if (jdepth[jn] <= 0) { jn--; st = "code"; last = ")"; prev = ")"; word = "" }
        else st = "jtext"
      }
      emit(c, "code"); i++; tag_first = 0; continue
    }
    if (st == "jtext") {
      if (c == "<") { open_tag(); emit(c, "delim"); i++; continue }
      if (c == "{") { emit(c, "delim"); i++; enter_code("jtext"); continue }
      emit(c, "str"); i++; continue
    }
    if (c == "/" && d == "/") { st = "lc"; emit(c, "cmt"); emit(d, "cmt"); i += 2; continue }
    if (c == "/" && d == "*") { st = "bc"; emit(c, "cmt"); emit(d, "cmt"); i += 2; continue }
    if (c == "/" && operand_start()) { st = "re"; inclass = 0; emit(c, "code"); i++; continue }
    if (jsx && c == "<" && d ~ /[A-Za-z>]/ && operand_start()) {
      jn++; jdepth[jn] = 0; open_tag(); emit(c, "delim"); i++; continue
    }
    if (c == "'" || c == "\"") { st = (c == "'") ? "sq" : "dq"; qret = "code"; emit(c, "delim"); i++; continue }
    if (c == "`") { st = "tpl"; emit(c, "delim"); i++; continue }
    if (c == "{" && depth_n > 0) depth[depth_n]++
    if (c == "}" && depth_n > 0) {
      if (depth[depth_n] == 0) { st = ret[depth_n]; depth_n--; emit(c, "delim"); i++; continue }
      depth[depth_n]--
    }
    if (c ~ /[A-Za-z0-9_$]/) word = (prev ~ /[A-Za-z0-9_$]/) ? word c : c
    if (c != " " && c != "\t") last = c
    prev = c
    emit(c, "code"); i++
  }
  print out
  if (st == "sq" || st == "dq") st = qret
  else if (st == "re" || st == "lc") st = "code"
}
