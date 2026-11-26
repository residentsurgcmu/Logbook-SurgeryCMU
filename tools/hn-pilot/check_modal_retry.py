"""Browser regression for the production component with HTTP fixtures only."""
import argparse
import asyncio
import json
import os
import socket
import subprocess
import tempfile
from pathlib import Path
from urllib.parse import urlsplit

from playwright.async_api import async_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
ACTOR = "00000000-1111-4000-8000-000000000001"
MOCK_HOST = "dyiiivcyoatgmkmvgcnt.supabase.co"
HN = "0123456"


async def check(page, public_key, origin, entry):
    saved = {}
    attempts = []
    raw_bodies = []
    output = []
    page_errors = []
    first_save = asyncio.Event()
    drop_reply = asyncio.Event()
    page.on("console", lambda message: output.append(message.text))
    page.on("pageerror", lambda error: page_errors.append(str(error)))

    async def route(r):
        url = urlsplit(r.request.url)
        if f"{url.scheme}://{url.netloc}" == origin:
            return await r.continue_()
        if url.hostname != MOCK_HOST:
            return await r.abort()
        raw_bodies.append(r.request.post_data or "")
        body = r.request.post_data_json or {}
        response = []
        status = 200
        if url.path.endswith("/list_resident_case_people"):
            response = [dict(user_id=ACTOR, full_name="Fixture", role="resident", active=True)]
        if url.path.endswith("/resident_admission_cases"):
            response = list(saved.values())
        if url.path.endswith("/rc_hn_pilot_create_case"):
            op = body["p_operation"]
            if op == "status":
                response = {"eligible": True}
            elif op == "reserve":
                response = {"caseCode": "ADM-00003", "publicKey": public_key}
            elif op == "save":
                attempts.append(body)
                case = body["p_case_id"]
                if len(attempts) == 2:
                    # A later rejection must not discard the already-uncertain request.
                    status = 403
                    response = {"code": "42501", "message": "fixture"}
                else:
                    saved.setdefault(case, {
                        "id": case, "case_code": "ADM-00003", "owner_id": ACTOR,
                        **body["p_fields"], "age_years": 40,
                    })
                    if len(attempts) == 1:
                        first_save.set()
                        await asyncio.wait_for(drop_reply.wait(), timeout=12)
                        return await r.abort("failed")
                    response = {"id": case}
        data = json.dumps(response)
        output.append(data)
        return await r.fulfill(status=status, content_type="application/json", body=data)

    await page.route("**/*", route)
    await page.goto(f"{origin}/{entry}")
    add = page.get_by_role("button", name="เพิ่มเคส Grand Rounds (นำร่อง)")
    dialog = page.get_by_role("dialog")

    async def try_to_dismiss():
        await page.keyboard.press("Escape")
        await expect(dialog).to_be_visible()
        close = dialog.get_by_role("button", name="ปิด", exact=True)
        await expect(close).to_be_disabled()
        await close.click(force=True)
        await expect(dialog).to_be_visible()
        await page.mouse.click(2, 2)  # Inside the backdrop, outside the dialog.
        await expect(dialog).to_be_visible()
        await expect(dialog.get_by_role("button", name="ยกเลิก")).to_be_disabled()

    await add.click()
    await page.keyboard.press("Escape")
    await expect(dialog).to_have_count(0)
    await page.get_by_role("button", name="เพิ่มเคส", exact=True).click()
    await expect(page.get_by_placeholder("ตัวเลข 7 หลัก")).to_have_count(0)
    await page.mouse.click(2, 2)
    await expect(dialog).to_have_count(0)

    await add.click()
    await page.get_by_label("อายุ (ปี)").fill("40")
    await page.get_by_label("Diagnosis").fill("fixture")
    await page.get_by_label("Type (จำเป็น)").select_option("conservative")
    await page.get_by_placeholder("ตัวเลข 7 หลัก").fill(HN)
    submit = dialog.get_by_role("button", name="บันทึก", exact=True)
    await submit.click()
    await asyncio.wait_for(first_save.wait(), timeout=10)
    await try_to_dismiss()
    drop_reply.set()
    await expect(dialog.get_by_role("alert")).to_contain_text("คำขอเดิม")
    await try_to_dismiss()
    await submit.click()
    await expect(submit).to_be_enabled()
    await try_to_dismiss()
    await submit.click()
    await expect(page.get_by_role("dialog", name="เพิ่มเคส Grand Rounds", exact=True)).to_have_count(0)
    await expect(page.get_by_role("dialog", name="ADM-00003 · fixture")).to_be_visible()
    assert len(attempts) == 3 and attempts[0] == attempts[1] == attempts[2]
    assert len(saved) == 1
    assert all(HN not in text for text in raw_bodies + output)
    assert not page_errors, page_errors


async def run(args):
    public_key = json.loads(Path(args.public_key).read_text())
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    origin = f"http://127.0.0.1:{port}"
    env = {**os.environ, "VITE_CASE_HN_PILOT": "true", "VITE_CASE_HN_PILOT_KEY_ID": public_key["keyId"],
           "VITE_SUPABASE_URL": f"https://{MOCK_HOST}", "VITE_SUPABASE_PUBLISHABLE_KEY": "browser-fixture-key"}
    with tempfile.TemporaryDirectory(dir=ROOT, prefix="hn-browser-fixture-") as tmp:
        fixture = Path(tmp)
        (fixture / "index.html").write_text('<meta charset="UTF-8"><div id="root"></div>'
                                            '<script type="module" src="./entry.jsx"></script>')
        (fixture / "entry.jsx").write_text(f'''
import React from "react";
import {{ createRoot }} from "react-dom/client";
import Cases from "../src/features/ResidentCases";
import "../src/resident.css";
createRoot(document.querySelector("#root")).render(<Cases user={{{{id: "{ACTOR}", role: "resident"}}}}/>);
''')
        with subprocess.Popen(
            ["node", str(ROOT / "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1",
             "--port", str(port), "--strictPort"], cwd=ROOT, env=env, stdout=subprocess.DEVNULL,
        ) as server:
            try:
                for _ in range(100):
                    try:
                        with socket.create_connection(("127.0.0.1", port), timeout=.1):
                            break
                    except OSError:
                        if server.poll() is not None:
                            raise RuntimeError("Vite stopped before startup")
                        await asyncio.sleep(.1)
                else:
                    raise RuntimeError("Vite startup timed out")
                async with async_playwright() as playwright:
                    browser = await playwright.chromium.launch(
                        executable_path=args.chromium,
                        args=["--no-sandbox", "--no-zygote", "--single-process", "--disable-gpu"] if args.chromium else [],
                    )
                    try:
                        context = await browser.new_context(service_workers="block")
                        page = await context.new_page()
                        await check(page, public_key, origin, f"{fixture.name}/index.html")
                    finally:
                        await browser.close()
            finally:
                server.terminate()
    print("PASS: Escape, close and backdrop cannot drop an in-flight or unresolved HN save; exact retry, one fixture case.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("public_key", help="Path to a synthetic 3072-bit pilot public-key JSON")
    parser.add_argument("--chromium")
    asyncio.run(run(parser.parse_args()))
