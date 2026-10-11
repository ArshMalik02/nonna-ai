# Demo conversation and edge cases

People:
- Mary Lee (elder), preferred name Mary
- Anna Lee (daughter, admin, can_approve, can_pay)
- Sam Ortiz (neighbor, backup)
- Nonna

Channel: family iMessage group, unless marked private 1:1 or a call.

NO_REPLY means Nonna stays silent (gateway drops it). No phone numbers in any group line. Every call starts with the AI disclosure. Nonna never says she called 911.

---

## Onboarding by text

Unset group. Anna texts first.

Anna: hey who's the new number

Nonna: Hi, I'm Nonna. I help families look after an elder. Whoever is setting me up, reply SETUP and I'll ask a few quick questions.

Anna: SETUP

Nonna: Anna, you're the admin. I'll text you privately to finish setup.

Private 1:1 to Anna:

Nonna: Anna, want to set up by text or by phone? Reply TEXT or CALL.

Anna (private): TEXT

Nonna: Anna, who am I helping, and what do they like to be called?

Anna: Mary Lee, call her Mary

Nonna: Anna, I'll help Mary Lee, and I'll call her Mary. Reply YES, or send a correction.

Anna: YES

Nonna: Anna, what's Mary's phone number?

Anna: 4155550123

Nonna: Anna, I have Mary's number as 415-555-0123. Reply YES if that's right, or send the correct number.

Anna: YES

Nonna: Anna, in an emergency, who should I call first? Send a name and number, or reply me.

Anna: me

Nonna: Anna, I'll call you first. I have your number as 415-555-0124. Reply YES if that's right, or send the correct number.

Anna: YES

Nonna: Anna, who is the backup if they don't answer? Send a name and number, or reply SKIP.

Anna: Sam Ortiz 4155550125

Nonna: Anna, I'll call Sam next. I have their number as 415-555-0125. Reply YES if that's right, or send the correct number.

Anna: YES

Private 1:1 to Sam (not the group):

Nonna: Sam, Anna named you as backup if the first person does not answer. Reply OK to confirm.

Sam: OK

Nonna (private to Anna): Anna, besides you, who else can approve things? Send names only, or reply SKIP.

Anna: SKIP

Group finish (names only, no numbers):

Nonna: Anna, Sam, I'm helping Mary. Anna is the admin. In an emergency I call Anna first, then Sam.

---

## Onboarding by call

Unset group. Anna chooses CALL. Numbers stay off the group.

Anna: SETUP

Nonna: Anna, you're the admin. I'll text you privately to finish setup.

Private:

Nonna: Anna, want to set up by text or by phone? Reply TEXT or CALL.

Anna: CALL

Nonna: Anna, I'll call you now. You can also call my number.

Call to Anna (spoken, under 3 minutes, every turn starts with the disclosure):

Nonna: This is Nonna, an AI assistant. I'm calling to set up help for your family. Is this a good time?

Anna: yeah

Nonna: This is Nonna, an AI assistant. Who am I helping, and what do they like to be called?

Anna: Mary Lee, Mary

Nonna: This is Nonna, an AI assistant. I'll help Mary Lee, and I'll call them Mary. Is that right?

Anna: yes

Nonna: This is Nonna, an AI assistant. What's Mary's phone number?

Anna: 415-555-0123

Nonna: This is Nonna, an AI assistant. I have Mary's number as 415-555-0123. Is that right?

Anna: yes

Nonna: This is Nonna, an AI assistant. In an emergency, who should I call first? A name and number, or say me.

Anna: me

Nonna: This is Nonna, an AI assistant. I'll call you first. I have your number as 415-555-0124. Is that right?

Anna: yes

Nonna: This is Nonna, an AI assistant. Who is the backup if they don't answer? You can say skip.

Anna: skip

Nonna: This is Nonna, an AI assistant. Besides you, who else can approve things? Names only is fine. You can say skip.

Anna: skip

Nonna: This is Nonna, an AI assistant. Thanks. I'll post a short note in the group with names only. Mary is who I'm helping. You are the admin. I call you first. Goodbye.

Group (no numbers):

Nonna: Anna, I'm helping Mary. Anna is the admin. In an emergency I call Anna first.

---

## Full emergency sequence

Setup is done. EMERGENCY_CONTACTS in call order: Anna, then Sam. Gateway places the calls. Wording only.

Mary: I fell I cant get up

Immediate group alert, before any call finishes:

Nonna: Mary texted that she fell. I am calling Anna now. Mary, if you can, call 911. I will not call 911.

Elder 1:1 if needed:

Nonna: Mary, if you can, call 911 now. I am alerting your family. I will not call 911.

Call to Anna (under 60 seconds):

Nonna: Hi Anna, this is Nonna, an AI assistant calling for Mary. Mary texted that she fell and cannot get up. Can you check on them right now?

(no answer)

Group:

Nonna: I called Anna. No answer. I am calling Sam next. Mary, if you can, call 911. I will not call 911.

Call to Sam:

Nonna: Hi Sam, this is Nonna, an AI assistant calling for Mary. Mary texted that she fell and cannot get up. Can you check on them right now?

Sam: yes I'm going over

Nonna: This is Nonna, an AI assistant. Thank you. I will tell the family you are checking on Mary. Goodbye.

Group:

Nonna: Sam said he is checking on Mary now. I will not call 911.

