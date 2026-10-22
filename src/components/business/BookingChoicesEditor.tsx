'use client';
import { type BookingChoices } from '@/lib/funnel-focus';
import './funnel-focus.css';

export function BookingChoicesEditor({ value, onChange, id = 'booking-choices', internal = false, required = false }: {
  value: BookingChoices; onChange: (value: BookingChoices) => void; id?: string; internal?: boolean; required?: boolean;
}) {
  const update = (patch: Partial<BookingChoices>) => onChange({ ...value, ...patch, ...(required ? { enabled: true } : {}), confirmed: false });
  return <div className="booking-choices">
    <p>{internal ? 'Review the service choices below. The client must confirm them during Going live. Configure the booking platform separately.' : required ? 'Visitors will choose the service they’re interested in when booking. Review these choices, then confirm below.' : 'Would it help visitors to choose what they’d like to discuss when booking?'}</p>
    {!required && <label className="booking-choice-toggle"><input type="checkbox" checked={value.enabled} onChange={e => update({ enabled: e.target.checked })} />Ask which service they’re interested in</label>}
    {(required || value.enabled) && <div className="booking-choice-list">
      {value.choices.map((choice, index) => <div className="booking-choice-row" key={choice.id}>
        <label htmlFor={`${id}-${choice.id}`}>Choice {index + 1}</label>
        <input id={`${id}-${choice.id}`} value={choice.label} maxLength={200} placeholder="Service or conversation topic" onChange={e => update({ choices: value.choices.map(c => c.id === choice.id ? { ...c, label: e.target.value } : c) })} />
        <button type="button" aria-label={`Remove choice ${index + 1}`} onClick={() => update({ choices: value.choices.filter(c => c.id !== choice.id) })}>Remove</button>
      </div>)}
      <button type="button" className="btn btn-outline" disabled={value.choices.length >= 20} onClick={() => update({ choices: [...value.choices, { id: crypto.randomUUID(), label: 'Another topic' }] })}>Add a choice</button>
    </div>}
    {required && !internal && <label className="booking-choice-toggle onboarding-check"><input id={`${id}-confirmation`} type="checkbox" required checked={value.enabled && value.confirmed} onChange={e => onChange({ ...value, enabled: true, confirmed: e.target.checked })} /><span>I confirm these are the services visitors can choose from when booking. <strong>Required</strong></span></label>}
    <p className="booking-choice-note">{internal ? value.confirmed ? 'Client confirmation recorded. Changes require confirmation again.' : 'Client confirmation is still required. Save onboarding after changes.' : 'We’ll set up these choices in your booking process and confirm what your booking tool supports.'}</p>
  </div>;
}
