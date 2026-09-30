/** Shared, serializable business records. Kept independent of the lead send gate. */
export type BusinessView = 'today' | 'onboarding';
export const FUNNEL_TYPES = ['DIRECT_TO_CALL', 'VSL', 'LEAD_MAGNET'] as const;
export type FunnelType = (typeof FUNNEL_TYPES)[number];
export const FUNNEL_LABELS: Record<FunnelType, string> = {
    DIRECT_TO_CALL: 'Direct-to-Call',
    VSL: 'VSL',
    LEAD_MAGNET: 'Lead Magnet',
};
export type OfferProfile = {
    name: string;
    website: string;
    promise: string;
    primaryAudience: string;
    secondaryAudience: string;
    markets: string;
    exclusions: string;
    signals: string;
    priceMin: number;
    priceMax: number;
    paymentTrigger: string;
    measurementPolicy: string;
    caseStudyTerms: string;
    brand: string;
    outreach: string;
    personalBrand: string;
    status: string;
    funnels: Record<FunnelType, { description: string; deliverables: string }>;
    onboardingTemplates?: OnboardingTemplates;
};

export type OnboardingTemplates = {
    freeAgreement: string;
    paidAgreement: string;
    welcome: string;
    paymentRequest: string;
    accessRequest: string;
    reminder: string;
    scopeConfirmation: string;
    projectReady: string;
};

export const DEFAULT_ONBOARDING_TEMPLATES: OnboardingTemplates = {
    freeAgreement:
        'This project is provided at no charge in exchange for the case-study permission described below. The client owns the final approved funnel assets. Compel retains its reusable systems, templates, frameworks, tools, and processes.',
    paidAgreement:
        'Work begins after the agreement is signed and the agreed initial payment is received. Once agreed payment is complete, the client owns the final approved deliverables created specifically for them. Compel retains its reusable systems, templates, frameworks, tools, and processes.',
    welcome:
        'Welcome, {{client_name}}. This page keeps every item needed to start {{project_name}} in one place. Please complete the outstanding items below and contact us if anything is unclear.',
    paymentRequest:
        'Your agreement is complete. Please use the secure payment link below to complete the agreed payment for {{project_name}}.',
    accessRequest:
        'To prepare {{project_name}}, please grant the access listed below using collaborator or team access. Please do not send passwords.',
    reminder:
        'A quick reminder: we still need {{outstanding_items}} before {{project_name}} can start. If you are blocked on anything, reply and we will help.',
    scopeConfirmation:
        'Please review the included and excluded work below. Confirming this scope gives both sides one clear plan for delivery.',
    projectReady:
        '{{project_name}} is fully onboarded and ready to build. The agreement, information, access, baseline, and scope are now organized in the project record.',
};
export const currentFreeAgreementIntro = (value: string) =>
    value.replace('case-study permissions selected below', 'case-study permission described below');
export const DEFAULT_OFFER: OfferProfile = {
    name: 'Compel',
    website: 'https://getcompel.co',
    promise:
        'Complete conversion funnels for coaches. $0 upfront; payment only when discovery call bookings increase.',
    primaryAudience: 'Executive, business, and leadership coaches',
    secondaryAudience: 'Life and career coaches with strong qualifying signals',
    markets: 'United States, United Kingdom, Canada — English-speaking markets',
    exclusions: 'Founder, CEO, or consultant unless explicitly paired with Coach',
    signals:
        'Active on LinkedIn within 30 days; has a website; shows signs of running or trying to run an inbound funnel.',
    priceMin: 1500,
    priceMax: 4000,
    paymentTrigger: 'Discovery call bookings increase.',
    measurementPolicy: '',
    caseStudyTerms: '',
    brand: 'Near-black, warm off-white, electric lime. Weight Pull wordmark. Previously Revlane.',
    outreach:
        'Initial email → reply → same-day Loom with calendar link and specific available slots → follow up after 48 hours if unbooked → breakup follow-up. No qualifying-question step.',
    personalBrand:
        'Phase 1: Algerian Instagram account in Darija, documenting the Compel build, marketing education, and mindset. Phase 2: English account tied to Compel after traction and results.',
    status: 'Pre-revenue at the time of the supplied knowledge base; first-client case-study outreach underway.',
    funnels: {
        DIRECT_TO_CALL: {
            description: 'For coaches whose primary call to action is a discovery call.',
            deliverables:
                'Booking-focused landing page copy and design\nNurture email sequence\nIntegrated booking flow',
        },
        VSL: {
            description: 'For higher-ticket offers and coaches with a strong on-camera presence.',
            deliverables:
                'Video-led landing page copy and design\nVSL outline and supporting copy\nNurture email sequence\nIntegrated booking flow',
        },
        LEAD_MAGNET: {
            description: 'For cold or awareness-stage audiences: freebie → nurture → booking.',
            deliverables:
                'Opt-in page copy and design\nLead magnet delivery flow\nNurture email sequence\nIntegrated booking flow',
        },
    },
    onboardingTemplates: DEFAULT_ONBOARDING_TEMPLATES,
};
export type OfferVersion = { version: number; profile: OfferProfile; createdAt: string };

