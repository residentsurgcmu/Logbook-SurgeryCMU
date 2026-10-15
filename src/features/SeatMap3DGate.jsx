import React, { Suspense, lazy } from "react";

// three.js and the scene are a separate chunk: nothing is downloaded until someone switches to 3D.
class SceneLoadError extends Error {}
const loadScene = () => lazy(() => import("./SeatMap3D").catch((error) => { throw new SceneLoadError(error); }));
// React.lazy keeps a rejected import for ever; after a failed load the next switch to 3D gets a fresh one.
let Scene = loadScene();

class Boundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error) {
    const reason = error instanceof SceneLoadError ? "load" : "device";
    if (reason === "load") Scene = loadScene();
    this.props.onFail(reason);
  }
  render() { return this.state.failed ? null : this.props.children; }
}

// onFallback(reason): "load" = the chunk could not be downloaded; "device" = WebGL or the scene is unusable here.
export default function SeatMap3DGate({ map, paused = false, onFallback }) {
  return <Boundary onFail={onFallback}>
    <Suspense fallback={<p role="status">กำลังโหลดผัง 3D…</p>}>
      <Scene map={map} paused={paused} onUnavailable={() => onFallback("device")} />
    </Suspense>
  </Boundary>;
}
