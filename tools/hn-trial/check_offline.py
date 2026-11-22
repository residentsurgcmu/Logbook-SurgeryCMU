"""Cross-check the application encryptor against the actual offline file in Chromium."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
from playwright.sync_api import expect, sync_playwright

root = Path(__file__).resolve().parents[2]
with tempfile.TemporaryDirectory() as folder, sync_playwright() as playwright:
    t = Path(folder)
    browser = playwright.chromium.launch(executable_path=os.environ.get("RC_CHROMIUM", "/usr/bin/chromium"),
        args=["--no-sandbox", "--no-zygote", "--single-process", "--disable-gpu"])
    page = browser.new_context(offline=True, viewport={"width":390,"height":844}).new_page()
    urls = []
    page.on("request", lambda request: urls.append(request.url))
    page.goto((root/"tools/hn-trial/moderator.html").as_uri())
    password = "offline rehearsal test only"
    page.fill("#new-pass", password)
    page.click("#create button")
    for button, tag in [("#get-public","public"),("#get-private","private")]:
        with page.expect_download() as event:
            page.click(button)
        event.value.save_as(t/(tag+".json"))

    script = """
      import {sealTrialHn} from './src/caseHnTrialCrypto.js';
      const publicKey=JSON.parse(process.argv[1]), [hn,caseCode,caseUuid]=process.argv.slice(2);
      const v=await sealTrialHn({publicKey,configuredKey:publicKey.keyId,caseUuid,caseCode,hn});
      console.log(JSON.stringify({format:'rc-hn-demo-v1',type:'trial-record',caseId:caseCode,caseUuid,...v}));
    """
    def make(hn,code,uuid):
        raw=subprocess.check_output(["node","--input-type=module","-e",script,(t/"public.json").read_text(),hn,code,uuid],cwd=root,text=True)
        assert hn not in raw
        return json.loads(raw)

    first=make("DEMO-0123456","ADM-00001","ac100000-0000-4000-8000-000000000001")
    second=make("DEMO-7654321","ADM-00002","ac100000-0000-4000-8000-000000000002")
    def bundle(*items):
        return {"format":first["format"],"type":"trial-bundle","keyId":first["keyId"],"records":items}
    def attempt(item,code,expected=None):
        (t/"record.json").write_text(json.dumps(item))
        page.fill("#expect",code)
        page.set_input_files("#record-file", t/"record.json")
        page.set_input_files("#private-file", t/"private.json")
        page.fill("#unlock-pass",password)
        page.click("#reveal button")
        if expected is None:
            expect(page.locator("#status")).to_contain_text("เปิดไม่ได้")
            expect(page.locator("#result")).to_be_empty()
        else:
            expect(page.locator("#result")).to_have_text(code+" · "+expected)
            page.click("#hide")
            expect(page.locator("#result")).to_be_empty()

    attempt(bundle(first,second),"ADM-00001","DEMO-0123456")
    attempt(bundle(first,second),"ADM-00002","DEMO-7654321")
    attempt(bundle(first,second),"ADM-00003")
    attempt(bundle(first,first),"ADM-00001")
    attempt(bundle({**first,"caseUuid":second["caseUuid"]},second),"ADM-00001")
    attempt(first,"ADM-00001","DEMO-0123456")
    assert all(url.startswith("file:") for url in urls), urls
    print("PASS: app encryptor → offline moderator: seven-digit leading zero, two-case bundle, correct selection, missing and duplicate codes rejected, UUID tamper rejected, no external requests")
