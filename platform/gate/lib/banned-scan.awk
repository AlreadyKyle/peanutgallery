# banned-scan.awk: normalization and whole-phrase matching for banned-phrases.sh.
#
# Normalization of a line: lowercase; a run of three or more single characters separated by one
# space, dot, dash, underscore, star or plus is joined (spaced and dotted spellings); the line is
# split into tokens on every character outside [a-z0-9@$]; a token that ends in a single $ loses it
# (a regular expression anchor, not a letter); tokens holding a letter, @ or $ get the leet map
# 0>o 1>i 3>e 4>a 5>s 7>t @>a $>s (pure numbers stay numbers so a cost of 455 is not a word).
# The result is " tok tok ", so a phrase matches only on whole tokens.
#
# mode=normalize   print the normalized form of every input line (used to load the lists)
# mode=scan        read termfile (list<TAB>phrase) and allowfile, scan the files named in listfile;
#                  a line of a .json file has its string escapes decoded before it is normalized
# mode=paths       like scan, but every input line is a path and the location is the path itself
# name             location label for the input instead of FILENAME (commit-message)
# tm               1 when the trademarks list applies to this input
# tokfile          when set, every distinct token of three or more characters is appended once as
#                  token<TAB>location for the hashed comparison

function leet(t) {
  if (t ~ /[a-z0-9@]\$$/) t = substr(t, 1, length(t) - 1)
  if (t ~ /[a-z@$]/) {
    gsub(/0/, "o", t); gsub(/1/, "i", t); gsub(/3/, "e", t); gsub(/4/, "a", t)
    gsub(/5/, "s", t); gsub(/7/, "t", t); gsub(/@/, "a", t); gsub(/\$/, "s", t)
  }
  return t
}

# Join runs such as "c.a.r.t" or "c a r t": single characters with exactly one separator between them.
function joinruns(s,    re, out, m, pre, post, run) {
  re = "(^|[^a-z0-9@$])[a-z0-9@$]([-_ .*+][a-z0-9@$])+([^a-z0-9@$]|$)"
  out = ""
  while (match(s, re)) {
    m = substr(s, RSTART, RLENGTH)
    pre = (substr(m, 1, 1) ~ /[a-z0-9@$]/) ? "" : substr(m, 1, 1)
    post = (substr(m, length(m), 1) ~ /[a-z0-9@$]/) ? "" : substr(m, length(m), 1)
    run = substr(m, length(pre) + 1, length(m) - length(pre) - length(post))
    if ((length(run) + 1) / 2 >= 3) gsub(/[-_ .*+]/, "", run)
    out = out substr(s, 1, RSTART - 1) pre run
    s = post substr(s, RSTART + RLENGTH)
  }
  return out s
}

function normalize(s,    n, parts, i, out) {
  s = joinruns(tolower(s))
  gsub(/[^a-z0-9@$]+/, " ", s)
  n = split(s, parts, " ")
  out = " "
  for (i = 1; i <= n; i++) out = out leet(parts[i]) " "
  return out
}

function trimmed(s) {
  sub(/^ +/, "", s); sub(/ +$/, "", s)
  return s
}

# The value of four hex digits, or -1.
function hex4(h,    i, c, v) {
  if (length(h) != 4) return -1
  v = 0
  for (i = 1; i <= 4; i++) {
    c = index("0123456789abcdef", tolower(substr(h, i, 1)))
    if (c == 0) return -1
    v = v * 16 + c - 1
  }
  return v
}

# A JSON line with its string escapes decoded the way JSON.parse reads them: \uXXXX becomes the
# character when it is printable ASCII and a space otherwise, \n \r \t \b \f become a space, and
# \" \\ \/ become the character. Read left to right, so an escaped backslash never starts another
# escape.
function jsondecode(s,    out, i, n, c, d, v) {
  out = ""; n = length(s); i = 1
  while (i <= n) {
    c = substr(s, i, 1)
    if (c != "\\") { out = out c; i++; continue }
    d = substr(s, i + 1, 1)
    if (d == "u") {
      v = hex4(substr(s, i + 2, 4))
      if (v >= 0) { out = out ((v >= 32 && v < 127) ? sprintf("%c", v) : " "); i += 6; continue }
    } else if (d == "n" || d == "r" || d == "t" || d == "b" || d == "f") {
      out = out " "; i += 2; continue
    } else if (d == "\"" || d == "\\" || d == "/") {
      out = out d; i += 2; continue
    }
    out = out c; i++
  }
  return out
}

BEGIN {
  if (mode == "scan" || mode == "paths") {
    nt = 0
    while ((getline line < termfile) > 0) {
      split(line, f, "\t")
      if (f[1] == "trademarks" && tm != 1) continue
      nt++; tlist[nt] = f[1]; tterm[nt] = f[2]
    }
    close(termfile)
    na = 0
    if (allowfile != "") {
      while ((getline line < allowfile) > 0) if (line != "") { na++; allow[na] = line }
      close(allowfile)
    }
    if (listfile != "") {
      while ((getline p < listfile) > 0) ARGV[ARGC++] = p
      close(listfile)
    }
  }
}

mode == "normalize" { print trimmed(normalize($0)); next }

{
  text = $0
  if (mode == "scan" && name == "" && tolower(FILENAME) ~ /\.json$/ && index(text, "\\") > 0) text = jsondecode(text)
  norm = normalize(text)
  for (a = 1; a <= na; a++) {
    key = " " allow[a] " "
    while ((p = index(norm, key)) > 0) norm = substr(norm, 1, p) substr(norm, p + length(key))
  }
  if (mode == "paths") where = "path:" $0
  else where = ((name != "") ? name : FILENAME) ":" FNR
  for (t = 1; t <= nt; t++) if (index(norm, " " tterm[t] " ") > 0) print "hit\t" where "\t" tlist[t] "\t" tterm[t]
  if (tokfile != "") {
    n = split(norm, toks, " ")
    for (i = 1; i <= n; i++) {
      tk = toks[i]
      if (length(tk) >= 3 && !(tk in seen)) { seen[tk] = 1; print tk "\t" where >> tokfile }
    }
  }
}
