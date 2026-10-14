import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CAMERA_PRESETS, ROOM_3D, seatPosition, seatSummary, seatVisual, summaryText } from "../seatMap3d";
import { seatAriaLabel, seatCell } from "../seatMap";

const cssColor = (token, fallback = "#888888") => getComputedStyle(document.documentElement).getPropertyValue(token).trim() || fallback;
const SEAT_H = 0.45;
const TAP_PX = 6;

function drawLabel(entry, code, symbol) {
  const key = `${code}|${symbol}`;
  if (entry.labelKey === key) return;
  entry.labelKey = key;
  const ctx = entry.canvas.getContext("2d");
  ctx.clearRect(0, 0, 256, 128);
  ctx.fillStyle = "rgba(255,255,255,.92)";
  ctx.beginPath();
  ctx.roundRect(8, 8, 240, 112, 24);
  ctx.fill();
  ctx.fillStyle = "#15231a";
  ctx.font = "700 56px 'Noto Sans Thai', system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`${symbol ? `${symbol} ` : ""}${code}`, 128, 66);
  entry.texture.needsUpdate = true;
}

function disposeObject(object) {
  object.traverse((child) => {
    child.geometry?.dispose();
    const materials = Array.isArray(child.material) ? child.material : child.material ? [child.material] : [];
    for (const material of materials) { material.map?.dispose(); material.dispose(); }
  });
}