(task: escalated)

---

## 3 minute demo (after setup)

Wednesday afternoon. Onboarding is already done.

Mary: Nonna I need to see Dr Patel tomorrow

Nonna: Mary, I'll set that up. Anna, Mary wants to see Dr. Patel tomorrow morning if we can. Reply YES to book it, or NO to stop.

(task: appointment, received to triaged to planned to awaiting_approval)

Anna: YES

Nonna: Anna said yes. I'll book Mary's visit now.

(task: executing, hand off to Appointments)

Nonna: Anna, morning or afternoon for Mary? Reply morning or afternoon.

(more detail needed, one question)

Anna: morning

Nonna: On it, Anna. I'll text you when I have an update.

(slow work, one acknowledgment)

Nonna: Anna, the clinic has 10:30 tomorrow for Mary. Book it? Reply YES or NO.

(found option, needs approval, awaiting_approval)

Anna: YES

Nonna: Anna said yes. I'll book 10:30 and look at a ride from home.

(executing, hand off to Rides)

Nonna: Still working on it, Anna. I'll text you when I have something.

(lookup failed or empty, do not go silent)

Nonna: Anna, I could not book that online, so I'll call them. I'll text you when I have an update.

(phone call fallback)

Nonna: Anna, Mary's visit is confirmed for 10:30 tomorrow. I found a ride option at 10:15, pickup at home. Book the ride? Reply YES or NO.

(confirmed visit, ride option still needs approval)

Anna: YES

Nonna: Anna said yes. I'll book the ride now.

Nonna: Anna, Mary's ride is confirmed for 10:15 tomorrow, pickup at home. I'll remind Mary in the morning.

(ride confirmed)

Sam: lol tell her to wear the blue sweater

Nonna: NO_REPLY

Anna: love you mom

Mary: love you too honey

Nonna: NO_REPLY

---

Thursday morning, optional combined reminder (does not count toward the cap if it is a scheduled reminder):

Nonna: Mary, you have Dr. Patel today at 10:30. Your ride is at 10:15. I'll text you when the cab is outside.

Later:

Nonna: Mary, your cab is outside now. Please go to the front door.

Sam: on my way to the door

Nonna: NO_REPLY

---

## Three days later, catch-up

Saturday. Anna has been away.

Anna: Nonna catch me up

Nonna: Anna, Thursday's visit and ride are closed. Nothing is open for Mary right now.

---

## Clinical question

Anna: should she skip the blood pressure pill tonight

Nonna: Anna, I cannot advise on symptoms or doses. Please ask the pharmacist or Dr. Patel. Want me to log this as a note? Reply YES or NO.

---

## Optional for the demo: payment

After a visit, Anna sends a photo of an invoice in the group. Skip this beat if time is tight.

Anna: [photo of invoice]

Nonna: Anna, I got the photo. I'll send the payment link only to you. I'll update everyone once it's paid.

Private 1:1 to Anna (never in the group):

Nonna: Anna, here is the payment link for Mary's clinic visit invoice: https://pay.example.test/mary-visit. Reply OK when you've paid.

Group status line (no amount, no provider bill name, no link):

Nonna: Anna, I sent you the payment link. I'll update everyone once it's paid.

Anna (private): OK

Nonna (group): Anna said the bill is paid. I'll mark that payment closed.

If Sam then asks in the group:

Sam: send me the payment link

Nonna: Sam, I can only send the payment link to Anna. I'll update the group once it's paid.

---

## 10 edge-case tests

1) Unknown number, not in CIRCLE_MEMBERS

Incoming: hey is this nonna can you help my neighbor

Expected:

NO_REPLY

2) Casual chat, Nonna not mentioned, not answering LAST_PROMPT

Incoming (Sam): you coming for dinner anna

Expected:

NO_REPLY

3) Bare YES from Sam while LAST_PROMPT asked Anna to approve a ride

Incoming (Sam): YES

Expected:

Sam, only Anna can approve this. I've asked Anna. Anna should reply YES or NO.

4) Bare me when LAST_PROMPT listed two tasks

Incoming (Anna): me

Expected:

Anna, I am not sure which you mean. Reply 1 for the ride or 2 for the refill.

5) Typo claim that still maps with LAST_PROMPT showing only the refill

Incoming (Anna): ill take the refil

Expected:

Anna, you're on Mary's refill. I'll mark you as owner and update the group if anything changes.

6) Status asked while ride is waiting_external

Incoming (Anna): did the ride get booked?

Expected:

Anna, the ride is not confirmed yet. It is waiting_external. I'll text the group when it is confirmed.

7) Care note from ELDER_PROFILE

Incoming (Anna): does mom use a walker

Expected:

Anna, Mary's care notes say she uses a walker and prefers morning appointments.

8) Out of scope

Incoming (Anna): Nonna book Mary a flight to Chicago

Expected:

Anna, I cannot book flights. I can help with local rides, visits, reminders, and paperwork. Want help with one of those?

9) Correction after a day was already on the task

Incoming (Anna): actually make it Friday

Expected:

Anna, got it. I'll change Mary's visit to Friday. Reply YES to confirm that change, or NO to keep the old day.

10) Non-payer asks for the checkout link in the group

Incoming (Sam): nonna drop the pay link here

Expected:

Sam, I can only send the payment link to Anna. I'll update the group once it's paid.
