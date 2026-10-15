import React from "react";
import { PGY_LEVELS } from "../examScoring";

// Four MPL boxes (PGY 1-4). values = { 1: "60", 2: "65" }; blank = not set.
export function MplInputs({ values, onChange, maxScore, disabled = false, label = "" }) {
  return (
    <div className="exam-mpl-inputs">
      {PGY_LEVELS.map((pgy) => (
        <label key={pgy}>
          <span>PGY {pgy}</span>
          <input
            aria-label={`MPL PGY ${pgy}${label ? ` ${label}` : ""}`}
            type="number"
            inputMode="decimal"
            min="0"
            max={maxScore || undefined}
            step="0.01"
            value={values?.[pgy] ?? ""}
            disabled={disabled}
            onChange={(event) => onChange({ ...values, [pgy]: event.target.value })}
          />
        </label>
      ))}
    </div>
  );
}
