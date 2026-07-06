import { useNavigate } from 'react-router-dom';
import { Icons } from '../components/Icons.jsx';
import { useAuth } from '../auth/AuthProvider.jsx';

const FEATURES = [
  { icon: Icons.Shield,   title: 'Controlled access',       desc: 'Admins decide which users and teams can use which domains, certificates, and hosts.' },
  { icon: Icons.Server,   title: 'Host validation',         desc: 'The platform SSHes to the target host to verify port state and firewall readiness before routing.' },
  { icon: Icons.Activity, title: 'Resilient execution',     desc: 'Each workflow step runs independently. A firewall failure won\'t stop DNS from being provisioned.' },
  { icon: Icons.Globe,    title: 'Cloudflare DNS',          desc: 'DNS records are created automatically for the requested hostname using the Cloudflare API.' },
  { icon: Icons.Link,     title: 'NGINX route creation',    desc: 'Routes are created via the NGINX API and attached to the correct certificate profile.' },
  { icon: Icons.Terminal, title: 'Live status visibility',  desc: 'Watch each step complete in real time with expandable per-step details and exact error messages.' },
];

const HOW_STEPS = [
  { title: 'Select a host, domain, and port.', desc: 'Choose from only the hosts and domains your team is authorized to use. Enter the target port where your service listens.' },
  { title: 'The platform validates and applies changes.', desc: 'The system checks host reachability, adds or verifies firewall rules, confirms the service is up, and creates the NGINX route.' },
  { title: 'DNS is provisioned and every result is tracked.', desc: 'A Cloudflare DNS record is created for your requested hostname. All step results, including any failures, are stored and visible.' },
];

export function Home() {
  const navigate = useNavigate();
  const { appConfig } = useAuth();
  const appName = appConfig?.appName || 'DevOps Platform';

  return (
    <div className="home-page">
      <nav className="home-nav">
        <div className="home-nav-logo">
          <div className="sidebar-brand-logo" style={{width:28,height:28,borderRadius:7}}>
            <Icons.Server size={14} style={{color:'#fff'}} />
          </div>
          <span className="sidebar-brand-text">{appName}</span>
        </div>
        <div className="home-nav-links">
          <button className="home-nav-link" onClick={() => document.getElementById('how').scrollIntoView({behavior:'smooth'})}>How it works</button>
          <button className="home-nav-link" onClick={() => document.getElementById('security').scrollIntoView({behavior:'smooth'})}>Security</button>
          <button className="btn btn-pri btn-sm" onClick={() => navigate('/login')}>Sign in</button>
        </div>
      </nav>

      <section className="home-hero">
        <h1>Self-service site provisioning with live operational visibility.</h1>
        <p>Give your teams a faster path to publish new sites while keeping domain access, host access, and infrastructure changes under admin control.</p>
        <div className="home-hero-ctas">
          <button className="btn btn-pri" onClick={() => navigate('/login')}>
            <Icons.Lock size={14} /> Sign in to get started
          </button>
          <button className="btn btn-sec" onClick={() => document.getElementById('how').scrollIntoView({behavior:'smooth'})}>
            See how it works
          </button>
        </div>
      </section>

      <section className="home-section" id="features">
        <div className="home-section-title">Platform capabilities</div>
        <div className="home-section-sub">Everything your team needs to go from request to live site.</div>
        <div className="feature-grid">
          {FEATURES.map(f => (
            <div className="feature-card" key={f.title}>
              <div className="feature-icon"><f.icon size={18} /></div>
              <div className="feature-title">{f.title}</div>
              <div className="feature-desc">{f.desc}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="home-section" id="how">
        <div className="home-section-title">How it works</div>
        <div className="home-section-sub">Three steps from request to live DNS.</div>
        <div className="card">
          <div className="card-body">
            {HOW_STEPS.map((s, i) => (
              <div className="how-step" key={i}>
                <div className="how-step-num">{i + 1}</div>
                <div>
                  <div className="how-step-title">{s.title}</div>
                  <div className="how-step-desc">{s.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="home-section" id="security">
        <div className="home-section-title">Security and governance</div>
        <div className="home-section-sub">Every request is controlled, logged, and auditable.</div>
        <div className="grid-2">
          {[
            { icon: Icons.Lock,    title: 'Authentik SSO', desc: 'Authentication is handled by your local Authentik server. No external identity dependencies.' },
            { icon: Icons.Shield,  title: 'RBAC',          desc: 'Admin and user roles control who can configure the platform vs. who can submit requests.' },
            { icon: Icons.Users,   title: 'Team access',   desc: 'Domain and host access is granted by team. Users only see resources their team is authorized to use.' },
            { icon: Icons.Clock,   title: 'Audit log',     desc: 'All configuration changes and automation runs are recorded with actor, action, and timestamp.' },
          ].map(f => (
            <div className="feature-card" key={f.title}>
              <div className="feature-icon"><f.icon size={18} /></div>
              <div className="feature-title">{f.title}</div>
              <div className="feature-desc">{f.desc}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="home-section" style={{textAlign:'center'}}>
        <div className="home-section-title" style={{marginBottom:8}}>Ready to provision your first site?</div>
        <p style={{color:'var(--muted2)', fontSize:'0.82rem', marginBottom:24}}>Sign in with your organization account to get started.</p>
        <button className="btn btn-pri" onClick={() => navigate('/login')}>
          <Icons.Lock size={14} /> Sign in
        </button>
      </section>

      <footer className="home-footer">
        © {new Date().getFullYear()} {appName} — Self-service infrastructure provisioning
      </footer>
    </div>
  );
}
