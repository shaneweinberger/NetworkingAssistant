// Hand-labeled fixture set for validating the classifier prompt.
// Each fixture is a representative example of one of the message types
// Donna will see. The classifier should achieve >= 90% accuracy on these.
//
// Run with: deno run -A test_classifier.ts (script wraps this set + calls Claude).

export interface Fixture {
  id: string
  from: string
  to: string
  subject: string
  snippet: string
  expected_in_scope: boolean
  expected_category: 'networking' | 'recruiting' | 'other' | null
  notes: string
}

export const FIXTURES: Fixture[] = [
  // ---- IN SCOPE: networking ----
  {
    id: 'net_1_coffee_chat_intro',
    from: 'Anna Tran <anna.tran@stripe.com>',
    to: 'shane@example.com',
    subject: 'Coffee chat next week?',
    snippet: 'Hey Shane, great connecting at the Ivey alumni event last week. Would love to grab coffee next week to chat about your interest in fintech.',
    expected_in_scope: true,
    expected_category: 'networking',
    notes: 'classic intro chat request',
  },
  {
    id: 'net_2_alumni_followup',
    from: 'Mark Wei <mwei@example.org>',
    to: 'shane@example.com',
    subject: 'Re: Quick question about your team',
    snippet: 'Thanks for the note Shane. Happy to make some intros to PMs in the org. Are you free Thursday afternoon for 20 min?',
    expected_in_scope: true,
    expected_category: 'networking',
    notes: 'reply to networking outreach',
  },
  {
    id: 'net_3_intro_request',
    from: 'Priya Shah <pshah@example.com>',
    to: 'shane@example.com',
    subject: 'Would you be open to an intro?',
    snippet: 'A friend mentioned you work in agentic AI. Would love to swap notes if you have 15 min.',
    expected_in_scope: true,
    expected_category: 'networking',
    notes: 'cold networking inbound',
  },
  {
    id: 'net_4_mentorship',
    from: 'Brent Lo <blo@iveyalum.ca>',
    to: 'shane@example.com',
    subject: 'Following up from our chat',
    snippet: 'Great to meet you yesterday. I wanted to share that deck I mentioned. Also, happy to be a sounding board on your job search.',
    expected_in_scope: true,
    expected_category: 'networking',
    notes: 'mentor follow-up',
  },
  {
    id: 'net_5_event_invite_real',
    from: 'Jessica Park <jpark@avp.vc>',
    to: 'shane@example.com',
    subject: 'AVP Founders Dinner — would love to have you',
    snippet: 'Hi Shane, hosting an intimate dinner next Thursday with a few engineers exploring the AI space. Personal invite — would love your perspective.',
    expected_in_scope: true,
    expected_category: 'networking',
    notes: 'personal event invite (not mass blast)',
  },

  // ---- IN SCOPE: recruiting ----
  {
    id: 'rec_1_recruiter_outreach',
    from: 'Casey Liu <casey@hr.openai.com>',
    to: 'shane@example.com',
    subject: 'Engineering opportunities at OpenAI',
    snippet: 'Shane — your work on agentic AI caught my eye. We have a few openings on the post-training team I think would be a great match. Open to a 20 min chat?',
    expected_in_scope: true,
    expected_category: 'recruiting',
    notes: 'recruiter outreach',
  },
  {
    id: 'rec_2_interview_schedule',
    from: 'TalentOps <talent@anthropic.com>',
    to: 'shane@example.com',
    subject: 'Scheduling your onsite interview',
    snippet: 'Hi Shane, please use the link below to pick a time for your onsite. We are targeting the week of June 9.',
    expected_in_scope: true,
    expected_category: 'recruiting',
    notes: 'active interview process',
  },
  {
    id: 'rec_3_offer_negotiation',
    from: 'Sara Kim <sara.kim@vercel.com>',
    to: 'shane@example.com',
    subject: 'Re: Offer details',
    snippet: 'Hi Shane, attaching the revised comp letter. Let me know if you have questions, happy to jump on a call this week.',
    expected_in_scope: true,
    expected_category: 'recruiting',
    notes: 'offer stage',
  },
  {
    id: 'rec_4_internship_followup',
    from: 'University Recruiting <ur@figma.com>',
    to: 'shane@example.com',
    subject: 'Status update on your internship application',
    snippet: 'Shane — your application advanced to the next round. We will reach out shortly with a coding interview link.',
    expected_in_scope: true,
    expected_category: 'recruiting',
    notes: 'active pipeline',
  },
  {
    id: 'rec_5_rejection',
    from: 'Recruiting Team <recruiting@stripe.com>',
    to: 'shane@example.com',
    subject: 'Update on your application',
    snippet: 'Thank you for your interest in Stripe. After careful review we have decided to move forward with other candidates.',
    expected_in_scope: true,
    expected_category: 'recruiting',
    notes: 'rejection — still in scope, Donna may need to log it',
  },

  // ---- OUT OF SCOPE ----
  {
    id: 'oos_1_github_pr',
    from: 'GitHub <notifications@github.com>',
    to: 'shane@example.com',
    subject: '[anthropics/claude-code] PR #4321: fix: handle empty toolUse content',
    snippet: 'A new pull request was opened in a repository you watch.',
    expected_in_scope: false,
    expected_category: null,
    notes: 'github notification',
  },
  {
    id: 'oos_2_marketing_newsletter',
    from: 'Stratechery <ben@stratechery.com>',
    to: 'shane@example.com',
    subject: 'The Anthropic-OpenAI Convergence',
    snippet: 'Today is a free article. Stratechery is a daily subscription email and podcast about the strategy and business side of media and technology.',
    expected_in_scope: false,
    expected_category: null,
    notes: 'newsletter',
  },
  {
    id: 'oos_3_uber_receipt',
    from: 'Uber Receipts <noreply@uber.com>',
    to: 'shane@example.com',
    subject: 'Your Wednesday morning trip with Uber',
    snippet: 'Total $12.43. Thanks for choosing Uber.',
    expected_in_scope: false,
    expected_category: null,
    notes: 'transactional receipt',
  },
  {
    id: 'oos_4_2fa',
    from: 'Google <no-reply@accounts.google.com>',
    to: 'shane@example.com',
    subject: 'Your Google verification code is 384203',
    snippet: 'Use this code to verify your identity. Do not share.',
    expected_in_scope: false,
    expected_category: null,
    notes: '2FA code',
  },
  {
    id: 'oos_5_calendar_invite_service',
    from: 'Calendly <no-reply@calendly.com>',
    to: 'shane@example.com',
    subject: 'New event: Sync with Pat',
    snippet: 'Pat scheduled a 30 min event. See details on Calendly.',
    expected_in_scope: false,
    expected_category: null,
    notes: 'service notification — already on calendar, Donna does not need to act',
  },
  {
    id: 'oos_6_family',
    from: 'Mom <mom@gmail.com>',
    to: 'shane@example.com',
    subject: 'flight info for Christmas',
    snippet: 'Hi sweetie, sending you our flight info. Landing at SFO at 4pm Dec 22nd. xo',
    expected_in_scope: false,
    expected_category: null,
    notes: 'personal/family — explicitly out of professional scope',
  },
  {
    id: 'oos_7_amazon_shipping',
    from: 'Amazon.com <shipment-tracking@amazon.com>',
    to: 'shane@example.com',
    subject: 'Your package has shipped',
    snippet: 'Your order #112-9981234 will arrive Friday.',
    expected_in_scope: false,
    expected_category: null,
    notes: 'shipping',
  },
  {
    id: 'oos_8_slack_digest',
    from: 'Slack <feedback@slack.com>',
    to: 'shane@example.com',
    subject: 'Your Slack activity summary',
    snippet: 'Here is what you missed this week in workspaces you use.',
    expected_in_scope: false,
    expected_category: null,
    notes: 'system summary',
  },
  {
    id: 'oos_9_marketing_promo',
    from: 'Spotify <no-reply@spotify.com>',
    to: 'shane@example.com',
    subject: 'Premium for $0.99 — limited time',
    snippet: 'Special offer expires soon. Upgrade now.',
    expected_in_scope: false,
    expected_category: null,
    notes: 'promo',
  },

  // ---- AMBIGUOUS BUT IN SCOPE (the prompt says: tip toward in_scope) ----
  {
    id: 'amb_1_recruiter_via_template',
    from: 'Robin Carter <robin.carter@gem.com>',
    to: 'shane@example.com',
    subject: 'Quick chat',
    snippet: 'Hi Shane! I came across your background and would love to share an opportunity with you. Would you have time this week?',
    expected_in_scope: true,
    expected_category: 'recruiting',
    notes: 'looks templated but is recruiter outreach',
  },
  {
    id: 'amb_2_alumni_event',
    from: 'Ivey Career Centre <careercentre@ivey.ca>',
    to: 'shane@example.com',
    subject: 'Bay Area alumni mixer June 12',
    snippet: 'You are invited to the Bay Area Ivey alumni networking mixer. RSVP below.',
    expected_in_scope: true,
    expected_category: 'networking',
    notes: 'school-sent but networking-relevant',
  },
]
