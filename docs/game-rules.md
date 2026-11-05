# Game rules and scoring

All answers sit on a 0–100 spectrum in steps of 5. Points are called Verdict Points (VP), and every award is an entry in a deterministic score ledger. The results screen totals that ledger.

## Match format

| Match length | Read the Room rounds | Hearings (4+ players) | Bluff turns (4+ players) |
| --- | --- | --- | --- |
| Quick | 2 | 2 | 3 |
| Standard | 3 | 3 | 4 |
| Long | 4 | 4 | 6 |

Three-player matches always have **3 hearings and 3 bluff turns**. That way everyone debates twice, judges once, speaks once and investigates twice.

The match types are:

- **Full show:** every segment.
- **Opinions + Court:** no Bluff segment.
- **Opinions + Bluff:** no Court segment.

Contracts and Chaos Cards can each be switched off.

## Read the Room

Each round has a prompt, a submission step, a prediction step, a discussion and a reveal. Every player answers privately. Each player is then assigned someone else's answer to predict.

| Prediction difference | VP |
| --- | --- |
| exact | 100 |
| ≤ 10 | 80 |
| ≤ 20 | 60 |
| ≤ 30 | 40 |
| more | 0 |

Answers enter the **Opinion Vault**, where entries have three possible states:

- PRIVATE until the reveal,
- REVEALED afterwards,
- EVIDENCE_ELIGIBLE once they can be cited with Receipts.

Ticking **Keep this out of evidence** still scores the answer, but it never becomes Receipts material.

## Secret Contracts

Each player picks one of two offered contracts, each worth +30 VP when completed. Contracts are hidden until the results. If a player doesn't choose before the timer runs out, the first offer is selected for them.

| Contract | Completed when |
| --- | --- |
| Mind Link | Your judge prediction lands within 10 of the target's real stance |
| Skeptic | You correctly read the speaker on your designated bluff turn |
| Kingmaker | (4+ players only) You become the non-voting Analyst for a hearing and correctly call the winner (the call is worth 40 VP; the contract adds +30) |
| Fact Checker | As a judge, you resolve a Receipts card on a debater's statement in your designated hearing |

## Devil's Court

Each hearing has two debaters and the remaining players as judges, rotating so that everyone fills every role.

1. **Preparation.** Debaters lock their *real* stance. Judges predict one debater's stance.
2. **Debate.** Sides (FOR or AGAINST) are assigned independently of stance. A debater sees their side after locking. The room sees sides from the openings. The phases are Opening (30 s), Rebuttal (20 s), Challenge (20 s) and Closing (15 s).
3. **Voting.** Judges pick the more convincing debater. If the bench is split, a seeded tiebreak draw decides it.

| Award | VP |
| --- | --- |
| Debate winner | 80 |
| Debate loser | 20 |
| Judge, for casting a verdict | 40 |
| Judge stance prediction | ≤10: 40 · ≤20: 30 · ≤30: 20 · ≤40: 10 |
| Analyst correct call | 40 |

## Catch the Bluff

1. The speaker locks their genuine answer.
2. The server then randomly decides whether the speaker tells the truth or bluffs.
3. A bluff claim is 35–60 away from the genuine answer, snapped to a multiple of 5.
4. The speaker publicly defends the claim, and investigators vote **Honest** or **Bluffing**.

If the speaker never locks an answer, a neutral 50 is used and nothing is stored.

| Award | VP |
| --- | --- |
| Investigator correct read | 30 each |
| Honest speaker completes their turn | 20 |
| Bluffer escapes (majority wrong) | 40 |
| Bluffer caught | 10 |

## Final Verdict

The top two players debate the final question, using the tiebreak order to rank them. Each debater locks a real stance (anything except 50). Their assigned side is committed in advance but stays hidden until they lock. A debater is **honest** when their side matches their stance, and **bluffing** otherwise.

| Award | VP |
| --- | --- |
| Finale winner | 100 |
| Finale loser | 20 |
| Debater correctly classifies the opponent | +50 |
| Maximum for a debater | 150 |

**Non-debaters in a 3-player match.** The single non-debater is the **Lead Investigator**. They cast the verdict and earn:

- **Stance prediction** for one finalist: ≤10: 50, ≤20: 35, ≤30: 20, ≤40: 10.
- **Classification:** 25 for each finalist correctly classified as honest or bluffing.

**Non-debaters with 4+ players.** Non-debaters alternate between two seats:

- **Juror:** 50 for a valid verdict, plus classification.
- **Investigator:** a winner call worth 50, plus classification.

**Underdog Stakes.** A player who cannot catch the leader with the normal maximum, but could with 1.5×, has their finale awards multiplied by 1.5. Formally, the multiplier applies when `score + 100 < leader + 20 ≤ score + 150`.

## Chaos Cards

Every player starts with **3 Influence charges** and may play at most one card per hearing, bluff turn or finale.

| Card | Effect | Playable during |
| --- | --- | --- |
| Switch Sides | Debaters swap sides for the rest of the hearing (once per hearing) | Court Rebuttal |
| Receipts | Puts an earlier vault answer of a debater or speaker on screen as "Previous Statement" evidence | Court Challenge, Bluff Discussion, Finale Investigation |
| Cross-Examination | Gives a chosen player the floor for one direct question (+20 s) | Court Challenge, Bluff Discussion, Finale Investigation |
| Objection | Cancels a card in its reaction window; cannot itself be objected to | Any card's 6-second reaction window |

A card that loses the 1-second priority contest is not charged. A card that wins priority spends its charge, even if an Objection then cancels it. The objector also spends a charge. Cards never change scores directly, and charges cannot be bought.

## Results and tiebreaks

Players are ranked by total VP. Ties are broken by, in order:

1. successful predictions,
2. debate wins,
3. correct bluff reads.

Players still tied after that share the rank.

## Skips and host controls

- Each player has 2 anonymous skip requests per match. A request replaces the current prompt immediately, and only while it is still in a preparation/prompt phase.
- The host can **pause/resume**, **advance** (in host-advances pacing), **replace the prompt** during preparation phases, and **end the match**.
