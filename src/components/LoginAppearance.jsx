import React, { useEffect, useRef, useState } from "react";
import LoginArtwork from "./LoginArtwork";
import { createLoginThemePicker } from "../loginThemes.mjs";
import { suturePose } from "../loginSuture.mjs";
import "./loginAppearance.css";

const MOTION_KEY = "rc:login:motion-paused";
const MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const INTERVAL_MS = 15000;
const PULL_MS = 2350;
function getStorage() {
  try { return window.localStorage; } catch { return null; }
}

export default function LoginAppearance({ children }) {
  const [theme, setTheme] = useState(null);
  const [reduced, setReduced] = useState(() => window.matchMedia(MOTION_QUERY).matches);
  const [paused, setPaused] = useState(() => {
    try { return getStorage()?.getItem(MOTION_KEY) === "1"; } catch { return false; }
  });
  const visit = useRef(null);
  const artwork = useRef(null);
  useEffect(() => {
    let active = true;
    if (!visit.current) {
      let locks;
      try { locks = navigator.locks; } catch { /* Storage and locks are optional. */ }
      visit.current = createLoginThemePicker({ storage: getStorage(), locks }).next();
    }
    visit.current.then(({ id }) => { if (active) setTheme(id); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const query = window.matchMedia(MOTION_QUERY);
    const change = (event) => setReduced(event.matches);
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);

  useEffect(() => {
    if (!theme || paused || reduced) return;
    const surface = artwork.current;
    const thread = surface.querySelector("[data-suture-thread]");
    const needle = surface.querySelector("[data-suture-needle]");
    let timer, frame;
    function draw(phase) {
      if (!thread || !needle) return;
      const pose = suturePose(phase);
      thread.setAttribute("d", pose.d);
      needle.setAttribute("transform", pose.transform);
    }
    function stop() {
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      surface.classList.remove("lg-running");
      draw(0);
    }
    function play() {
      stop();
      if (document.hidden) return;
      // Restart only the illustration. The form and selected theme stay mounted.
      void surface.offsetWidth;
      surface.classList.add("lg-running");
      if (thread && needle) {
        const started = performance.now();
        function step(now) {
          const phase = Math.min(1, (now - started) / PULL_MS);
          draw(phase);
          if (phase < 1) frame = requestAnimationFrame(step);
        }
        frame = requestAnimationFrame(step);
      }
      timer = setTimeout(play, INTERVAL_MS);
    }
    function visibility() {
      stop();
      if (!document.hidden) timer = setTimeout(play, INTERVAL_MS);
    }
    function restore(event) { if (event.persisted) visibility(); }
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", stop);
    window.addEventListener("pageshow", restore);
    play();
    return () => {
      stop();
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", stop);
      window.removeEventListener("pageshow", restore);
    };
  }, [theme, paused, reduced]);

  function toggleMotion() {
    const next = !paused;
    setPaused(next);
    try { getStorage()?.setItem(MOTION_KEY, next ? "1" : "0"); } catch { /* In-memory choice still works. */ }
  }

  return <main className="lg-page">
    <div className={`lg-screen lg-${theme ?? "horizon"}`} data-login-theme={theme || undefined}>
      <header className="lg-identity"><div className="lg-seal"><img src="/surgery-cmu-logo.png" alt="Surgery CMU" /></div>
        <div><strong>ภาควิชาศัลยศาสตร์</strong><small>คณะแพทยศาสตร์ มหาวิทยาลัยเชียงใหม่</small></div>
      </header>
      <div className="lg-intro"><h1>Resident <span>Corner</span></h1><p>พื้นที่ทำงานและการเรียนรู้<br />ของแพทย์ประจำบ้านศัลยศาสตร์</p></div>
      <div className="lg-art" ref={artwork} aria-hidden="true">{theme && <LoginArtwork theme={theme} />}</div>
      <section className="lg-formarea" aria-label="เข้าสู่ระบบ Resident Corner">
        {children}
        <p className="lg-helper">ใช้เฉพาะบัญชีที่ภาควิชาสร้างให้<wbr /> หรือส่งคำเชิญให้ใช้งาน</p>
        <button type="button" className="lg-motion" disabled={reduced} aria-pressed={paused || reduced} onClick={toggleMotion}>
          {reduced ? "ลดการเคลื่อนไหวตามเครื่อง" : paused ? "เปิดการเคลื่อนไหว" : "ปิดการเคลื่อนไหว"}
        </button>
      </section>
    </div>
  </main>;
}
