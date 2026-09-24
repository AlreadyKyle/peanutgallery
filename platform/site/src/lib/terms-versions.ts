// Every posted version of the Terms and the Refunds page, which are one document with one whole
// number (docs/specs/legal-copy.md). A version is posted by inserting its row into
// public.terms_versions through its own migration, after the site that carries its words is live;
// the pages show a version's words only once its row says when it took effect.
//
// A posted version's words are never edited: they are what applied to the contributions made while
// it was in force (docs/COPY.md). A change is a new entry at the end, posted by the procedure in
// docs/specs/legal-copy.md. This file is kernel (platform/gate/kernel-paths.txt), and the studio
// rename leaves it alone (scripts/rename.mjs lists it as history): version 3 carries the new name.
//
// In a paragraph, {email} becomes the current contact address as a mailto link, {refunds} a link to
// the Refunds page and {terms} a link to the Terms (TextPage.tsx). No imports: the words stand alone.

export type TextDoc = {
  readonly title: string;
  readonly lede: string;
  readonly sections: readonly { readonly heading: string; readonly paragraphs: readonly string[] }[];
};

export type TermsVersion = {
  readonly version: number;
  readonly terms: TextDoc;
  readonly refunds: TextDoc;
};

/** Every version in the bundle, oldest first. Append only. */
export const TERMS_VERSIONS = [
  {
    // Version 1: the text live since #47, merged 2026-09-23 01:32:51 UTC.
    version: 1,
    terms: {
      title: 'Terms',
      lede: 'What a contribution pays for, what it does not buy, and the rules that apply.',
      sections: [
        {
          heading: 'Who runs the studio',
          paragraphs: ['Peanut Gallery is operated by Kyle Smith, an individual in Ontario, Canada.'],
        },
        {
          heading: 'What a contribution pays for',
          paragraphs: [
            "A contribution pays for the agents' compute and for the studio, in the split you choose at checkout.",
            'It buys no goods, no ownership and no equity. It does not guarantee any outcome. Peanut Gallery is not a charity, and contributions are not donations.',
          ],
        },
        {
          heading: 'Funding a card',
          paragraphs: [
            "You fund a card to have it built. When a card's bar is full, the card moves to the queue and the agents build it in turn.",
            "Every change must pass the gate, the studio's automated checks, before it goes live. The gate may reject a change even when its card is fully funded.",
          ],
        },
        {
          heading: 'Rules contributions cannot change',
          paragraphs: [
            'No contribution or card can change these rules: the public ledger, the spend caps, the default 80/20 split and the 10% reserve, the emergency fund rule, the gate, rollback, the content filter and the all-ages rating, the art policy, and the rule that no agent that can change the game or the site reads text from the public.',
          ],
        },
        {
          heading: 'Large contributions',
          paragraphs: [
            "Up to $50 of agent credit per person per day reaches the meter within a minute, while the studio's total for the day is under its daily limit. Credit above either limit is held for 14 days before it reaches the meter.",
          ],
        },
        {
          heading: 'Refunds',
          paragraphs: ['Refunds and disputes are handled as the {refunds} describes.'],
        },
        {
          heading: 'The games',
          paragraphs: ['The games are free to play.'],
        },
        {
          heading: 'Law',
          paragraphs: ['These terms are governed by the laws of Ontario and the laws of Canada that apply there.'],
        },
        {
          heading: 'Changes to these terms',
          paragraphs: ['When these terms change, the new version is posted on this page with its date.'],
        },
        {
          heading: 'Contact',
          paragraphs: ['Questions about these terms go to {email}.'],
        },
      ],
    },
    refunds: {
      title: 'Refunds',
      lede: 'How to ask for a refund, and what a refund changes.',
      sections: [
        {
          heading: 'Asking for a refund',
          paragraphs: ['Email {email} within 14 days of your contribution, with your Stripe receipt.'],
        },
        {
          heading: 'How refunds are paid',
          paragraphs: ['Refunds go back through Stripe to the card or account you paid with.'],
        },
        {
          heading: 'What a refund changes',
          paragraphs: [
            "A refund or a dispute takes that contribution's credit off the meter and off any card bar it funded. Work that has already shipped stays shipped.",
          ],
        },
        {
          heading: 'Disputes',
          paragraphs: ['Disputes go through Stripe. The 10% reserve covers disputes first.'],
        },
      ],
    },
  },
  {
    // Version 2: the refund policy, age, currency, a card that is not built, winding down, no
    // cryptocurrency and changes that apply only to later money (docs/specs/legal-copy.md, Appendix).
    version: 2,
    terms: {
      title: 'Terms',
      lede: 'What a contribution pays for, what it does not buy, and the rules that apply.',
      sections: [
        {
          heading: 'Who runs the studio',
          paragraphs: ['Peanut Gallery is operated by Kyle Smith, an individual in Ontario, Canada. Write to {email} about anything in these terms.'],
        },
        {
          heading: 'What a contribution pays for',
          paragraphs: [
            "A contribution pays for the agents' compute and for the studio, in the split you choose at checkout.",
            'It buys no goods, no ownership and no equity. It does not guarantee any outcome. Peanut Gallery is not a charity, and contributions are not donations.',
          ],
        },
        {
          heading: 'Who can contribute',
          paragraphs: [
            'To contribute you must be an adult where you live, or have the permission of a parent or guardian. Anyone can play the games and read this site.',
            'If someone contributed without the permission they needed, a parent or guardian can email {email} and the contribution is refunded in full, as the {refunds} describes.',
          ],
        },
        {
          heading: 'Price and currency',
          paragraphs: [
            'You choose the amount at checkout. Amounts on this site and at checkout are in US dollars (USD), and contributions are charged in US dollars.',
            "Stripe's fee comes out of the amount you pay, and the studio adds no tax or other charge. If your card uses another currency, Stripe or your card issuer converts the amount and may charge a fee for it.",
          ],
        },
        {
          heading: 'Funding a card',
          paragraphs: [
            "You fund a card to have it built. When a card's bar is full, the card moves to the queue and the agents build it in turn.",
            'No card has a delivery date, because the agents work only while the studio is not paused.',
            "Every change must pass the gate, the studio's automated checks, before it goes live. The gate may reject a change even when its card is fully funded.",
          ],
        },
        {
          heading: 'If a card is not built',
          paragraphs: [
            'If a card is rejected, or the board cancels it, the money on it that the agents did not spend pays for later cards. You can still ask for a refund within 14 days of your contribution, as the {refunds} describes.',
          ],
        },
        {
          heading: 'If the studio stops',
          paragraphs: [
            'If the studio stops, contributions close first, and any card being built is finished or cancelled.',
            "Then each contribution gets back its own agent money that has not been spent: its credit still on hold, its share of what is left on each card bar it reached, and its share of the agents' unspent money that is on no card's bar. Each share is in proportion to what the contribution put there.",
            "The 10% reserve and the emergency fund are kept for 120 days after the last contribution, the usual time in which a card payment can be disputed. What is left of them is then refunded in proportion to what each contribution put into them. The studio's share is not refunded.",
            'These refunds go back through Stripe where Stripe allows it, and another way agreed by email where it does not. A final ledger is then published on this site, listing any money that could not be returned.',
          ],
        },
        {
          heading: 'Rules contributions cannot change',
          paragraphs: [
            'No contribution or card can change these rules: the public ledger, the spend caps, the default 80/20 split and the 10% reserve, the emergency fund rule, the gate, rollback, the content filter and the all-ages rating, the art policy, and the rule that no agent that can change the game or the site reads text from the public.',
          ],
        },
        {
          heading: 'Large contributions',
          paragraphs: [
            "Up to $50 of agent credit per person per day reaches the meter within a minute, while the studio's total for the day is under its daily limit. Credit above either limit is held for 14 days before it reaches the meter.",
          ],
        },
        {
          heading: 'Refunds',
          paragraphs: ['Refunds and disputes are handled as the {refunds} describes.'],
        },
        {
          heading: 'The games',
          paragraphs: ['The games are free to play.'],
        },
        {
          heading: 'No cryptocurrency',
          paragraphs: [
            'Peanut Gallery has no cryptocurrency, crypto coin, token or NFT. The coin drawn on this site is a symbol for money in US dollars. Anything that claims to be a Peanut Gallery token is not from the studio.',
          ],
        },
        {
          heading: 'Law',
          paragraphs: ['These terms are governed by the laws of Ontario and the laws of Canada that apply there.'],
        },
        {
          heading: 'Changes to these terms',
          paragraphs: [
            'When these terms change, the new version is posted on this page with its number and the time it took effect. Earlier versions stay listed below.',
            'A change applies only to contributions made after it is posted. A contribution keeps the version in force when its checkout started.',
          ],
        },
      ],
    },
    refunds: {
      title: 'Refunds',
      lede: 'How to ask for a refund, and what a refund changes.',
      sections: [
        {
          heading: 'Asking for a refund',
          paragraphs: ['Email {email} within 14 days of your contribution, with your Stripe receipt. You get back the full amount you paid.'],
        },
        {
          heading: 'How refunds are paid',
          paragraphs: [
            "Refunds go back through Stripe to the card or account you paid with. Stripe keeps its fee on a refunded payment, and the studio's share pays that fee.",
            'If Stripe cannot refund a payment, for example because the card has been closed, the studio returns the money another way agreed with you by email.',
          ],
        },
        {
          heading: 'After 14 days',
          paragraphs: [
            'After 14 days a contribution is refunded only in two cases, both in the {terms}: a parent or guardian asks for a refund of a contribution made without their permission, or the studio stops. Nothing here limits a right to cancel that the law gives you.',
          ],
        },
        {
          heading: 'A card that is not built',
          paragraphs: [
            'If a card is rejected or cancelled, the money on it that the agents did not spend pays for later cards. You can still ask for a refund within 14 days of your contribution.',
          ],
        },
        {
          heading: 'What a refund changes',
          paragraphs: [
            "A refund or a dispute takes that contribution's credit off the meter and off any card bar it funded. Work that has already shipped stays shipped.",
          ],
        },
        {
          heading: 'Disputes',
          paragraphs: ['Disputes go through Stripe. The 10% reserve covers disputes first.'],
        },
      ],
    },
  },
  {
    // Version 3: version 2 with the studio's new name, Mob Machine, and no other change (PLAN.md §10
    // decision 43, docs/specs/rename.md).
    version: 3,
    terms: {
      title: 'Terms',
      lede: 'What a contribution pays for, what it does not buy, and the rules that apply.',
      sections: [
        {
          heading: 'Who runs the studio',
          paragraphs: ['Mob Machine is operated by Kyle Smith, an individual in Ontario, Canada. Write to {email} about anything in these terms.'],
        },
        {
          heading: 'What a contribution pays for',
          paragraphs: [
            "A contribution pays for the agents' compute and for the studio, in the split you choose at checkout.",
            'It buys no goods, no ownership and no equity. It does not guarantee any outcome. Mob Machine is not a charity, and contributions are not donations.',
          ],
        },
        {
          heading: 'Who can contribute',
          paragraphs: [
            'To contribute you must be an adult where you live, or have the permission of a parent or guardian. Anyone can play the games and read this site.',
            'If someone contributed without the permission they needed, a parent or guardian can email {email} and the contribution is refunded in full, as the {refunds} describes.',
          ],
        },
        {
          heading: 'Price and currency',
          paragraphs: [
            'You choose the amount at checkout. Amounts on this site and at checkout are in US dollars (USD), and contributions are charged in US dollars.',
            "Stripe's fee comes out of the amount you pay, and the studio adds no tax or other charge. If your card uses another currency, Stripe or your card issuer converts the amount and may charge a fee for it.",
          ],
        },
        {
          heading: 'Funding a card',
          paragraphs: [
            "You fund a card to have it built. When a card's bar is full, the card moves to the queue and the agents build it in turn.",
            'No card has a delivery date, because the agents work only while the studio is not paused.',
            "Every change must pass the gate, the studio's automated checks, before it goes live. The gate may reject a change even when its card is fully funded.",
          ],
        },
        {
          heading: 'If a card is not built',
          paragraphs: [
            'If a card is rejected, or the board cancels it, the money on it that the agents did not spend pays for later cards. You can still ask for a refund within 14 days of your contribution, as the {refunds} describes.',
          ],
        },
        {
          heading: 'If the studio stops',
          paragraphs: [
            'If the studio stops, contributions close first, and any card being built is finished or cancelled.',
            "Then each contribution gets back its own agent money that has not been spent: its credit still on hold, its share of what is left on each card bar it reached, and its share of the agents' unspent money that is on no card's bar. Each share is in proportion to what the contribution put there.",
            "The 10% reserve and the emergency fund are kept for 120 days after the last contribution, the usual time in which a card payment can be disputed. What is left of them is then refunded in proportion to what each contribution put into them. The studio's share is not refunded.",
            'These refunds go back through Stripe where Stripe allows it, and another way agreed by email where it does not. A final ledger is then published on this site, listing any money that could not be returned.',
          ],
        },
        {
          heading: 'Rules contributions cannot change',
          paragraphs: [
            'No contribution or card can change these rules: the public ledger, the spend caps, the default 80/20 split and the 10% reserve, the emergency fund rule, the gate, rollback, the content filter and the all-ages rating, the art policy, and the rule that no agent that can change the game or the site reads text from the public.',
          ],
        },
        {
          heading: 'Large contributions',
          paragraphs: [
            "Up to $50 of agent credit per person per day reaches the meter within a minute, while the studio's total for the day is under its daily limit. Credit above either limit is held for 14 days before it reaches the meter.",
          ],
        },
        {
          heading: 'Refunds',
          paragraphs: ['Refunds and disputes are handled as the {refunds} describes.'],
        },
        {
          heading: 'The games',
          paragraphs: ['The games are free to play.'],
        },
        {
          heading: 'No cryptocurrency',
          paragraphs: [
            'Mob Machine has no cryptocurrency, crypto coin, token or NFT. The coin drawn on this site is a symbol for money in US dollars. Anything that claims to be a Mob Machine token is not from the studio.',
          ],
        },
        {
          heading: 'Law',
          paragraphs: ['These terms are governed by the laws of Ontario and the laws of Canada that apply there.'],
        },
        {
          heading: 'Changes to these terms',
          paragraphs: [
            'When these terms change, the new version is posted on this page with its number and the time it took effect. Earlier versions stay listed below.',
            'A change applies only to contributions made after it is posted. A contribution keeps the version in force when its checkout started.',
          ],
        },
      ],
    },
    refunds: {
      title: 'Refunds',
      lede: 'How to ask for a refund, and what a refund changes.',
      sections: [
        {
          heading: 'Asking for a refund',
          paragraphs: ['Email {email} within 14 days of your contribution, with your Stripe receipt. You get back the full amount you paid.'],
        },
        {
          heading: 'How refunds are paid',
          paragraphs: [
            "Refunds go back through Stripe to the card or account you paid with. Stripe keeps its fee on a refunded payment, and the studio's share pays that fee.",
            'If Stripe cannot refund a payment, for example because the card has been closed, the studio returns the money another way agreed with you by email.',
          ],
        },
        {
          heading: 'After 14 days',
          paragraphs: [
            'After 14 days a contribution is refunded only in two cases, both in the {terms}: a parent or guardian asks for a refund of a contribution made without their permission, or the studio stops. Nothing here limits a right to cancel that the law gives you.',
          ],
        },
        {
          heading: 'A card that is not built',
          paragraphs: [
            'If a card is rejected or cancelled, the money on it that the agents did not spend pays for later cards. You can still ask for a refund within 14 days of your contribution.',
          ],
        },
        {
          heading: 'What a refund changes',
          paragraphs: [
            "A refund or a dispute takes that contribution's credit off the meter and off any card bar it funded. Work that has already shipped stays shipped.",
          ],
        },
        {
          heading: 'Disputes',
          paragraphs: ['Disputes go through Stripe. The 10% reserve covers disputes first.'],
        },
      ],
    },
  },
] as const satisfies readonly TermsVersion[];

/** The newest version in the bundle. */
export const NEWEST_TERMS: TermsVersion = TERMS_VERSIONS[TERMS_VERSIONS.length - 1]!;