export const SALES_STAGES = [
    'NEW',
    'EMAILED',
    'REPLIED',
    'LOOM_SENT',
    'FOLLOW_UP',
    'BREAKUP',
    'BOOKED',
    'PROPOSAL',
    'WON',
    'LOST',
] as const;
export type SalesStage = (typeof SALES_STAGES)[number];
export type OpportunityData = {
    name: string;
    email: string;
    website: string;
    stage: SalesStage;
    niche: string;
    audience: string;
    currentOffer: string;
    bookingPath: string;
    evidence: string;
    opportunity: string;
    unknowns: string;
    funnel: FunnelType | '';
    recommendationReason: string;
    mode: 'PERFORMANCE' | 'CASE_STUDY';
    fee: number | null;
    terms: string;
    loomUrl: string;
    bookingUrl: string;
    proposalUrl: string;
    nextAction: string;
    dueAt: string;
    callAt: string;
    lostReason: string;
    notes: string;
    repliedAt: string;
    loomSentAt: string;
    audienceStage?: 'UNKNOWN' | 'COLD' | 'WARM';
    videoReadiness?: 'UNKNOWN' | 'READY' | 'NOT_READY';
    offerTier?: 'UNKNOWN' | 'HIGH_TICKET' | 'STANDARD';
    primaryCta?: 'UNKNOWN' | 'CALL' | 'OPT_IN';
};
export type Opportunity = {
    id: string;
    leadId: string | null;
    offerVersion: number;
    revision: number;
    data: OpportunityData;
    updatedAt: string;
};
export type Deliverable = {
    id: string;
    title: string;
    status: 'TODO' | 'DOING' | 'BLOCKED' | 'REVIEW' | 'DONE';
    dueAt: string;
    content: string;
    url: string;
};
export type Measurement = {
    baselineStart: string;
    baselineEnd: string;
    baselineBookings: number | null;
    baselineVisitors: number | null;
    currentStart: string;
    currentEnd: string;
    currentBookings: number | null;
    currentVisitors: number | null;
    minimumIncrease: number | null;
    countingRules: string;
    attribution: string;
    evidenceUrl: string;
    agreed: boolean;
    reviewed: boolean;
};

