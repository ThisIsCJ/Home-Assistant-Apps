import { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider.jsx';
import { api } from '../lib/api.js';

const TOUR_KEY = 'devops_tour_v1';
const PAD = 8;

const STEPS = [
  {
    id: 'welcome',
    title: null, // filled dynamically with appName
    body: "Let's take a quick tour of the key features. It'll only take a minute.",
    target: null,
    placement: 'center',
    nextLabel: 'Start tour',
  },
  {
    id: 'new-request',
    title: 'Create a site request',
    body: 'Use this button to provision a new site — set the domain, choose a host and port, then let automation handle the rest.',
    target: '[data-tour="new-request"]',
    placement: 'bottom',
  },
  {
    id: 'kpi',
    title: 'Activity at a glance',
    body: 'These cards show a live count of your requests — how many succeeded, failed, or are currently running.',
    target: '[data-tour="kpi-grid"]',
    placement: 'bottom',
  },
  {
    id: 'request-history',
    title: 'Request history',
    body: 'Browse all past and active requests, view automation logs, and retry failed steps from here.',
    target: '[data-tour="nav-requests"]',
    placement: 'right',
  },
  {
    id: 'site-status',
    title: 'Site health monitoring',
    body: 'Track uptime and latency for your provisioned sites with live health checks.',
    target: '[data-tour="nav-status"]',
    placement: 'right',
  },
  {
    id: 'done',
    title: "You're all set!",
    body: 'That covers the essentials. Use the Profile link at the bottom of the sidebar to update your preferences.',
    target: '[data-tour="nav-profile"]',
    placement: 'right',
    nextLabel: "Let's go",
  },
];

export function Tour() {
  const { appConfig, accessToken } = useAuth();
  const [active, setActive] = useState(false);
  const [step, setStep] = useState(0);
  const [spotlight, setSpotlight] = useState(null);
  const location = useLocation();

  useEffect(() => {
    if (location.pathname !== '/app' || !accessToken) return;
    let cancelled = false;
    let timer;

    api.get('/settings/tour', accessToken)
      .then(data => {
        if (!cancelled && !data.seen) {
          timer = setTimeout(() => setActive(true), 700);
        }
      })
      .catch(() => {
        // Fall back to localStorage if the API is unavailable
        if (!cancelled && !localStorage.getItem(TOUR_KEY)) {
          timer = setTimeout(() => setActive(true), 700);
        }
      });

    return () => { cancelled = true; clearTimeout(timer); };
  }, [location.pathname, accessToken]);

  const current = STEPS[step];

  useEffect(() => {
    if (!active) return;

    const update = () => {
      if (!current.target) { setSpotlight(null); return; }
      const el = document.querySelector(current.target);
      if (!el) { setSpotlight(null); return; }
      const r = el.getBoundingClientRect();
      setSpotlight({ top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 });
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    };

    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [active, step]);

  const finish = useCallback(() => {
    localStorage.setItem(TOUR_KEY, '1');
    setActive(false);
    setStep(0);
    api.post('/settings/tour', { seen: true }, accessToken).catch(() => {});
  }, [accessToken]);

  const next = () => {
    if (step < STEPS.length - 1) setStep(s => s + 1);
    else finish();
  };

  const back = () => setStep(s => Math.max(0, s - 1));

  if (!active) return null;

  const appName = appConfig?.appName || 'DevOps Platform';

  return (
    <div className="tour-overlay">
      {spotlight ? (
        <div className="tour-spotlight" style={spotlight} />
      ) : (
        <div className="tour-backdrop" />
      )}
      <TourTooltip
        step={current}
        index={step}
        total={STEPS.length}
        spotlight={spotlight}
        appName={appName}
        onNext={next}
        onBack={back}
        onSkip={finish}
      />
    </div>
  );
}

function TourTooltip({ step, index, total, spotlight, appName, onNext, onBack, onSkip }) {
  const isCenter = step.placement === 'center' || !spotlight;
  const isFirst = index === 0;
  const isLast = index === total - 1;
  const W = 280;
  const GAP = 14;

  let style = {};
  if (!isCenter && spotlight) {
    if (step.placement === 'right') {
      style = {
        top: Math.max(8, spotlight.top + spotlight.height / 2 - 90),
        left: spotlight.left + spotlight.width + GAP,
        width: W,
      };
    } else {
      const left = spotlight.left + spotlight.width / 2 - W / 2;
      style = {
        top: spotlight.top + spotlight.height + GAP,
        left: Math.max(8, Math.min(left, window.innerWidth - W - 8)),
        width: W,
      };
    }
  }

  const title = isFirst ? `Welcome to ${appName}!` : step.title;

  return (
    <div className={`tour-tooltip${isCenter ? ' tour-tooltip--center' : ''}`} style={isCenter ? {} : style}>
      <div className="tour-tooltip-meta">
        <span className="tour-step-count">{index + 1} / {total}</span>
        {!isLast && (
          <button className="tour-skip-btn" onClick={onSkip}>Skip tour</button>
        )}
      </div>
      <div className="tour-title">{title}</div>
      <div className="tour-body">{step.body}</div>
      <div className="tour-progress">
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className={`tour-pip${i === index ? ' active' : ''}`} />
        ))}
      </div>
      <div className="tour-buttons">
        {!isFirst && (
          <button className="btn btn-sm btn-sec" onClick={onBack}>Back</button>
        )}
        <div style={{ flex: 1 }} />
        <button className="btn btn-sm btn-pri" onClick={onNext}>
          {step.nextLabel || (isLast ? "Let's go" : 'Next')}
        </button>
      </div>
    </div>
  );
}