// View-only 3D room. The scene is built once; each new `map` only recolours and relabels the seats. Drawing is on demand (no animation loop).
export default function SeatMap3D({ map, paused = false, onUnavailable }) {
  const canvasRef = useRef(null);
  const stageRef = useRef(null);
  const view = useRef(null);
  const mapRef = useRef(map);
  const pausedRef = useRef(paused);
  const [tip, setTip] = useState(null);
  const [preset, setPreset] = useState("oblique");
  mapRef.current = map;
  pausedRef.current = paused;

  useEffect(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    } catch {
      onUnavailable();
      return undefined;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(cssColor("--canvas", "#f4f7f5"));
    const camera = new THREE.PerspectiveCamera(45, 4 / 3, 0.1, 100);
    const controls = new OrbitControls(camera, canvas);
    controls.maxPolarAngle = Math.PI / 2.05;
    controls.minDistance = 3;
    controls.maxDistance = 24;
    scene.add(new THREE.AmbientLight(0xffffff, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(ROOM_3D.width / 2 - 4, 10, 6);
    scene.add(sun);

    const box = (w, h, d, color, x, y, z) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
      mesh.position.set(x, y, z);
      scene.add(mesh);
      return mesh;
    };
    box(ROOM_3D.width + 3, 0.1, ROOM_3D.depth + 6, cssColor("--surface", "#ffffff"), ROOM_3D.width / 2, -0.05, (ROOM_3D.depth - 3) / 2 + 0.2);
    box(ROOM_3D.screen.w, ROOM_3D.screen.h, 0.12, "#2b2f2d", ROOM_3D.screen.x, 0.2 + ROOM_3D.screen.h / 2, ROOM_3D.screen.z);
    const { table } = ROOM_3D;
    box(table.w, 0.7, table.d, "#8a6a48", table.x + table.w / 2, 0.35, table.z + table.d / 2);

    const seatGroup = new THREE.Group();
    scene.add(seatGroup);
    const entries = new Map();
    const ray = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    let frame = 0;
    let glide = null;
    const draw = () => {
      frame = 0;
      if (glide) {
        const k = Math.min((performance.now() - glide.start) / glide.ms, 1);
        const e = k < 0.5 ? 4 * k * k * k : 1 - ((-2 * k + 2) ** 3) / 2;
        camera.position.lerpVectors(glide.fromPos, glide.toPos, e);
        controls.target.lerpVectors(glide.fromTarget, glide.toTarget, e);
        if (k >= 1) glide = null;
      }
      controls.update();
      renderer.render(scene, camera);
      if (glide) requestRender();
    };
    function requestRender() {
      if (frame || document.hidden || pausedRef.current) return;
      frame = requestAnimationFrame(draw);
    }

    const goTo = (id) => {
      const target = CAMERA_PRESETS.find((p) => p.id === id);
      if (!target) return;
      const toPos = new THREE.Vector3(...target.position);
      const toTarget = new THREE.Vector3(...target.target);
      if (reduceMotion) {
        camera.position.copy(toPos);
        controls.target.copy(toTarget);
        controls.update();
      } else {
        glide = { start: performance.now(), ms: 700, fromPos: camera.position.clone(), fromTarget: controls.target.clone(), toPos, toTarget };
      }
      requestRender();
    };

    const syncSeats = (current) => {
      const colors = {};
      const live = new Set();
      for (const seat of current?.seats || []) {
        const p = seatPosition(seat);
        if (!p) continue;
        live.add(seat.seat_code);
        let entry = entries.get(seat.seat_code);
        if (!entry) {
          const mesh = new THREE.Mesh(new THREE.BoxGeometry(ROOM_3D.seat, SEAT_H, ROOM_3D.seat), new THREE.MeshLambertMaterial({ color: "#888888" }));
          mesh.position.set(p.x, SEAT_H / 2, p.z);
          mesh.userData.seatCode = seat.seat_code;
          const labelCanvas = document.createElement("canvas");
          labelCanvas.width = 256;
          labelCanvas.height = 128;
          const texture = new THREE.CanvasTexture(labelCanvas);
          const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false }));
          sprite.scale.set(0.8, 0.4, 1);
          sprite.position.set(p.x, SEAT_H + 0.4, p.z);
          sprite.renderOrder = 2;
          seatGroup.add(mesh, sprite);
          entry = { mesh, sprite, canvas: labelCanvas, texture, labelKey: "" };
          entries.set(seat.seat_code, entry);
        }
        const visual = seatVisual(seat, current);
        colors[visual.colorToken] ||= cssColor(visual.colorToken);
        entry.mesh.material.color.set(colors[visual.colorToken]);
        drawLabel(entry, seat.seat_code, visual.symbol);
      }
      for (const [code, entry] of entries) {
        if (live.has(code)) continue;
        seatGroup.remove(entry.mesh, entry.sprite);
        disposeObject(entry.mesh);
        disposeObject(entry.sprite);
        entries.delete(code);
      }
      requestRender();
    };

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = stage;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      requestRender();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(stage);

    const pick = (event) => {
      const rect = canvas.getBoundingClientRect();
      pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(pointer, camera);
      const hit = ray.intersectObjects([...entries.values()].map((entry) => entry.mesh), false)[0];
      const code = hit?.object.userData.seatCode;
      const current = mapRef.current;
      const seat = code && current?.seats.find((item) => item.seat_code === code);
      return seat ? { x: event.clientX - rect.left, y: event.clientY - rect.top, text: seatAriaLabel(seat, seatCell(seat, current)) } : null;
    };
    let down = null;
    const onDown = (event) => { down = [event.clientX, event.clientY]; setTip(null); };
    const onUp = (event) => {
      if (!down || Math.hypot(event.clientX - down[0], event.clientY - down[1]) > TAP_PX) return;
      setTip(pick(event));
    };
    const onMove = (event) => {
      if (event.buttons || event.pointerType !== "mouse") return;
      const found = pick(event);
      canvas.style.cursor = found ? "pointer" : "grab";
      setTip(found);
    };
    const onLeave = () => setTip(null);
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerleave", onLeave);
    controls.addEventListener("change", requestRender);
    const onVisible = () => { if (!document.hidden) requestRender(); };
    document.addEventListener("visibilitychange", onVisible);

    const first = CAMERA_PRESETS[0];
    camera.position.set(...first.position);
    controls.target.set(...first.target);
    view.current = { goTo, syncSeats, requestRender };
    resize();
    syncSeats(mapRef.current);

    return () => {
      view.current = null;
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisible);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
      controls.removeEventListener("change", requestRender);
      controls.dispose();
      disposeObject(scene);
      renderer.dispose();
    };
  }, []);

  useEffect(() => { view.current?.syncSeats(map); }, [map]);
  useEffect(() => { if (!paused) view.current?.requestRender(); }, [paused]);

  const choose = (id) => { setPreset(id); view.current?.goTo(id); };
  return <div className="seatmap3d">
    <div className="seatmap3d-presets" role="group" aria-label="มุมมองผัง 3D">
      {CAMERA_PRESETS.map((p) => <button key={p.id} type="button" aria-pressed={preset === p.id} onClick={() => choose(p.id)}>{p.label}</button>)}
    </div>
    <div className="seatmap3d-stage" ref={stageRef}>
      <canvas ref={canvasRef} aria-hidden="true" />
      {tip && <div className="seatmap3d-tip" style={{ left: tip.x + 12, top: tip.y + 12 }}>{tip.text}</div>}
    </div>
    <p className="seatmap-hint" role="status">{summaryText(seatSummary(map))}</p>
    <p className="seatmap-hint">ลากเพื่อหมุน · ซูมด้วยล้อเมาส์หรือสองนิ้ว · แตะที่นั่งเพื่อดูสถานะ · เลือกที่นั่งในผัง 2D</p>
  </div>;
}
