import React from "react";

const paths = {
  trauma: <><path d="m12 3 8 3v5c0 5-4 8-8 10-4-2-8-5-8-10V6Z" /><path d="M12 7v9M8 11h8" /></>,
  general: <><path d="m15 3 6 6-9 9-4-4Z" /><path d="m8 14-5 7M13 5l6 6M4 4v6M1 7h6" /></>,
  vascular: <><path d="M10 21V4M14 21V4M10 9 4 4M14 12l6-5M10 16l-6 3M14 18l6 3" /><path d="M4 3v4M20 6v4" /></>,
  digestive: <><path d="M11 2v6c0 3-6 2-7 7-1 5 4 7 8 6 5-1 9-5 8-10-.6-3-3-4-5-3V2" /><path d="M8 14c2 1 4-1 5-2" /></>,
  colorectal: <><path d="M9 20V9c0-2-5-2-5 0V5c0-3 16-3 16 0v14c0 3-7 3-7 0v-3c0-2 4-2 4 0M4 9v9c0 2 2 3 5 2" /><path d="M8 6h8M7 11v4" /></>,
  hpb: <><path d="M3 8c6-5 14-4 18 0l-2 8-8-3-8 4Z" /><path d="m11 5 1 8M14 14c-3 0-4 4-2 5 2 1 4-3 2-5ZM13 19v3" /></>,
  breast: <><path d="m7 3-2 5c-1 3-3 7 0 10 2 2 5 1 7-1 2 2 5 3 7 1 3-3 1-7 0-10l-2-5M12 7v10" /><path d="M6 14h2M16 14h2" /></>,
  laparoscopic: <><path d="m4 4 4-2 4 5-4 3ZM10 9l9 12M15 3h6v5h-6ZM18 8v5M3 18h7M6 15v6" /></>,
  endocrine: <><path d="M10 8C2 2 2 9 5 15c2 4 5 3 5-2h4c0 5 3 6 5 2 3-6 3-13-5-7ZM10 8h4M11 2v6M13 2v6" /></>,
  airway: <><path d="M9 2v11l-6 6M15 2v11l6 6M9 6h6M9 10h6M9 13l3 2 3-2M6 16l3 3M15 19l3-3" /></>,
};

export default function AssessmentTopicIcon({ topic }) {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[topic] || paths.general}</svg>;
}
