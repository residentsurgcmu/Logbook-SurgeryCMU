import React, { Suspense, lazy } from "react";

// three.js and the scene are a separate chunk: nothing is downloaded until someone switches to 3D.
const SeatMap3D = lazy(() => import("./SeatMap3D"));

class Boundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onFail(); }
  render() { return this.state.failed ? null : this.props.children; }
}

export default function SeatMap3DGate({ map, paused = false, onFallback }) {
  return <Boundary onFail={onFallback}>
    <Suspense fallback={<p role="status">กำลังโหลดผัง 3D…</p>}>
      <SeatMap3D map={map} paused={paused} onUnavailable={onFallback} />
    </Suspense>
  </Boundary>;
}
