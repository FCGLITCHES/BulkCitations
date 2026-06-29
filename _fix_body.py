from pathlib import Path
p = Path(r"D:/Coding/Bulkreferences/server/src/routes/adminTruthRoutes.ts")
t = p.read_text(encoding="utf-8")
old = '    const body = "".join([lines.join("\\n"), "\\n"]) if False else f"{chr(10).join(lines)}\\n";'
new = "    const body = `${lines.join('\\n')}\\n`;"
if old not in t:
    raise SystemExit("old line not found")
p.write_text(t.replace(old, new), encoding="utf-8")
print("fixed")