export const AGREEMENT_STATUSES = [
    'DRAFT',
    'SENT',
    'VIEWED',
    'SIGNED_CLIENT',
    'FULLY_SIGNED',
] as const;
export type AgreementStatus = (typeof AGREEMENT_STATUSES)[number];
export const PAYMENT_STATUSES = [
    'NOT_SENT',
    'LINK_SENT',
    'DEPOSIT_PAID',
    'FULLY_PAID',
    'OVERDUE',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export type AccessStatus = 'NOT_REQUESTED' | 'REQUESTED' | 'RECEIVED' | 'VERIFIED' | 'NOT_NEEDED';
export type OnboardingDocument = {
    id: string;
    name: string;
    kind: 'AGREEMENT' | 'PAYMENT' | 'FORM' | 'SCOPE' | 'ASSET' | 'ACCESS' | 'BASELINE' | 'PERMISSION';
    url: string;
    fileName: string;
    dataUrl?: string;
    createdAt: string;
};
export type AccessItem = {
    id: string;
    platform: string;
    reason: string;
    permission: string;
    instructions: string;
    status: AccessStatus;
    required: boolean;
    nonBlocking: boolean;
};
export type OnboardingData = {
    clientName: string;
    businessName: string;
    email: string;
    website: string;
    projectName: string;
    projectType: 'PAID' | 'CASE_STUDY';
    targetStartDate: string;
    portalToken: string;
    agreement: {
        status: AgreementStatus;
        intro: string;
        scope: string;
        deliverables: string;
        timeline: string;
        clientResponsibilities: string;
        compelResponsibilities: string;
        ownership: string;
        caseStudyRights: string;
        confidentiality: string;
        termination: string;
        revisions: string;
        sentAt: string;
        signedPdfName: string;
        signedPdfData?: string;
    };
    payment: {
        structure: 'FULL' | 'DEPOSIT' | 'CUSTOM';
        status: PaymentStatus;
        price: number | null;
        currency: string;
        deposit: number | null;
        balance: number | null;
        dueDate: string;
        link: string;
        notes: string;
    };
    form: {
        status: 'NOT_SENT' | 'SENT' | 'IN_PROGRESS' | 'COMPLETE';
        offer: string;
        audience: string;
        customerProblem: string;
        desiredOutcome: string;
        trafficSources: string;
        landingPageUrl: string;
        bookingUrl: string;
        qualification: string;
        nurture: string;
        traffic: string;
        bookings: string;
        showRate: string;
        closeRate: string;
        bookingPlatform: string;
        crm: string;
        emailPlatform: string;
        analyticsPlatform: string;
        hostingPlatform: string;
        domainProvider: string;
        websitePlatform: string;
        repositoryProvider: string;
        assets: string;
        mustStay: string;
        avoid: string;
        importantContext: string;
        caseStudyConsent: boolean;
    };
    access: AccessItem[];
    baseline: {
        captured: boolean;
        capturedAt: string;
        landingPage: string;
        hero: string;
        bookingFlow: string;
        currentCopy: string;
        cta: string;
        nurtureEmails: string;
        analyticsEvidence: string;
        traffic: string;
        bookings: string;
        showRate: string;
        closeRate: string;
        notes: string;
    };
    scope: {
        included: string;
        excluded: string;
        targetLaunchDate: string;
        approvalOwner: string;
        revisionProcess: string;
        dependencies: string;
        confirmed: boolean;
        confirmedAt: string;
    };
    overrides: string[];
    documents: OnboardingDocument[];
};

export const CASE_STUDY_CONSENT_TEXT =
    'I authorize Compel to document this project and use my business name and logo, before-and-after website screenshots, the finished work, and verified results I provide (including traffic, booking, conversion, and revenue figures) on its website and portfolio, in proposals and presentations, and on LinkedIn. Any testimonial or direct quote will be shown to me for approval before publication. Compel will not publish passwords, confidential customer information, or unverified results, and will anonymize sensitive figures when we agree to do so.';

export const REQUIRED_ONBOARDING_FORM_FIELDS = [
    ['offer', 'Offer being promoted'],
    ['audience', 'Target audience'],
    ['customerProblem', 'Main customer problem'],
    ['desiredOutcome', 'Desired outcome'],
] as const;

export function missingOnboardingFormFields(data: OnboardingData): string[] {
    const missing: string[] = REQUIRED_ONBOARDING_FORM_FIELDS
        .filter(([key]) => !String(data.form[key] || '').trim())
        .map(([, label]) => label);
    if (data.projectType === 'CASE_STUDY' && !data.form.caseStudyConsent)
        missing.push('Case-study permission');
    return missing;
}

export function onboardingFormComplete(data: OnboardingData): boolean {
    return data.form.status === 'COMPLETE' && missingOnboardingFormFields(data).length === 0;
}

export type ProjectData = {
    name: string;
    funnel: FunnelType;
    mode: 'PERFORMANCE' | 'CASE_STUDY';
    fee: number | null;
    terms: string;
    status: 'ONBOARDING' | 'BUILDING' | 'APPROVAL' | 'LIVE' | 'COMPLETE';
    brief: string;
    assets: string;
    launchAt: string;
    deliverables: Deliverable[];
    measurement: Measurement;
    invoiceStatus: 'NOT_INVOICED' | 'DRAFT' | 'SENT' | 'PAID';
    invoiceUrl: string;
    onboarding?: OnboardingData;
};
export type ClientProject = {
    id: string;
    opportunityId: string;
    offerVersion: number;
    revision: number;
    data: ProjectData;
    updatedAt: string;
};
export type BusinessSnapshot = {
    offer: OfferVersion;
    opportunities: Opportunity[];
    projects: ClientProject[];
};

export function blankOpportunity(): OpportunityData {
    return {
        name: '',
        email: '',
        website: '',
        stage: 'NEW',
        niche: '',
        audience: '',
        currentOffer: '',
        bookingPath: '',
        evidence: '',
        opportunity: '',
        unknowns: '',
        funnel: '',
        recommendationReason: '',
        mode: 'PERFORMANCE',
        fee: null,
        terms: '',
        loomUrl: '',
        bookingUrl: '',
        proposalUrl: '',
        nextAction: 'Send initial email',
        dueAt: '',
        callAt: '',
        lostReason: '',
        notes: '',
        repliedAt: '',
        loomSentAt: '',
        audienceStage: 'UNKNOWN',
        videoReadiness: 'UNKNOWN',
        offerTier: 'UNKNOWN',
        primaryCta: 'UNKNOWN',
    };
}

export function buildProject(data: OpportunityData, profile: OfferProfile): ProjectData {
    if (!data.funnel) throw new Error('Choose a funnel before creating the client project.');
    const titles = [
        'Onboarding brief and access',
        ...profile.funnels[data.funnel].deliverables.split('\n').filter(Boolean),
        'Client approval',
        'Launch and booking test',
    ];
    const project: ProjectData = {
        name: data.name,
        funnel: data.funnel,
        mode: data.mode,
        fee: data.fee,
        terms: data.terms,
        status: 'ONBOARDING',
        brief: [data.audience, data.currentOffer, data.opportunity].filter(Boolean).join('\n\n'),
        assets: '',
        launchAt: '',
        deliverables: titles.map((title, i) => ({
            id: `deliverable-${i}`,
            title,
            status: 'TODO',
            dueAt: '',
            content: '',
            url: '',
        })),
        measurement: {
            baselineStart: '',
            baselineEnd: '',
            baselineBookings: null,
            baselineVisitors: null,
            currentStart: '',
            currentEnd: '',
            currentBookings: null,
            currentVisitors: null,
            minimumIncrease: null,
            countingRules: '',
            attribution: '',
            evidenceUrl: '',
            agreed: false,
            reviewed: false,
        },
        invoiceStatus: 'NOT_INVOICED',
        invoiceUrl: '',
    };
    project.onboarding = createOnboardingData(project, data, profile);
    return project;
}

export function createOnboardingData(
    project: ProjectData,
    opportunity?: Partial<OpportunityData>,
    profile: OfferProfile = DEFAULT_OFFER,
): OnboardingData {
    const isCaseStudy = project.mode === 'CASE_STUDY';
    const deliverables = project.deliverables
        .map((item) => item.title)
        .filter((title) => !/onboarding|approval|launch/i.test(title))
        .join('\n');
    const templates = profile.onboardingTemplates || DEFAULT_ONBOARDING_TEMPLATES;
    return {
        clientName: opportunity?.name || project.name,
        businessName: opportunity?.name || project.name,
        email: opportunity?.email || '',
        website: opportunity?.website || '',
        projectName: `${project.name} funnel`,
        projectType: isCaseStudy ? 'CASE_STUDY' : 'PAID',
        targetStartDate: '',
        portalToken: '',
        agreement: {
            status: 'DRAFT',
            intro: isCaseStudy ? currentFreeAgreementIntro(templates.freeAgreement) : templates.paidAgreement,
            scope: project.brief || `${FUNNEL_LABELS[project.funnel]} funnel for ${project.name}.`,
            deliverables,
            timeline: project.launchAt
                ? `Target launch: ${project.launchAt}`
                : 'Timeline begins when all onboarding blockers are cleared.',
            clientResponsibilities:
                'Provide accurate business information, requested assets and necessary access; give feedback and approvals in a reasonable timeframe; ensure supplied claims, testimonials and data are accurate.',
            compelResponsibilities:
                'Diagnose the current funnel, create the approved deliverables, communicate progress, implement the agreed work, protect client information, and meet timelines when dependencies are available.',
            ownership: isCaseStudy
                ? 'The client owns the final approved funnel assets delivered to them. Compel retains its internal tools, frameworks and reusable systems. Public use follows the case-study permission below.'
                : 'Once agreed payment is complete, the client owns the final approved deliverables created specifically for them. Compel retains its internal systems, templates, reusable frameworks, tools and processes.',
            caseStudyRights: isCaseStudy
                ? 'Compel may document and publish project work only as described in the case-study permission below.'
                : 'Portfolio and case-study use requires separate written permission from the client.',
            confidentiality:
                'Both parties will keep non-public business, customer and access information confidential where reasonably required.',
            termination:
                'Either party may end the project with written notice. Completed work, outstanding payments and return or removal of access will be handled promptly.',
            revisions: isCaseStudy
                ? 'Reasonable revisions are limited to the confirmed scope.'
                : 'Revision rounds follow the confirmed project scope. Work outside that scope requires separate approval.',
            sentAt: '',
            signedPdfName: '',
        },
        payment: {
            structure: 'FULL',
            status: isCaseStudy ? 'FULLY_PAID' : 'NOT_SENT',
            price: project.fee,
            currency: 'USD',
            deposit: null,
            balance: project.fee,
            dueDate: '',
            link: project.invoiceUrl,
            notes: '',
        },
        form: {
            status: 'NOT_SENT',
            offer: opportunity?.currentOffer || '',
            audience: opportunity?.audience || '',
            customerProblem: '',
            desiredOutcome: '',
            trafficSources: '',
            landingPageUrl: opportunity?.website || '',
            bookingUrl: opportunity?.bookingUrl || '',
            qualification: '',
            nurture: '',
            traffic: '',
            bookings: '',
            showRate: '',
            closeRate: '',
            bookingPlatform: '',
            crm: '',
            emailPlatform: '',
            analyticsPlatform: '',
            hostingPlatform: '',
            domainProvider: '',
            websitePlatform: '',
            repositoryProvider: '',
            assets: '',
            mustStay: '',
            avoid: '',
            importantContext: opportunity?.unknowns || '',
            caseStudyConsent: false,
        },
        access: [],
        baseline: {
            captured: false,
            capturedAt: '',
            landingPage: '',
            hero: '',
            bookingFlow: '',
            currentCopy: '',
            cta: '',
            nurtureEmails: '',
            analyticsEvidence: '',
            traffic: '',
            bookings: '',
            showRate: '',
            closeRate: '',
            notes: '',
        },
        scope: {
            included: deliverables,
            excluded: '',
            targetLaunchDate: project.launchAt,
            approvalOwner: opportunity?.name || project.name,
            revisionProcess: 'One consolidated feedback round per milestone unless otherwise agreed.',
            dependencies: 'Signed agreement, required payment, completed form, verified access, and baseline capture.',
            confirmed: false,
            confirmedAt: '',
        },
        overrides: [],
        documents: [],
    };
}

export function normalizeOnboarding(
    project: ProjectData,
    opportunity?: Partial<OpportunityData>,
    profile: OfferProfile = DEFAULT_OFFER,
): OnboardingData {
    const fallback = createOnboardingData(project, opportunity, profile);
    const saved = project.onboarding;
    if (!saved) return fallback;
    const { permissions: _legacyPermissions, ...current } = saved as OnboardingData & { permissions?: unknown };
    const { currentPrice: _legacyPrice, ...savedForm } = saved.form as OnboardingData['form'] & { currentPrice?: string };
    const agreement = { ...fallback.agreement, ...saved.agreement };
    if (agreement.status === 'DRAFT' && current.projectType === 'CASE_STUDY') {
        agreement.intro = currentFreeAgreementIntro(agreement.intro);
        agreement.caseStudyRights = agreement.caseStudyRights.replace('permissions selected below', 'permission described below');
    }
    return {
        ...fallback,
        ...current,
        agreement,
        payment: { ...fallback.payment, ...saved.payment },
        form: { ...fallback.form, ...savedForm },
        baseline: { ...fallback.baseline, ...saved.baseline },
        scope: { ...fallback.scope, ...saved.scope },
        access: Array.isArray(saved.access) ? saved.access : [],
        overrides: Array.isArray(saved.overrides) ? saved.overrides : [],
        documents: Array.isArray(saved.documents) ? saved.documents : [],
    };
}

const accessKey = (platform: string) =>
    `access-${platform.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}`;

export function generateAccessChecklist(form: OnboardingData['form']): AccessItem[] {
    const items: AccessItem[] = [];
    const add = (platform: string, reason: string, permission: string, instructions: string) => {
        if (!platform.trim() || /^(none|n\/a|no)$/i.test(platform.trim())) return;
        items.push({
            id: accessKey(platform),
            platform,
            reason,
            permission,
            instructions,
            status: 'NOT_REQUESTED',
            required: true,
            nonBlocking: false,
        });
    };
    add(
        form.repositoryProvider,
        'Needed to work with and deploy the funnel code.',
        'Repository collaborator',
        `Invite the Compel delivery email as a collaborator in ${form.repositoryProvider}. Do not share a password.`,
    );
    add(
        form.hostingPlatform,
        'Needed to deploy and verify the finished funnel.',
        'Project collaborator',
        `Invite Compel to the relevant project or team in ${form.hostingPlatform}. Keep the account in the client business name.`,
    );
    add(
        form.domainProvider,
        'Needed only for final domain and DNS connection.',
        'DNS manager or delegated access',
        `Use delegated access in ${form.domainProvider} where available. Do not send login credentials.`,
    );
    add(
        form.bookingPlatform,
        'Needed to update the booking flow and qualification questions.',
        'Editor or admin for the relevant event',
        `Invite Compel through ${form.bookingPlatform}'s team or collaborator settings.`,
    );
    add(
        form.emailPlatform,
        'Needed to build or update the agreed nurture sequence.',
        'Campaign editor',
        `Grant the minimum collaborator role that can edit automations in ${form.emailPlatform}.`,
    );
    add(
        form.crm,
        'Needed to connect lead capture and handoff.',
        'Workflow editor',
        `Invite Compel with access limited to the relevant pipeline or workflow in ${form.crm}.`,
    );
    add(
        form.analyticsPlatform,
        'Needed to capture the baseline and verify tracking.',
        'Viewer or analyst',
        `Grant viewer or analyst access to the relevant property in ${form.analyticsPlatform}.`,
    );
    return items;
}

export type OnboardingBlocker = { key: string; label: string; detail: string };
export function onboardingBlockers(data: OnboardingData): OnboardingBlocker[] {
    const blockers: OnboardingBlocker[] = [];
    const add = (key: string, label: string, detail: string) => {
        if (!data.overrides.includes(key)) blockers.push({ key, label, detail });
    };
    if (data.agreement.status !== 'FULLY_SIGNED')
        add('agreement', 'Agreement not fully signed', 'Complete both required signatures or add a manual override.');
    if (data.projectType === 'PAID') {
        const paid =
            data.payment.status === 'FULLY_PAID' ||
            (data.payment.structure !== 'FULL' && data.payment.status === 'DEPOSIT_PAID');
        if (!paid)
            add(
                'payment',
                data.payment.status === 'OVERDUE' ? 'Payment is overdue' : 'Initial payment not complete',
                'Record the full payment or agreed deposit before work starts.',
            );
    }
    if (!onboardingFormComplete(data))
        add('form', 'Onboarding form incomplete',
            data.form.status === 'COMPLETE'
                ? `Missing: ${missingOnboardingFormFields(data).join(', ')}.`
                : 'Collect the structured business, funnel, tool, and asset details.');
    const missingAccess = data.access.filter(
        (item) => item.required && !item.nonBlocking && !['VERIFIED', 'NOT_NEEDED'].includes(item.status),
    );
    if (missingAccess.length)
        blockers.push({
            key: 'access',
            label: `${missingAccess.length} required access ${missingAccess.length === 1 ? 'item is' : 'items are'} missing`,
            detail: missingAccess.map((item) => item.platform).join(', '),
        });
    if (!data.baseline.captured)
        add('baseline', 'Baseline not captured', 'Preserve the current funnel and mark unavailable metrics as unknown.');
    if (!data.scope.confirmed)
        add('scope', 'Scope not confirmed', 'The client needs to approve the included work, exclusions, and dependencies.');
    return blockers;
}

export function onboardingProgress(data: OnboardingData) {
    const stages = [
        data.agreement.status === 'FULLY_SIGNED' || data.overrides.includes('agreement'),
        data.projectType === 'CASE_STUDY' ||
            data.payment.status === 'FULLY_PAID' ||
            (data.payment.structure !== 'FULL' && data.payment.status === 'DEPOSIT_PAID') ||
            data.overrides.includes('payment'),
        onboardingFormComplete(data) || data.overrides.includes('form'),
        !data.access.some(
            (item) => item.required && !item.nonBlocking && !['VERIFIED', 'NOT_NEEDED'].includes(item.status),
        ),
        data.baseline.captured || data.overrides.includes('baseline'),
        data.scope.confirmed || data.overrides.includes('scope'),
    ];
    return Math.round((stages.filter(Boolean).length / stages.length) * 100);
}
