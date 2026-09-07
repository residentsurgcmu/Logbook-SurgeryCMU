import React from "react";

const Icon = ({ children, size = 20, className = "" }) => (
  <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

export const MailIcon = (props) => <Icon {...props}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></Icon>;
export const LockIcon = (props) => <Icon {...props}><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></Icon>;
export const UserIcon = (props) => <Icon {...props}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></Icon>;
export const BookIcon = (props) => <Icon {...props}><path d="M4 19a3 3 0 0 1 3-3h13" /><path d="M7 4h13v16H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3Z" /><path d="M10 8h7M10 12h7" /></Icon>;
export const ClipboardIcon = (props) => <Icon {...props}><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4a3 3 0 0 1 6 0v2H9Z" /><path d="m9 12 2 2 4-4M9 18h6" /></Icon>;
export const ProcedureIcon = (props) => <Icon {...props}><path d="m14 4 6 6M12 6l6 6M5 21l5-5M4 16l4 4M13 5 4 9a2.8 2.8 0 0 0 4 4l9-9a2.8 2.8 0 0 0-4-4Z" /></Icon>;
export const LogoutIcon = (props) => <Icon {...props}><path d="M10 17l5-5-5-5M15 12H3M15 3h5a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1h-5" /></Icon>;
export const PlusIcon = (props) => <Icon {...props}><path d="M12 5v14M5 12h14" /></Icon>;
export const ChevronIcon = (props) => <Icon {...props}><path d="m9 18 6-6-6-6" /></Icon>;
export const CheckIcon = (props) => <Icon {...props}><path d="m5 12 4 4L19 6" /></Icon>;
export const DownloadIcon = (props) => <Icon {...props}><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M4 20h16" /></Icon>;
export const CloudBackupIcon = (props) => <Icon {...props}><path d="M7 18h10a4 4 0 0 0 .7-7.94A6 6 0 0 0 6.3 8.4 4.5 4.5 0 0 0 7 18Z" /><path d="M12 15V9" /><path d="m9.5 11.5 2.5-2.5 2.5 2.5" /></Icon>;
export const KeyIcon = (props) => <Icon {...props}><circle cx="8" cy="15" r="4" /><path d="m11 12 9-9M15 8l3 3M17 6l2 2" /></Icon>;
export const FileIcon = (props) => <Icon {...props}><path d="M6 2h8l4 4v16H6Z" /><path d="M14 2v5h5M9 13h6M9 17h6" /></Icon>;
export const QrIcon = (props) => <Icon {...props}><rect x="3" y="3" width="6" height="6" rx="1" /><rect x="15" y="3" width="6" height="6" rx="1" /><rect x="3" y="15" width="6" height="6" rx="1" /><path d="M15 15h2v2h-2zM19 15h2v6h-2M15 19h2v2h-2" /></Icon>;
export const ScanIcon = (props) => <Icon {...props}><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" /><path d="M7 12h10" /></Icon>;
export const ClockIcon = (props) => <Icon {...props}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Icon>;
export const ShieldIcon = (props) => <Icon {...props}><path d="M12 3 20 6v5c0 5-3.4 8.4-8 10-4.6-1.6-8-5-8-10V6Z" /><path d="m8.5 12 2.2 2.2 4.8-5" /></Icon>;
export const SearchIcon = (props) => <Icon {...props}><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></Icon>;
export const XIcon = (props) => <Icon {...props}><path d="m6 6 12 12M18 6 6 18" /></Icon>;
export const RefreshIcon = (props) => <Icon {...props}><path d="M20 7v5h-5" /><path d="M4 17v-5h5" /><path d="M6.1 9a7 7 0 0 1 11.2-2L20 12M4 12l2.7 5a7 7 0 0 0 11.2-2" /></Icon>;
export const TrashIcon = (props) => <Icon {...props}><path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6" /></Icon>;
export const CalendarIcon = (props) => <Icon {...props}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 10h18M8 14h2M14 14h2M8 18h2" /></Icon>;
export const HospitalIcon = (props) => <Icon {...props}><path d="M4 21V5h10v16M14 10h6v11M8 9h2M8 13h2M8 17h2M17 14h1M17 18h1" /><path d="M7 5V3h4v2M9 2v4M7 4h4" /></Icon>;
export const MoonIcon = (props) => <Icon {...props}><path d="M20 15.2A8 8 0 0 1 8.8 4 8.5 8.5 0 1 0 20 15.2Z" /></Icon>;
export const AmbulanceIcon = (props) => <Icon {...props}><path d="M3 7h11v10H3ZM14 11h4l3 3v3h-7ZM7 10v4M5 12h4" /><circle cx="7" cy="18" r="2" /><circle cx="18" cy="18" r="2" /></Icon>;
export const NeedleIcon = (props) => <Icon {...props}><path d="m14 4 6 6M12 6l6 6M4 20l8-8M6 14l4 4M3 21l3-1-2-2Z" /></Icon>;
export const TeachingIcon = (props) => <Icon {...props}><path d="M3 5h18v12H3Z" /><path d="M8 21h8M12 17v4M7 10h3M7 13h7" /></Icon>;
export const AlertIcon = (props) => <Icon {...props}><path d="M12 3 2 21h20Z" /><path d="M12 9v5M12 18h.01" /></Icon>;
export const ChartIcon = (props) => <Icon {...props}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></Icon>;
export const CertificateIcon = (props) => <Icon {...props}><circle cx="12" cy="9" r="6" /><path d="m8 14-1 7 5-3 5 3-1-7M9.5 9l1.5 1.5L14.5 7" /></Icon>;
