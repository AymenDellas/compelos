'use client';

import { useActionState } from 'react';
import { signClientAgreementAction, type SignAgreementState } from '@/app/actions/portal-actions';

const initialState: SignAgreementState = { error: '', signed: false };

export function AgreementSigningForm({ token, clientName, email, documentSha256 }: {
    token: string;
    clientName: string;
    email: string;
    documentSha256: string;
}) {
    const [state, action, pending] = useActionState(signClientAgreementAction, initialState);
    if (state.signed) return <p className="mark mark-ok">Your signature was saved. A copy is now available above.</p>;

    return (
        <form action={action} className="space-y-4 border-t border-[var(--line)] pt-5">
            <input type="hidden" name="token" value={token} />
            <input type="hidden" name="documentSha256" value={documentSha256} />
            <div>
                <h3 className="font-medium">Sign the agreement</h3>
                <p className="text-sm text-[var(--text-dim)] mt-1">
                    Read the full PDF above. Your typed name, email, and signing time will be added to a saved copy of this agreement.
                </p>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
                <label className="space-y-1.5 text-sm text-[var(--text-dim)]">
                    <span>Your full legal name</span>
                    <input className="field w-full" name="signerName" defaultValue={clientName || ''} autoComplete="name" required minLength={2} maxLength={120} />
                </label>
                <label className="space-y-1.5 text-sm text-[var(--text-dim)]">
                    <span>Your email</span>
                    <input className="field w-full" name="signerEmail" type="email" defaultValue={email || ''} autoComplete="email" required maxLength={254} />
                </label>
            </div>
            <label className="flex items-start gap-3 text-sm text-[var(--text-dim)]">
                <input className="mt-1" type="checkbox" name="signatureConsent" value="accepted" required />
                <span>I have read the agreement, have authority to sign for the client, and agree that typing my name and selecting “Sign agreement” is my electronic signature.</span>
            </label>
            {state.error && <p role="alert" className="text-sm text-[var(--bad)]">{state.error}</p>}
            <button className="btn btn-primary" type="submit" disabled={pending}>
                {pending ? 'Saving signature…' : 'Sign agreement'}
            </button>
        </form>
    );
}
