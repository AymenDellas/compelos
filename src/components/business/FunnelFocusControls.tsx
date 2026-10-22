'use client';
import { useId } from 'react';
import { FOCUS_LABELS, newFunnelFocus, type FocusAnalysis, type FunnelFocus } from '@/lib/funnel-focus';
import './funnel-focus.css';

/** Operator controls only. Never render this in the public portal. */
export function FunnelFocusControls({ value, analysis, onChange, onApprove, disabled = false }: {
  value?: FunnelFocus; analysis?: FocusAnalysis; onChange: (value: FunnelFocus) => void;
  onApprove?: () => void; disabled?: boolean;
}) {
  const groupId = useId();
  const focus = value || newFunnelFocus('specific_offer', analysis);
  const recommendation = analysis?.recommendation || focus.recommendation;
  return <fieldset className="funnel-focus" disabled={disabled}>
    <legend>Funnel focus</legend>
    {recommendation && <div className="focus-recommendation" role="status">
      <strong>{recommendation.mode ? `Recommended: ${FOCUS_LABELS[recommendation.mode]}` : 'Review needed before choosing'}</strong>
      <p>{recommendation.rationale}</p>
      {(recommendation.confidence === 'low' || recommendation.uncertainties.length > 0) && <p className="focus-uncertainty">{recommendation.confidence === 'low' ? 'Limited confidence. ' : ''}{recommendation.uncertainties.join(' ')}</p>}
    </div>}
    <div className="focus-options">
      {(['specific_offer', 'practice_wide'] as const).map(mode => <label key={mode}>
        <input type="radio" name={`funnel-focus-${groupId}`} checked={focus.mode === mode} onChange={() => onChange({ ...focus, mode, approvedAt: '' })} />
        <span><strong>{FOCUS_LABELS[mode]}</strong><small>{mode === 'specific_offer' ? 'One defined service and its own audience, terms and proof.' : 'One coherent practice positioning, supported by relevant services. One discovery-call action.'}</small></span>
      </label>)}
    </div>
    {focus.services.length > 0 && <details className="focus-services" open={!focus.approvedAt}>
      <summary>Detected services ({focus.services.length})</summary>
      {focus.services.map(service => <div key={service.id} className="focus-service">
        {focus.mode === 'practice_wide' ? <label><input type="checkbox" checked={service.included} onChange={e => {
          const included = e.target.checked;
          onChange({ ...focus, approvedAt: '', services: focus.services.map(s => s.id === service.id ? { ...s, included } : s),
            booking: { ...focus.booking, confirmed: false, choices: included
              ? focus.booking.choices.some(c => c.serviceId === service.id) ? focus.booking.choices : [...focus.booking.choices, { id: `booking-${service.id}`, label: service.name, serviceId: service.id }]
              : focus.booking.choices.filter(c => c.serviceId !== service.id) } });
        }} /><strong>{service.name}</strong></label> : <strong>{service.name}</strong>}
        <p>{service.description}</p>
        <details><summary>Source evidence</summary>{service.evidence.map((e, i) => <blockquote key={i}>{e.quote}{e.url && <a href={e.url} target="_blank" rel="noreferrer">View source ↗</a>}</blockquote>)}</details>
      </div>)}
    </details>}
    <p className="focus-help">You make the final decision. Check that the audience and problem belong together; leave unrelated services out. The five brief fields below remain editable.</p>
    {onApprove && <button type="button" className="btn btn-outline" onClick={onApprove}>{focus.approvedAt ? 'Confirm funnel focus again' : 'Confirm funnel focus'}</button>}
  </fieldset>;
}
