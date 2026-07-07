import { Icons } from '../components/Icons';

export default function Placeholder({ title, icon: Icon = Icons.Info, description }) {
  return (
    <>
      <div className="page-header">
        <div className="page-title">{title}</div>
      </div>
      <div className="empty-state" style={{ minHeight: 240 }}>
        <div className="empty-state-icon"><Icon size={36} /></div>
        <div className="empty-state-text">{title} — Coming Soon</div>
        <div className="empty-state-sub">{description || 'This module is planned for a future release.'}</div>
      </div>
    </>
  );
}
