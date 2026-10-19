// Local synthetic browser acceptance harness. Not imported by the application.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import ManagedExams, { ManagedPersonalScores } from "../src/features/ManagedExams.jsx";
import "../src/resident.css";
import { managedExamsApi } from "../src/residentApi";
const role = new URLSearchParams(location.search).get("role") || "admin";
function Harness() {
  const [user, setUser] = useState({ id: `fixture-${role}`, role: role === "personal" ? "resident" : role, personal: role === "personal" }), [visible, setVisible] = useState(true);
  return <><div><button onClick={() => { setVisible(true); setUser({ id: "fixture-resident-B", role: "resident" }); }}>Fixture: switch to Resident B</button><button onClick={() => { managedExamsApi.setActor(null); setUser(null); }}>Fixture: logout</button><button onClick={() => { setVisible(true); setUser({ id: "fixture-staff", role: "staff" }); }}>Fixture: login Staff A</button><button onClick={() => setVisible(false)}>Fixture: leave results</button></div>
    {visible && user && (user.personal ? <ManagedPersonalScores key={user.id} userId={user.id} /> : <ManagedExams key={user.id} user={user} />)}</>;
}
createRoot(document.getElementById("root")).render(<Harness />);
