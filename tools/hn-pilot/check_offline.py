"""Runs the actual production candidate envelope through fixture SQL and the offline viewer."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
from playwright.sync_api import expect, sync_playwright

root = Path(__file__).resolve().parents[2]
with tempfile.TemporaryDirectory() as folder, sync_playwright() as p:
    t = Path(folder)
    browser = p.chromium.launch(executable_path=os.environ.get("RC_CHROMIUM","/usr/bin/chromium"),
        args=["--no-sandbox","--no-zygote","--single-process","--disable-gpu"])
    page = browser.new_context(offline=True, viewport={"width":390, "height":844}).new_page()
    urls = []
    page.on("request", lambda request: urls.append(request.url))
    page.goto((root/"tools/hn-pilot/moderator.html").as_uri())
    password = "only for this disposable regression"
    page.fill("#new-pass",password)
    page.click("#create button")
    for button, name in [("#get-public","public.json"),("#get-private","private.json")]:
        with page.expect_download() as event:
            page.click(button)
        event.value.save_as(t/name)
    raw = subprocess.check_output(["node","tools/hn-pilot/rehearse.mjs",str(t/"public.json")],cwd=root,text=True)
    bundle=json.loads(raw)
    (t/"bundle.json").write_text(raw)
    page.set_input_files("#private-file", t/"private.json")
    page.fill("#expect","ADM-00001")
    for mutation in (True,False):
        if mutation:
            broken = json.loads(raw)
            broken["records"][0]["caseUuid"]="00000000-2222-4000-8000-000000000002"
            (t/"broken.json").write_text(json.dumps(broken))
        page.set_input_files("#record-file",t/("broken.json" if mutation else "bundle.json"))
        page.fill("#unlock-pass",password)
        page.click("#reveal button")
        if mutation:
            expect(page.locator("#status")).to_contain_text("เปิดไม่ได้")
            expect(page.locator("#result")).to_be_empty()
        else:
            expect(page.locator("#result")).to_have_text("ADM-00001 · 0123456")
            page.click("#hide")
            expect(page.locator("#result")).to_be_empty()
    assert all(url.startswith("file:") for url in urls)
    print("PASS: seven-digit string → restricted SQL save → audited private export → offline browser; leading zero retained")
