const Icon = ({ path, size = 16, fill = 'none', stroke = 'currentColor', sw = 1.75, children, ...rest }) => (
  <svg
    width={size} height={size} viewBox="0 0 24 24"
    fill={fill} stroke={stroke} strokeWidth={sw}
    strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true" {...rest}
  >
    {path ? <path d={path} /> : children}
  </svg>
);

export const Home = (p) => <Icon {...p}><path d="M3 11 12 4l9 7" /><path d="M5 10v10h14V10" /></Icon>;
export const Grid = (p) => <Icon {...p}><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></Icon>;
export const Inbox = (p) => <Icon {...p}><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6Z" /></Icon>;
export const Users = (p) => <Icon {...p}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></Icon>;
export const Chart = (p) => <Icon {...p}><path d="M3 3v18h18" /><path d="M7 15l4-4 3 3 5-6" /></Icon>;
export const FileText = (p) => <Icon {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M8 13h8" /><path d="M8 17h5" /></Icon>;
export const Settings = (p) => <Icon {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></Icon>;
export const HelpCircle = (p) => <Icon {...p}><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><path d="M12 17h.01" /></Icon>;
export const Bell = (p) => <Icon {...p}><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></Icon>;
export const Calendar = (p) => <Icon {...p}><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4" /><path d="M8 2v4" /><path d="M3 10h18" /></Icon>;
export const Menu = (p) => <Icon {...p}><path d="M3 6h18" /><path d="M3 12h18" /><path d="M3 18h18" /></Icon>;
export const ChevronDown = (p) => <Icon {...p} sw={2}><path d="m6 9 6 6 6-6" /></Icon>;
export const ChevronUp = (p) => <Icon {...p} sw={2}><path d="m18 15-6-6-6 6" /></Icon>;
export const ChevronRight = (p) => <Icon {...p} sw={2}><path d="m9 6 6 6-6 6" /></Icon>;
export const ChevronLeft = (p) => <Icon {...p} sw={2}><path d="m15 6-6 6 6 6" /></Icon>;
export const ChevronsLeft = (p) => <Icon {...p} sw={2}><path d="m11 17-5-5 5-5" /><path d="m18 17-5-5 5-5" /></Icon>;
export const PanelLeft = (p) => <Icon {...p}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18" /></Icon>;
export const User = (p) => <Icon {...p}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></Icon>;
export const Shield = (p) => <Icon {...p}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></Icon>;
export const LogOut = (p) => <Icon {...p}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" /></Icon>;
export const AppsGrid = (p) => <Icon {...p}><circle cx="5" cy="5" r="1.5" /><circle cx="12" cy="5" r="1.5" /><circle cx="19" cy="5" r="1.5" /><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /><circle cx="5" cy="19" r="1.5" /><circle cx="12" cy="19" r="1.5" /><circle cx="19" cy="19" r="1.5" /></Icon>;
export const Sun = (p) => <Icon {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v2" /><path d="M12 20v2" /><path d="m4.93 4.93 1.41 1.41" /><path d="m17.66 17.66 1.41 1.41" /><path d="M2 12h2" /><path d="M20 12h2" /><path d="m6.34 17.66-1.41 1.41" /><path d="m19.07 4.93-1.41 1.41" /></Icon>;
export const Moon = (p) => <Icon {...p}><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></Icon>;
export const Monitor = (p) => <Icon {...p}><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8" /><path d="M12 17v4" /></Icon>;
export const Sliders = (p) => <Icon {...p}><path d="M4 6h16" /><path d="M4 12h16" /><path d="M4 18h16" /><circle cx="9" cy="6" r="2" fill="var(--panel)" /><circle cx="15" cy="12" r="2" fill="var(--panel)" /><circle cx="7" cy="18" r="2" fill="var(--panel)" /></Icon>;
export const Plus = (p) => <Icon {...p} sw={2}><path d="M12 5v14" /><path d="M5 12h14" /></Icon>;
export const Download = (p) => <Icon {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5" /><path d="M12 15V3" /></Icon>;
export const Upload = (p) => <Icon {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m17 8-5-5-5 5" /><path d="M12 3v12" /></Icon>;
export const ArrowUp = (p) => <Icon {...p} sw={2}><path d="M12 19V5" /><path d="m5 12 7-7 7 7" /></Icon>;
export const ArrowDown = (p) => <Icon {...p} sw={2}><path d="M12 5v14" /><path d="m19 12-7 7-7-7" /></Icon>;
export const X = (p) => <Icon {...p} sw={2}><path d="M18 6 6 18" /><path d="m6 6 12 12" /></Icon>;
export const Lock = (p) => <Icon {...p}><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></Icon>;
export const Check = (p) => <Icon {...p} sw={2}><path d="M20 6 9 17l-5-5" /></Icon>;
export const List = (p) => <Icon {...p}><path d="M8 6h13" /><path d="M8 12h13" /><path d="M8 18h13" /><path d="M3 6h.01" /><path d="M3 12h.01" /><path d="M3 18h.01" /></Icon>;
export const Columns = (p) => <Icon {...p}><path d="M12 3h7a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-7m0-18H5a2 2 0 0 1-2 2v14a2 2 0 0 1 2 2h7m0-18v18" /></Icon>;
export const Folder = (p) => <Icon {...p}><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></Icon>;
export const Tag = (p) => <Icon {...p}><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><line x1="7" y1="7" x2="7.01" y2="7" /></Icon>;
export const GripVertical = (p) => <Icon {...p}><circle cx="9" cy="6" r="1" fill="currentColor" stroke="none" /><circle cx="15" cy="6" r="1" fill="currentColor" stroke="none" /><circle cx="9" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="15" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="9" cy="18" r="1" fill="currentColor" stroke="none" /><circle cx="15" cy="18" r="1" fill="currentColor" stroke="none" /></Icon>;
