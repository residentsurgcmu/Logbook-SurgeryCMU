import React from "react";
import { AmbulanceIcon, BookIcon, CalendarIcon, HospitalIcon, MoonIcon, NeedleIcon, ProcedureIcon, TeachingIcon, UserIcon } from "./Icons";

const iconByActivity = {
  "advisor-meeting": UserIcon,
  "patient-care": HospitalIcon,
  "major-operation-observe": ProcedureIcon,
  "opd-attendance": CalendarIcon,
  conference: TeachingIcon,
  "after-hours-duty": MoonIcon,
  "emergency-duty": AmbulanceIcon,
  "major-operation-assist": ProcedureIcon,
  "minor-operation": ProcedureIcon,
  "wound-suture": NeedleIcon,
  "foley-catheter": NeedleIcon,
  venipuncture: NeedleIcon,
  "stomal-care": HospitalIcon,
  "nasogastric-tube": NeedleIcon,
  "major-trauma-first-aid": AmbulanceIcon,
  proctoscopy: ProcedureIcon,
  "resident-teaching": TeachingIcon,
};

export default function ActivityIcon({ activityType, ...props }) {
  const ActivityIconComponent = iconByActivity[activityType] || BookIcon;
  return <ActivityIconComponent {...props} />;
}
