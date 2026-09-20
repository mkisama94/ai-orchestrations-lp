import os
import re
from pathlib import Path

PUBLIC_DIR = Path(r"c:\git\ai-orchestrations-lp\public")

html_files = list(PUBLIC_DIR.glob("**/*.html"))
print(f"Checking {len(html_files)} HTML files in {PUBLIC_DIR}...")

errors = []

for html_path in html_files:
    content = html_path.read_text(encoding="utf-8")
    rel_html = html_path.relative_to(PUBLIC_DIR)
    
    # Check src and href attributes
    matches = re.findall(r'(?:href|src)=["\']([^"\']+)["\']', content)
    for target in matches:
        # Ignore external links, mailto, javascript, anchor-only
        if target.startswith(("http://", "https://", "mailto:", "javascript:", "#")):
            continue
        
        # Strip anchor or query params
        clean_target = target.split("#")[0].split("?")[0]
        if not clean_target:
            continue
        
        # Resolve target
        if clean_target.startswith("/"):
            resolved = PUBLIC_DIR / clean_target.lstrip("/")
        else:
            resolved = html_path.parent / clean_target
        
        # If directory, look for index.html
        if resolved.is_dir():
            resolved = resolved / "index.html"
            
        if not resolved.exists():
            errors.append(f"[{rel_html}] Broken link: {target} -> Resolved to non-existent {resolved}")

if errors:
    print(f"Found {len(errors)} broken links:")
    for err in errors:
        print("  " + err)
else:
    print("All local links and assets resolved successfully!")
